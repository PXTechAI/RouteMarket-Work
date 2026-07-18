import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { assertDesktopJob, type DesktopJob } from "@routemarket/work-protocol";
import type { JobEvent } from "@routemarket/work-protocol";
import {
  createLocalProjectFile,
  buildDesktopWorkflowNodeRegistry,
  ControlledProcessManager,
  executeLocalFsRead,
  FileVersionStore,
  JobStore,
  listProjectFiles,
  loadProjectContext,
  McpRegistry,
  projectBindingIdFor,
  readProjectAsset,
  ProjectRegistry,
  searchProject,
  StdioMcpHost,
  writeLocalProjectFile,
  WorkerError
} from "@routemarket/work-worker-core";
import type { ProjectSummary } from "../shared/desktop-api";

type WorkerRequest =
  | { requestId: string; type: "projects.list" }
  | { requestId: string; type: "projects.bind"; payload: { rootPath: string } }
  | { requestId: string; type: "projects.root"; payload: { localProjectId: string } }
  | { requestId: string; type: "projects.files"; payload: { localProjectId: string } }
  | {
      requestId: string;
      type: "projects.search";
      payload: { localProjectId: string; query: string };
    }
  | {
      requestId: string;
      type: "projects.context";
      payload: { localProjectId: string };
    }
  | {
      requestId: string;
      type: "projects.asset";
      payload: { localProjectId: string; relativePath: string };
    }
  | {
      requestId: string;
      type: "workflow.registry";
      payload: { localProjectId: string };
    }
  | {
      requestId: string;
      type: "local.fs.read";
      payload: { localProjectId: string; relativePath: string };
    }
  | {
      requestId: string;
      type: "local.fs.write";
      payload: {
        localProjectId: string;
        relativePath: string;
        text: string;
        expectedSha256: string;
      };
    }
  | {
      requestId: string;
      type: "local.fs.create";
      payload: { localProjectId: string; relativePath: string; text: string };
    }
  | {
      requestId: string;
      type: "versions.list";
      payload: { localProjectId: string; relativePath: string };
    }
  | {
      requestId: string;
      type: "versions.read";
      payload: { localProjectId: string; relativePath: string; versionId: string };
    }
  | {
      requestId: string;
      type: "versions.restore";
      payload: { localProjectId: string; relativePath: string; versionId: string };
    }
  | {
      requestId: string;
      type: "process.start";
      payload: { localProjectId: string; executable: string; args: string[] };
    }
  | { requestId: string; type: "process.list" }
  | { requestId: string; type: "process.stop"; payload: { processId: string } }
  | { requestId: string; type: "process.stop-all" }
  | {
      requestId: string;
      type: "mcp.install";
      payload: {
        name: string;
        transport: "stdio" | "streamable-http";
        command?: string;
        args: string[];
        url?: string;
        localProjectId: string | null;
      };
    }
  | { requestId: string; type: "mcp.list" }
  | { requestId: string; type: "mcp.start"; payload: { serverId: string } }
  | { requestId: string; type: "mcp.stop"; payload: { serverId: string } }
  | { requestId: string; type: "mcp.remove"; payload: { serverId: string } }
  | { requestId: string; type: "mcp.tools.refresh"; payload: { serverId: string } }
  | {
      requestId: string;
      type: "mcp.tool.call";
      payload: { serverId: string; name: string; args: Record<string, unknown> };
    }
  | {
      requestId: string;
      type: "job.execute";
      payload: { job: DesktopJob; leaseId: string; leaseEpoch: number };
    }
  | {
      requestId: string;
      type: "job.external.begin";
      payload: { job: DesktopJob; leaseId: string; leaseEpoch: number };
    }
  | {
      requestId: string;
      type: "job.external.complete";
      payload: {
        job: DesktopJob;
        leaseId: string;
        leaseEpoch: number;
        result: Record<string, unknown>;
      };
    }
  | {
      requestId: string;
      type: "job.external.fail";
      payload: {
        job: DesktopJob;
        leaseId: string;
        leaseEpoch: number;
        failure: { code: string; message: string };
      };
    }
  | {
      requestId: string;
      type: "job.cancel";
      payload: { jobId: string; leaseId: string; leaseEpoch: number };
    }
  | { requestId: string; type: "job.events.pending" }
  | {
      requestId: string;
      type: "job.events-from";
      payload: { jobId: string; sequence: number };
    }
  | { requestId: string; type: "job.recovery-state" }
  | { requestId: string; type: "job.event.ack"; payload: { eventId: string } };

type ParentPort = {
  on(event: "message", listener: (event: { data: WorkerRequest }) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (
  process as NodeJS.Process & { parentPort?: ParentPort }
).parentPort;
if (!parentPort) {
  throw new Error("RouteMarket Worker must run as an Electron utility process.");
}

const dataPath = process.argv[2];
if (!dataPath) {
  throw new Error("Worker data path is required.");
}
const registry = new ProjectRegistry(join(dataPath, "work.db"));
const jobStore = new JobStore(join(dataPath, "work.db"));
const processManager = new ControlledProcessManager(registry);
const mcpRegistry = new McpRegistry(join(dataPath, "work.db"));
const fileVersions = new FileVersionStore(join(dataPath, "work.db"));
const mcpHost = new StdioMcpHost(mcpRegistry, registry, dataPath);
const activeJobs = new Set<string>();

function summarizeProject(project: {
  localProjectId: string;
  displayName: string;
  rootFingerprint: string;
  createdAt: string;
  updatedAt: string;
}): ProjectSummary {
  return {
    localProjectId: project.localProjectId,
    displayName: project.displayName,
    rootFingerprint: project.rootFingerprint,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function createReadJob(localProjectId: string, relativePath: string): DesktopJob {
  const uriPath = relativePath
    .split(/[\\/]+/)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const idempotencySource = `${localProjectId}:${relativePath}:${Date.now()}`;
  return {
    jobId: `djob_${randomUUID().replaceAll("-", "")}`,
    workflowRunId: null,
    workflowNodeRunId: null,
    runtimeId: "runtime_local_preview",
    projectBindingId: projectBindingIdFor(localProjectId),
    executorKey: "local.fs.read",
    executorVersion: 1,
    input: {
      uri: `project://${localProjectId}/${uriPath}`,
      maxBytes: 262_144
    },
    requiredCapabilities: ["local.fs.read"],
    executionClass: "pure_read",
    approvalPolicy: {
      risk: "R0",
      mode: "project_grant"
    },
    idempotencyKey: `sha256:${createHash("sha256").update(idempotencySource).digest("hex")}`,
    deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    maxInlineResultBytes: 262_144
  };
}

function createJobEvent(
  job: DesktopJob,
  leaseId: string,
  leaseEpoch: number,
  seq: number,
  eventType: JobEvent["eventType"],
  data: Record<string, unknown>
): JobEvent {
  return {
    eventId: `event_${randomUUID().replaceAll("-", "")}`,
    jobId: job.jobId,
    runtimeId: job.runtimeId,
    leaseId,
    leaseEpoch,
    seq,
    eventType,
    occurredAt: new Date().toISOString(),
    data
  };
}

async function executeCloudJob(input: {
  job: DesktopJob;
  leaseId: string;
  leaseEpoch: number;
}): Promise<JobEvent[]> {
  const received = jobStore.receive(input.job);
  if (activeJobs.has(input.job.jobId)) {
    return jobStore.pendingEvents(input.job.jobId);
  }
  const execution = jobStore.beginExecution(
    input.job.jobId,
    input.leaseId,
    input.leaseEpoch
  );
  if (!execution.execute) return jobStore.pendingEvents(input.job.jobId);

  activeJobs.add(input.job.jobId);
  let nextSeq = execution.nextSeq;
  try {
    if (received.status === "received") {
      const accepted = createJobEvent(
        input.job,
        input.leaseId,
        input.leaseEpoch,
        nextSeq++,
        "job.accepted",
        {}
      );
      jobStore.commitEvent(accepted, "leased");
    }
    if (received.status === "received" || received.status === "leased") {
      const started = createJobEvent(
        input.job,
        input.leaseId,
        input.leaseEpoch,
        nextSeq++,
        "job.started",
        {}
      );
      jobStore.commitEvent(started, "running");
    }
    const result = await executeLocalFsRead(registry, input.job);
    if (jobStore.getStatus(input.job.jobId) === "canceled") {
      return jobStore.pendingEvents(input.job.jobId);
    }
    const succeeded = createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      nextSeq,
      "job.succeeded",
      result
    );
    jobStore.commitEvent(succeeded, "succeeded", result);
  } catch (error) {
    if (jobStore.getStatus(input.job.jobId) === "canceled") {
      return jobStore.pendingEvents(input.job.jobId);
    }
    const failure = {
      code: error instanceof WorkerError ? error.code : "WORKER_ERROR",
      message: error instanceof Error ? error.message : "Unknown worker error"
    };
    const failed = createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      nextSeq,
      "job.failed",
      failure
    );
    jobStore.commitEvent(failed, "failed", failure);
  } finally {
    activeJobs.delete(input.job.jobId);
  }
  return jobStore.pendingEvents(input.job.jobId);
}

function beginExternalCloudJob(input: {
  job: DesktopJob;
  leaseId: string;
  leaseEpoch: number;
}): { execute: boolean; events: JobEvent[] } {
  assertDesktopJob(input.job);
  const received = jobStore.receive(input.job);
  if (activeJobs.has(input.job.jobId)) {
    return { execute: false, events: jobStore.pendingEvents(input.job.jobId) };
  }
  if (
    received.duplicate &&
    input.job.executionClass === "external_side_effect" &&
    (received.status === "leased" || received.status === "running")
  ) {
    return { execute: false, events: jobStore.pendingEvents(input.job.jobId) };
  }
  const execution = jobStore.beginExecution(input.job.jobId, input.leaseId, input.leaseEpoch);
  if (!execution.execute) {
    return { execute: false, events: jobStore.pendingEvents(input.job.jobId) };
  }
  let nextSeq = execution.nextSeq;
  if (execution.status === "received") {
    jobStore.commitEvent(createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      nextSeq++,
      "job.accepted",
      {}
    ), "leased");
  }
  if (execution.status === "received" || execution.status === "leased") {
    jobStore.commitEvent(createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      nextSeq,
      "job.started",
      {}
    ), "running");
  }
  activeJobs.add(input.job.jobId);
  return { execute: true, events: jobStore.pendingEvents(input.job.jobId) };
}

function completeExternalCloudJob(input: {
  job: DesktopJob;
  leaseId: string;
  leaseEpoch: number;
  result: Record<string, unknown>;
}): JobEvent[] {
  try {
    if (jobStore.getStatus(input.job.jobId) === "canceled") {
      return jobStore.pendingEvents(input.job.jobId);
    }
    const state = jobStore.recoveryState().find((job) => job.jobId === input.job.jobId);
    if (!state) return jobStore.pendingEvents(input.job.jobId);
    const event = createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      state.lastProducedSeq + 1,
      "job.succeeded",
      input.result
    );
    jobStore.commitEvent(event, "succeeded", input.result);
    return jobStore.pendingEvents(input.job.jobId);
  } finally {
    activeJobs.delete(input.job.jobId);
  }
}

function failExternalCloudJob(input: {
  job: DesktopJob;
  leaseId: string;
  leaseEpoch: number;
  failure: { code: string; message: string };
}): JobEvent[] {
  try {
    if (jobStore.getStatus(input.job.jobId) === "canceled") {
      return jobStore.pendingEvents(input.job.jobId);
    }
    const state = jobStore.recoveryState().find((job) => job.jobId === input.job.jobId);
    if (!state) return jobStore.pendingEvents(input.job.jobId);
    const event = createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      state.lastProducedSeq + 1,
      "job.failed",
      input.failure
    );
    jobStore.commitEvent(event, "failed", input.failure);
    return jobStore.pendingEvents(input.job.jobId);
  } finally {
    activeJobs.delete(input.job.jobId);
  }
}

parentPort.on("message", async ({ data: request }) => {
  try {
    let result: unknown;
    if (request.type === "projects.list") {
      result = registry.list().map(summarizeProject);
    } else if (request.type === "projects.bind") {
      result = summarizeProject(await registry.bindFolder(request.payload.rootPath));
    } else if (request.type === "projects.root") {
      const project = registry.get(request.payload.localProjectId);
      if (!project) throw new WorkerError("PROJECT_NOT_FOUND", "Local project not found.");
      result = project.realRootPath;
    } else if (request.type === "projects.files") {
      result = await listProjectFiles(registry, request.payload.localProjectId);
    } else if (request.type === "projects.search") {
      result = await searchProject(
        registry,
        request.payload.localProjectId,
        request.payload.query
      );
    } else if (request.type === "projects.context") {
      result = await loadProjectContext(registry, request.payload.localProjectId);
    } else if (request.type === "projects.asset") {
      result = await readProjectAsset(
        registry,
        request.payload.localProjectId,
        request.payload.relativePath
      );
    } else if (request.type === "workflow.registry") {
      const context = await loadProjectContext(registry, request.payload.localProjectId);
      result = buildDesktopWorkflowNodeRegistry({
        mcpServers: mcpHost.list(),
        skills: context.skills
      });
    } else if (request.type === "local.fs.read") {
      result = await executeLocalFsRead(
        registry,
        createReadJob(request.payload.localProjectId, request.payload.relativePath)
      );
    } else if (request.type === "local.fs.write") {
      const before = await executeLocalFsRead(
        registry,
        createReadJob(request.payload.localProjectId, request.payload.relativePath)
      );
      const written = await writeLocalProjectFile(registry, request.payload);
      if (written.changed) {
        fileVersions.record({
          localProjectId: request.payload.localProjectId,
          relativePath: request.payload.relativePath,
          sha256: before.sha256,
          text: before.text,
          source: "baseline"
        });
        fileVersions.record({
          localProjectId: request.payload.localProjectId,
          relativePath: request.payload.relativePath,
          sha256: written.sha256,
          text: written.text,
          source: "saved"
        });
      }
      result = written;
    } else if (request.type === "local.fs.create") {
      const created = await createLocalProjectFile(registry, request.payload);
      fileVersions.record({
        localProjectId: request.payload.localProjectId,
        relativePath: request.payload.relativePath,
        sha256: created.sha256,
        text: created.text,
        source: "created"
      });
      result = created;
    } else if (request.type === "versions.list") {
      result = fileVersions.list(request.payload.localProjectId, request.payload.relativePath);
    } else if (request.type === "versions.read") {
      result = fileVersions.get(
        request.payload.localProjectId,
        request.payload.relativePath,
        request.payload.versionId
      );
    } else if (request.type === "versions.restore") {
      const version = fileVersions.get(
        request.payload.localProjectId,
        request.payload.relativePath,
        request.payload.versionId
      );
      const current = await executeLocalFsRead(
        registry,
        createReadJob(request.payload.localProjectId, request.payload.relativePath)
      );
      const restored = await writeLocalProjectFile(registry, {
        localProjectId: request.payload.localProjectId,
        relativePath: request.payload.relativePath,
        text: version.text,
        expectedSha256: current.sha256
      });
      if (restored.changed) {
        fileVersions.record({
          localProjectId: request.payload.localProjectId,
          relativePath: request.payload.relativePath,
          sha256: current.sha256,
          text: current.text,
          source: "baseline"
        });
        fileVersions.record({
          localProjectId: request.payload.localProjectId,
          relativePath: request.payload.relativePath,
          sha256: restored.sha256,
          text: restored.text,
          source: "restored"
        });
      }
      result = restored;
    } else if (request.type === "process.start") {
      result = processManager.start(request.payload);
    } else if (request.type === "process.list") {
      result = processManager.list();
    } else if (request.type === "process.stop") {
      result = await processManager.stop(request.payload.processId);
    } else if (request.type === "process.stop-all") {
      await Promise.all([processManager.stopAll(), mcpHost.stopAll()]);
      result = { stopped: true };
    } else if (request.type === "mcp.install") {
      const config = mcpRegistry.install(request.payload);
      result = mcpHost.list().find((server) => server.serverId === config.serverId);
    } else if (request.type === "mcp.list") {
      result = mcpHost.list();
    } else if (request.type === "mcp.start") {
      result = await mcpHost.start(request.payload.serverId);
    } else if (request.type === "mcp.stop") {
      result = await mcpHost.stop(request.payload.serverId);
    } else if (request.type === "mcp.remove") {
      await mcpHost.stop(request.payload.serverId);
      mcpRegistry.remove(request.payload.serverId);
      result = undefined;
    } else if (request.type === "mcp.tools.refresh") {
      result = await mcpHost.refreshTools(request.payload.serverId);
    } else if (request.type === "mcp.tool.call") {
      result = await mcpHost.callTool(
        request.payload.serverId,
        request.payload.name,
        request.payload.args
      );
    } else if (request.type === "job.execute") {
      result = await executeCloudJob(request.payload);
    } else if (request.type === "job.external.begin") {
      result = beginExternalCloudJob(request.payload);
    } else if (request.type === "job.external.complete") {
      result = completeExternalCloudJob(request.payload);
    } else if (request.type === "job.external.fail") {
      result = failExternalCloudJob(request.payload);
    } else if (request.type === "job.cancel") {
      jobStore.cancel(
        request.payload.jobId,
        request.payload.leaseId,
        request.payload.leaseEpoch
      );
      result = jobStore.pendingEvents(request.payload.jobId);
    } else if (request.type === "job.events.pending") {
      result = jobStore.pendingEvents();
    } else if (request.type === "job.events-from") {
      result = jobStore.eventsFrom(request.payload.jobId, request.payload.sequence);
    } else if (request.type === "job.recovery-state") {
      result = jobStore.recoveryState();
    } else {
      jobStore.acknowledge(request.payload.eventId);
      result = { acknowledged: true };
    }
    parentPort.postMessage({
      requestId: request.requestId,
      ok: true,
      result
    });
  } catch (error) {
    parentPort.postMessage({
      requestId: request.requestId,
      ok: false,
      error: {
        code: error instanceof WorkerError ? error.code : "WORKER_ERROR",
        message: error instanceof Error ? error.message : "Unknown worker error"
      }
    });
  }
});
