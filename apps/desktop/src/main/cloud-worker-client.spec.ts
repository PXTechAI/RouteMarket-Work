import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";
import WebSocket from "ws";
import {
  CloudWorkerClient,
  type CloudWorkerTransport
} from "./cloud-worker-client";

const runtimeResponse = {
  runtime_id: "runtime_test",
  manifest_revision: 0
};

class MockRuntimeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];

  send(value: string): void {
    this.sent.push(value);
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  receive(value: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

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
    listMcpServers: vi.fn(async () => []),
    cancelJob: vi.fn(async () => []),
    pendingEvents: vi.fn(async () => []),
    eventsFrom: vi.fn(async () => []),
    recoveryState: vi.fn(async () => []),
    acknowledgeEvent: vi.fn(async () => ({ acknowledged: true as const })),
    ...overrides
  };
}

function createClient(
  workerClient: CloudWorkerTransport,
  onActivity = vi.fn(),
  executeDesktopJob?: (
    job: DesktopJob,
    leaseId: string,
    leaseEpoch: number,
    signal: AbortSignal,
    emitEvents: (events: JobEvent[]) => Promise<void>
  ) => Promise<JobEvent[]>
): CloudWorkerClient {
  return new CloudWorkerClient({
    apiBaseUrl: "https://api.example.test",
    installationId: "install_test",
    deviceName: "Test Workstation",
    platform: "windows",
    arch: "x64",
    appVersion: "0.1.0",
    workerVersion: "0.1.0",
    workerClient,
    onActivity,
    executeDesktopJob,
    socketFactory: false
  });
}

function signIn(client: CloudWorkerClient, token = "rmw_dt_test-token") {
  client.setAccessToken(token);
  return client.start();
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

    await signIn(client);
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

    await signIn(client);
    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    "requires new cloud access and stops reconnecting after HTTP %s",
    async (status) => {
      const message =
        status === 401
          ? "Desktop access token is no longer valid."
          : "Desktop runtime has been revoked.";
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message }, status));
      vi.stubGlobal("fetch", fetchMock);
      const onActivity = vi.fn();
      const client = createClient(createWorker(), onActivity);

      await signIn(client);

      expect(client.getState()).toEqual({
        status: "access_required",
        runtimeId: null,
        error: message
      });
      expect(onActivity).toHaveBeenCalledWith(
        "cloud.error",
        "Cloud access requires attention",
        message
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      client.stop();
    }
  );

  it("recovers from access_required after the access token is replaced", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === "Bearer rmw_dt_revoked") {
        return jsonResponse({ message: "Desktop runtime has been revoked." }, 403);
      }
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.includes("/jobs/offers?")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(createWorker());

    await signIn(client, "rmw_dt_revoked");
    expect(client.getState()).toMatchObject({
      status: "access_required",
      error: "Desktop runtime has been revoked."
    });

    client.setAccessToken("rmw_dt_reauthorized");
    await vi.waitFor(() => {
      expect(client.getState()).toEqual({
        status: "online",
        runtimeId: "runtime_test",
        error: null
      });
    });
    client.stop();
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

    await signIn(client);

    const capabilityRequest = requests.find(({ url }) => url.endsWith("/capabilities"));
    expect(capabilityRequest).toMatchObject({
      method: "PUT",
      body: {
        revision: 1,
        capabilities: expect.arrayContaining([
          {
            key: "local.fs.read",
            version: 1,
            risk: "R0",
            operations: ["read_text", "stat", "list"]
          },
          expect.objectContaining({ key: "local.skill.invoke", risk: "R0" }),
          expect.objectContaining({ key: "local.browser.navigate", risk: "R1" }),
          expect.objectContaining({ key: "local.browser.upload", risk: "R3" }),
          expect.objectContaining({ key: "local.mcp.call", risk: "R2" })
        ]),
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
            capabilities: expect.arrayContaining([
              "local.fs.read",
              "local.skill.invoke",
              "local.browser.navigate",
              "local.browser.upload",
              "local.mcp.call"
            ])
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

  it("routes local Skill Desktop Jobs directly through the Worker runtime", async () => {
    const skillJob: DesktopJob = {
      jobId: "job_skill_1",
      workflowRunId: "workflow_skill_1",
      workflowNodeRunId: "workflow_node_skill_1",
      runtimeId: "runtime_test",
      projectBindingId: "binding_skill_1",
      executorKey: "local.skill.invoke",
      executorVersion: 1,
      input: { skillId: "review", task: "Review the current changes." },
      requiredCapabilities: ["local.skill.invoke"],
      executionClass: "pure_read",
      approvalPolicy: { risk: "R0", mode: "project_grant" },
      idempotencyKey: `sha256:${"d".repeat(64)}`,
      deadlineAt: "2026-07-19T00:00:00.000Z",
      maxInlineResultBytes: 65_536
    };
    const accepted = { ...skillJob, leaseId: "lease_skill_1", leaseEpoch: 1 };
    const succeeded: JobEvent = {
      eventId: "event_skill_1",
      jobId: skillJob.jobId,
      runtimeId: skillJob.runtimeId,
      leaseId: "lease_skill_1",
      leaseEpoch: 1,
      seq: 3,
      eventType: "job.succeeded",
      occurredAt: "2026-07-18T00:00:00.000Z",
      data: { output: { skillId: "review" } }
    };
    const executeJob = vi.fn(async () => [succeeded]);
    const executeDesktopJob = vi.fn(async () => []);
    const worker = createWorker({ executeJob });
    let offered = false;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.includes("/jobs/offers?")) {
        if (offered) return jsonResponse({ items: [] });
        offered = true;
        return jsonResponse({ items: [accepted] });
      }
      if (url.endsWith("/jobs/job_skill_1/accept")) return jsonResponse(accepted);
      if (url.endsWith("/jobs/job_skill_1/events")) return jsonResponse({ acknowledged: true });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = createClient(worker, vi.fn(), executeDesktopJob);

    await signIn(client);

    expect(executeJob).toHaveBeenCalledWith(skillJob, "lease_skill_1", 1);
    expect(executeDesktopJob).not.toHaveBeenCalled();
    client.stop();
  });

  it("strips Core Job state fields before protocol validation and Worker execution", async () => {
    const desktopJob: DesktopJob = {
      jobId: "job_core_contract_1",
      workflowRunId: "workflow_core_contract_1",
      workflowNodeRunId: "workflow_node_core_contract_1",
      runtimeId: "runtime_test",
      projectBindingId: "binding_core_contract_1",
      executorKey: "local.fs.read",
      executorVersion: 1,
      input: {
        uri: "project://project_core_contract_1/README.md",
        maxBytes: 65_536
      },
      requiredCapabilities: ["local.fs.read"],
      executionClass: "pure_read",
      approvalPolicy: { risk: "R0", mode: "project_grant" },
      idempotencyKey: `sha256:${"e".repeat(64)}`,
      deadlineAt: "2026-07-19T00:00:00.000Z",
      maxInlineResultBytes: 262_144
    };
    const coreFormattedJob = {
      ...desktopJob,
      status: "leased",
      leaseId: "lease_core_contract_1",
      leaseEpoch: 1,
      leaseExpiresAt: "2026-07-18T00:01:00.000Z",
      acceptedAt: "2026-07-18T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      output: null,
      error: null
    };
    const succeeded: JobEvent = {
      eventId: "event_core_contract_1",
      jobId: desktopJob.jobId,
      runtimeId: desktopJob.runtimeId,
      leaseId: coreFormattedJob.leaseId,
      leaseEpoch: coreFormattedJob.leaseEpoch,
      seq: 3,
      eventType: "job.succeeded",
      occurredAt: "2026-07-18T00:00:01.000Z",
      data: {
        uri: desktopJob.input.uri,
        text: "# RouteMarket",
        bytesRead: 13,
        truncated: false,
        encoding: "utf8"
      }
    };
    const executeJob = vi.fn(async () => [succeeded]);
    const worker = createWorker({ executeJob });
    let offered = false;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.includes("/jobs/offers?")) {
        if (offered) return jsonResponse({ items: [] });
        offered = true;
        return jsonResponse({ items: [coreFormattedJob] });
      }
      if (url.endsWith(`/jobs/${desktopJob.jobId}/accept`)) {
        return jsonResponse(coreFormattedJob);
      }
      if (url.endsWith(`/jobs/${desktopJob.jobId}/events`)) {
        return jsonResponse({ acknowledged: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = createClient(worker);

    await signIn(client);

    expect(executeJob).toHaveBeenCalledWith(
      desktopJob,
      coreFormattedJob.leaseId,
      coreFormattedJob.leaseEpoch
    );
    client.stop();
  });

  it("routes non-filesystem Desktop Jobs through the approved main-process executor", async () => {
    const browserJob: DesktopJob = {
      jobId: "job_browser_1",
      workflowRunId: "workflow_run_1",
      workflowNodeRunId: "workflow_node_1",
      runtimeId: "runtime_test",
      projectBindingId: "binding_test_1",
      executorKey: "local.browser.navigate",
      executorVersion: 1,
      input: { url: "https://example.com" },
      requiredCapabilities: ["local.browser.navigate"],
      executionClass: "external_side_effect",
      approvalPolicy: { risk: "R1", mode: "invocation" },
      idempotencyKey: `sha256:${"a".repeat(64)}`,
      deadlineAt: "2026-07-19T00:00:00.000Z",
      maxInlineResultBytes: 65_536
    };
    const accepted = { ...browserJob, leaseId: "lease_browser_1", leaseEpoch: 1 };
    const succeeded: JobEvent = {
      eventId: "event_browser_1",
      jobId: browserJob.jobId,
      runtimeId: browserJob.runtimeId,
      leaseId: "lease_browser_1",
      leaseEpoch: 1,
      seq: 3,
      eventType: "job.succeeded",
      occurredAt: "2026-07-18T00:00:00.000Z",
      data: { url: "https://example.com/" }
    };
    const executeDesktopJob = vi.fn(async () => [succeeded]);
    const worker = createWorker();
    let offered = false;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.includes("/jobs/offers?")) {
        if (offered) return jsonResponse({ items: [] });
        offered = true;
        return jsonResponse({ items: [accepted] });
      }
      if (url.endsWith("/jobs/job_browser_1/accept")) return jsonResponse(accepted);
      if (url.endsWith("/jobs/job_browser_1/events")) return jsonResponse({ acknowledged: true });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = createClient(worker, vi.fn(), executeDesktopJob);

    await signIn(client);

    expect(executeDesktopJob).toHaveBeenCalledWith(
      browserJob,
      "lease_browser_1",
      1,
      expect.any(AbortSignal),
      expect.any(Function)
    );
    expect(worker.executeJob).not.toHaveBeenCalled();
    client.stop();
  });

  it("applies an offline cancellation during reconnect and acknowledges its durable event", async () => {
    const canceledEvent: JobEvent = {
      eventId: "event_cancel_1",
      jobId: "job_cancel_1",
      runtimeId: "runtime_test",
      leaseId: "lease_cancel_2",
      leaseEpoch: 2,
      seq: 3,
      eventType: "job.canceled",
      occurredAt: "2026-07-17T00:00:00.000Z",
      data: {}
    };
    const cancelJob = vi.fn(async () => [canceledEvent]);
    const acknowledgeEvent = vi.fn(async () => ({ acknowledged: true as const }));
    const worker = createWorker({
      recoveryState: vi.fn(async () => [{
        jobId: "job_cancel_1",
        leaseId: "lease_cancel_1",
        leaseEpoch: 1,
        localStatus: "running" as const,
        lastProducedSeq: 2,
        lastAckedSeq: 2
      }]),
      cancelJob,
      acknowledgeEvent
    });
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.endsWith("/jobs/job_cancel_1/reconcile")) {
        return jsonResponse({
          action: "cancel",
          leaseId: "lease_cancel_2",
          leaseEpoch: 2
        });
      }
      if (url.endsWith("/jobs/job_cancel_1/events")) return jsonResponse({ acknowledged: true });
      if (url.endsWith("/jobs/job_cancel_1/cancel-ack")) return jsonResponse({ acknowledged: true });
      if (url.includes("/jobs/offers?")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = createClient(worker);

    await signIn(client);

    expect(cancelJob).toHaveBeenCalledWith("job_cancel_1", "lease_cancel_2", 2);
    expect(acknowledgeEvent).toHaveBeenCalledWith("event_cancel_1");
    expect(requests.findIndex((url) => url.endsWith("/reconcile"))).toBeLessThan(
      requests.findIndex((url) => url.endsWith("/cancel-ack"))
    );
    client.stop();
  });

  it("resends only the requested unacknowledged sequence range during reconciliation", async () => {
    const events: JobEvent[] = [1, 2, 3].map((seq) => ({
      eventId: `event_resend_${seq}`,
      jobId: "job_resend_1",
      runtimeId: "runtime_test",
      leaseId: "lease_resend_1",
      leaseEpoch: 1,
      seq,
      eventType: seq === 3 ? "job.succeeded" : seq === 1 ? "job.accepted" : "job.started",
      occurredAt: "2026-07-17T00:00:00.000Z",
      data: {}
    }));
    const worker = createWorker({
      recoveryState: vi.fn(async () => [{
        jobId: "job_resend_1",
        leaseId: "lease_resend_1",
        leaseEpoch: 1,
        localStatus: "succeeded" as const,
        lastProducedSeq: 3,
        lastAckedSeq: 1
      }]),
      pendingEvents: vi.fn(async () => events),
      eventsFrom: vi.fn(async (_jobId, sequence) =>
        events.filter((event) => event.seq >= sequence)
      )
    });
    const sentSequences: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.endsWith("/jobs/job_resend_1/reconcile")) {
        return jsonResponse({ action: "resend_from_seq", resendFromSeq: 2 });
      }
      if (url.endsWith("/jobs/job_resend_1/events")) {
        sentSequences.push(JSON.parse(String(init?.body)).sequence);
        return jsonResponse({ acknowledged: true });
      }
      if (url.includes("/jobs/offers?")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = createClient(worker);

    await signIn(client);

    expect(sentSequences.slice(0, 2)).toEqual([2, 3]);
    client.stop();
  });

  it("authenticates the runtime channel, resumes state, responds to ping and handles cancellation", async () => {
    const socket = new MockRuntimeSocket();
    const socketFactory = vi.fn(() => socket as unknown as WebSocket);
    const canceledEvent: JobEvent = {
      eventId: "event_socket_cancel",
      jobId: "job_socket_1",
      runtimeId: "runtime_test",
      leaseId: "lease_socket_1",
      leaseEpoch: 1,
      seq: 1,
      eventType: "job.canceled",
      occurredAt: "2026-07-17T00:00:00.000Z",
      data: {}
    };
    const cancelJob = vi.fn(async () => [canceledEvent]);
    const worker = createWorker({ cancelJob });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.endsWith("/jobs/job_socket_1/events")) return jsonResponse({ acknowledged: true });
      if (url.endsWith("/jobs/job_socket_1/cancel-ack")) return jsonResponse({ acknowledged: true });
      if (url.includes("/jobs/offers?")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = new CloudWorkerClient({
      apiBaseUrl: "https://api.example.test",
      installationId: "install_test",
      deviceName: "Test Workstation",
      platform: "windows",
      arch: "x64",
      appVersion: "0.1.0",
      workerVersion: "0.1.0",
      workerClient: worker,
      onActivity: vi.fn(),
      socketFactory
    });

    await signIn(client, "socket-token");
    expect(socketFactory).toHaveBeenCalledWith(
      "wss://api.example.test/api/app/v1/work/runtime-channel",
      "socket-token"
    );
    socket.open();
    await vi.waitFor(() => {
      const types = socket.sent.map((message) => JSON.parse(message).type);
      expect(types).toEqual(expect.arrayContaining(["runtime.hello", "runtime.resume"]));
    });
    socket.receive({
      protocol: "routemarket-work/1",
      messageId: "msg_ping_123",
      type: "runtime.ping",
      sentAt: "2026-07-17T00:00:00.000Z",
      payload: {}
    });
    socket.receive({
      protocol: "routemarket-work/1",
      messageId: "msg_cancel_123",
      type: "job.cancel",
      sentAt: "2026-07-17T00:00:00.000Z",
      payload: { jobId: "job_socket_1", leaseId: "lease_socket_1", leaseEpoch: 1 }
    });
    await vi.waitFor(() => expect(cancelJob).toHaveBeenCalledWith(
      "job_socket_1",
      "lease_socket_1",
      1
    ));
    await vi.waitFor(() => {
      const types = socket.sent.map((message) => JSON.parse(message).type);
      expect(types).toEqual(expect.arrayContaining(["runtime.pong", "job.cancel_ack"]));
    });
    client.stop();
  });

  it("aborts an external Desktop executor when WSS cancellation wins during approval", async () => {
    const socket = new MockRuntimeSocket();
    const browserJob: DesktopJob = {
      jobId: "job_abort_browser",
      workflowRunId: "workflow_abort_1",
      workflowNodeRunId: "node_abort_1",
      runtimeId: "runtime_test",
      projectBindingId: "binding_abort_1",
      executorKey: "local.browser.click",
      executorVersion: 1,
      input: { selector: "#submit" },
      requiredCapabilities: ["local.browser.click"],
      executionClass: "external_side_effect",
      approvalPolicy: { risk: "R2", mode: "invocation" },
      idempotencyKey: `sha256:${"c".repeat(64)}`,
      deadlineAt: "2026-07-19T00:00:00.000Z",
      maxInlineResultBytes: 65_536
    };
    const accepted = { ...browserJob, leaseId: "lease_abort_1", leaseEpoch: 1 };
    const canceled: JobEvent = {
      eventId: "event_abort_cancel",
      jobId: browserJob.jobId,
      runtimeId: browserJob.runtimeId,
      leaseId: "lease_abort_1",
      leaseEpoch: 1,
      seq: 3,
      eventType: "job.canceled",
      occurredAt: "2026-07-18T00:00:00.000Z",
      data: {}
    };
    const worker = createWorker({ cancelJob: vi.fn(async () => [canceled]) });
    let observedSignal: AbortSignal | null = null;
    const executeDesktopJob = vi.fn(async (
      _job: DesktopJob,
      _leaseId: string,
      _leaseEpoch: number,
      signal: AbortSignal,
      _emitEvents: (events: JobEvent[]) => Promise<void>
    ) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return [];
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) return jsonResponse(runtimeResponse);
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.includes("/jobs/offers?")) return jsonResponse({ items: [] });
      if (url.endsWith(`/jobs/${browserJob.jobId}/accept`)) return jsonResponse(accepted);
      if (url.endsWith(`/jobs/${browserJob.jobId}/events`)) return jsonResponse({ acknowledged: true });
      if (url.endsWith(`/jobs/${browserJob.jobId}/cancel-ack`)) return jsonResponse({ acknowledged: true });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const client = new CloudWorkerClient({
      apiBaseUrl: "https://api.example.test",
      installationId: "install_test",
      deviceName: "Test Workstation",
      platform: "windows",
      arch: "x64",
      appVersion: "0.1.0",
      workerVersion: "0.1.0",
      workerClient: worker,
      executeDesktopJob,
      onActivity: vi.fn(),
      socketFactory: () => socket as unknown as WebSocket
    });
    await signIn(client);
    socket.open();
    socket.receive({
      protocol: "routemarket-work/1",
      messageId: "msg_offer_abort",
      type: "job.offer",
      sentAt: "2026-07-18T00:00:00.000Z",
      payload: accepted
    });
    await vi.waitFor(() => expect(executeDesktopJob).toHaveBeenCalledOnce());
    socket.receive({
      protocol: "routemarket-work/1",
      messageId: "msg_cancel_abort",
      type: "job.cancel",
      sentAt: "2026-07-18T00:00:01.000Z",
      payload: { jobId: browserJob.jobId, leaseId: "lease_abort_1", leaseEpoch: 1 }
    });
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    client.stop();
  });

  it("connects after sign-in and disables immediately after sign-out", async () => {
    let resolveRegistration: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveRegistration = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(createWorker());

    await client.start();
    expect(client.getState()).toMatchObject({
      status: "disabled",
      runtimeId: null
    });

    client.setAccessToken("rmw_dt_first");
    expect(client.getState().status).toBe("connecting");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer rmw_dt_first"
    });

    client.setAccessToken(undefined);
    expect(client.getState()).toEqual({
      status: "disabled",
      runtimeId: null,
      error: null
    });

    resolveRegistration?.(jsonResponse(runtimeResponse));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getState()).toEqual({
      status: "disabled",
      runtimeId: null,
      error: null
    });
    client.stop();
  });

  it("uses a rotated token without allowing the old connection to become online", async () => {
    let resolveFirstRegistration: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (url.endsWith("/runtimes/register") && authorization === "Bearer rmw_dt_first") {
        return new Promise<Response>((resolve) => {
          resolveFirstRegistration = resolve;
        });
      }
      if (url.endsWith("/runtimes/register") && authorization === "Bearer rmw_dt_second") {
        return jsonResponse({ runtime_id: "runtime_second", manifest_revision: 0 });
      }
      if (url.endsWith("/capabilities")) return jsonResponse({});
      if (url.includes("/jobs/offers?")) return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(createWorker());

    client.setAccessToken("rmw_dt_first");
    void client.start();
    await Promise.resolve();
    client.setAccessToken("rmw_dt_second");
    await vi.waitFor(() => {
      expect(client.getState()).toMatchObject({
        status: "online",
        runtimeId: "runtime_second"
      });
    });

    resolveFirstRegistration?.(jsonResponse(runtimeResponse));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getState()).toMatchObject({
      status: "online",
      runtimeId: "runtime_second"
    });
    client.stop();
  });
});
