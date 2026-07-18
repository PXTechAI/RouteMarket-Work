import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopJob } from "@routemarket/work-protocol";
import {
  JobStore,
  projectBindingIdFor,
  ProjectRegistry
} from "@routemarket/work-worker-core";
import { CloudJobRuntime } from "../worker/cloud-job-runtime";
import {
  CloudWorkerClient,
  type CloudWorkerTransport
} from "./cloud-worker-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("Core to Work Desktop Job contract", () => {
  let fixtureRoot: string | null = null;
  let registry: ProjectRegistry | null = null;
  let jobStore: JobStore | null = null;
  let client: CloudWorkerClient | null = null;

  afterEach(async () => {
    client?.stop();
    jobStore?.close();
    registry?.close();
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("executes a Core-shaped mixed Workflow file Job and uploads resumable output events", async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "routemarket-core-work-contract-"));
    const projectRoot = join(fixtureRoot, "project");
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, "README.md"), "# RouteMarket Work\n", "utf8");

    const databasePath = join(fixtureRoot, "work.db");
    registry = new ProjectRegistry(databasePath);
    jobStore = new JobStore(databasePath);
    const project = await registry.bindFolder(projectRoot);
    const jobs = new CloudJobRuntime(registry, jobStore);
    const transport: CloudWorkerTransport = {
      listProjects: async () => registry!.list().map((item) => ({
        localProjectId: item.localProjectId,
        displayName: item.displayName,
        rootFingerprint: item.rootFingerprint,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      })),
      listMcpServers: async () => [],
      executeJob: (job, leaseId, leaseEpoch) =>
        jobs.executeJob({ job, leaseId, leaseEpoch }),
      cancelJob: async (jobId, leaseId, leaseEpoch) =>
        jobs.cancelJob(jobId, leaseId, leaseEpoch),
      pendingEvents: async () => jobs.pendingEvents(),
      eventsFrom: async (jobId, sequence) => jobs.eventsFrom(jobId, sequence),
      recoveryState: async () => jobs.recoveryState(),
      acknowledgeEvent: async (eventId) => jobs.acknowledgeEvent(eventId)
    };

    const desktopJob: DesktopJob = {
      jobId: "job_mixed_contract_1",
      workflowRunId: "workflow_mixed_contract_1",
      workflowNodeRunId: "workflow_node_desktop_1",
      runtimeId: "runtime_contract_1",
      projectBindingId: projectBindingIdFor(project.localProjectId),
      executorKey: "local.fs.read",
      executorVersion: 1,
      input: {
        uri: `project://${project.localProjectId}/README.md`,
        maxBytes: 65_536
      },
      requiredCapabilities: ["local.fs.read"],
      executionClass: "pure_read",
      approvalPolicy: { risk: "R0", mode: "project_grant" },
      idempotencyKey: `sha256:${"f".repeat(64)}`,
      deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      maxInlineResultBytes: 262_144
    };
    const coreJob = {
      ...desktopJob,
      status: "leased",
      leaseId: "lease_mixed_contract_1",
      leaseEpoch: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      acceptedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      output: null,
      error: null
    };
    const uploadedEvents: Array<Record<string, unknown>> = [];
    let offered = false;

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/runtimes/register")) {
        return jsonResponse({ runtime_id: desktopJob.runtimeId, manifest_revision: 0 });
      }
      if (url.endsWith("/capabilities") || url.endsWith("/projects/bind")) {
        return jsonResponse({});
      }
      if (url.includes("/jobs/offers?")) {
        if (offered) return jsonResponse({ items: [] });
        offered = true;
        return jsonResponse({ items: [coreJob] });
      }
      if (url.endsWith(`/jobs/${desktopJob.jobId}/accept`)) {
        return jsonResponse(coreJob);
      }
      if (url.endsWith(`/jobs/${desktopJob.jobId}/events`)) {
        uploadedEvents.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ acknowledged: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    client = new CloudWorkerClient({
      apiBaseUrl: "https://core.example.test",
      installationId: "install_contract_1",
      deviceName: "Contract Workstation",
      platform: "windows",
      arch: "x64",
      appVersion: "0.1.0",
      workerVersion: "0.1.0",
      workerClient: transport,
      onActivity: vi.fn(),
      socketFactory: false
    });
    client.setAccessToken("rmw_dt_contract-token");

    await client.start();

    expect(uploadedEvents.map((event) => event.eventType)).toEqual([
      "job.accepted",
      "job.started",
      "job.succeeded"
    ]);
    expect(uploadedEvents.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(uploadedEvents[2]).toMatchObject({
      jobId: desktopJob.jobId,
      runtimeId: desktopJob.runtimeId,
      leaseId: coreJob.leaseId,
      leaseEpoch: coreJob.leaseEpoch,
      data: {
        uri: desktopJob.input.uri,
        text: "# RouteMarket Work\n",
        bytesRead: 19,
        truncated: false,
        encoding: "utf8",
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      }
    });
    expect(jobStore.getStatus(desktopJob.jobId)).toBe("succeeded");
    expect(jobs.pendingEvents()).toEqual([]);
    expect(jobs.recoveryState()).toEqual([]);
  });
});
