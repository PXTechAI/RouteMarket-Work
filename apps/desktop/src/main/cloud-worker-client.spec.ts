import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@routemarket/work-protocol";
import {
  CloudWorkerClient,
  type CloudWorkerTransport
} from "./cloud-worker-client";

const runtimeResponse = {
  runtime_id: "runtime_test",
  manifest_revision: 0
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createWorker(overrides: Partial<CloudWorkerTransport> = {}): CloudWorkerTransport {
  return {
    listProjects: vi.fn(async () => []),
    executeJob: vi.fn(async () => []),
    pendingEvents: vi.fn(async () => []),
    acknowledgeEvent: vi.fn(async () => ({ acknowledged: true as const })),
    ...overrides
  };
}

function createClient(
  workerClient: CloudWorkerTransport,
  onActivity = vi.fn()
): CloudWorkerClient {
  return new CloudWorkerClient({
    apiBaseUrl: "https://api.example.test",
    sessionToken: "session-token",
    installationId: "install_test",
    deviceName: "Test Workstation",
    platform: "windows",
    arch: "x64",
    appVersion: "0.1.0",
    workerVersion: "0.1.0",
    workerClient,
    onActivity
  });
}

describe("CloudWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("re-registers after the initial connection attempt fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/runtimes/register")) {
          return jsonResponse(runtimeResponse);
        }
        if (url.endsWith("/capabilities")) {
          return jsonResponse({});
        }
        if (url.includes("/jobs/offers?")) {
          return jsonResponse({ items: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(createWorker());

    await client.start();
    expect(client.getState()).toMatchObject({
      status: "error",
      error: "network unavailable"
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(client.getState()).toMatchObject({
      status: "online",
      runtimeId: "runtime_test",
      error: null
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    client.stop();
  });

  it("does not reconnect after stop", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(createWorker());

    await client.start();
    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uploads projects and acknowledges pending outbox events", async () => {
    const pendingEvent: JobEvent = {
      eventId: "event_1",
      jobId: "job_1",
      runtimeId: "runtime_test",
      leaseId: "lease_1",
      leaseEpoch: 1,
      seq: 1,
      eventType: "job.succeeded",
      occurredAt: "2026-07-17T00:00:00.000Z",
      data: { output: { text: "hello" } }
    };
    const acknowledgeEvent = vi.fn(async () => ({ acknowledged: true as const }));
    const worker = createWorker({
      listProjects: vi.fn(async () => [
        {
          localProjectId: "project_local_1",
          displayName: "Example Project",
          rootFingerprint: "sha256:test",
          createdAt: "2026-07-17T00:00:00.000Z",
          updatedAt: "2026-07-17T00:00:00.000Z"
        }
      ]),
      pendingEvents: vi.fn(async () => [pendingEvent]),
      acknowledgeEvent
    });
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (url.endsWith("/runtimes/register")) {
        return jsonResponse(runtimeResponse);
      }
      if (
        url.endsWith("/capabilities") ||
        url.endsWith("/projects/bind") ||
        url.endsWith("/jobs/job_1/events")
      ) {
        return jsonResponse(
          url.endsWith("/events") ? { acknowledged: true } : {}
        );
      }
      if (url.includes("/jobs/offers?")) {
        return jsonResponse({ items: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(worker);

    await client.start();

    const capabilityRequest = requests.find(({ url }) => url.endsWith("/capabilities"));
    expect(capabilityRequest).toMatchObject({
      method: "PUT",
      body: {
        revision: 1,
        capabilities: [
          {
            key: "local.fs.read",
            version: 1,
            risk: "R0",
            operations: ["read_text", "stat", "list"]
          }
        ],
        projects: [
          {
            localProjectId: "project_local_1",
            access: ["read"],
            rootFingerprint: "sha256:test"
          }
        ]
      }
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringMatching(/\/projects\/bind$/),
          method: "POST",
          body: expect.objectContaining({
            runtime_id: "runtime_test",
            local_project_id: "project_local_1",
            capabilities: ["local.fs.read"]
          })
        }),
        expect.objectContaining({
          url: expect.stringMatching(/\/jobs\/job_1\/events$/),
          method: "POST",
          body: expect.objectContaining({
            eventId: "event_1",
            eventType: "job.succeeded"
          })
        })
      ])
    );
    expect(acknowledgeEvent).toHaveBeenCalledWith("event_1");
    client.stop();
  });
});
