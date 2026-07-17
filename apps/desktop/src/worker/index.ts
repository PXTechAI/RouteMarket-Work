import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DesktopJob } from "@routemarket/work-protocol";
import type { JobEvent } from "@routemarket/work-protocol";
import {
  executeLocalFsRead,
  JobStore,
  listProjectFiles,
  ProjectRegistry,
  WorkerError
} from "@routemarket/work-worker-core";
import type { ProjectSummary } from "../shared/desktop-api";

type WorkerRequest =
  | { requestId: string; type: "projects.list" }
  | { requestId: string; type: "projects.bind"; payload: { rootPath: string } }
  | { requestId: string; type: "projects.files"; payload: { localProjectId: string } }
  | {
      requestId: string;
      type: "local.fs.read";
      payload: { localProjectId: string; relativePath: string };
    }
  | {
      requestId: string;
      type: "job.execute";
      payload: { job: DesktopJob; leaseId: string; leaseEpoch: number };
    }
  | { requestId: string; type: "job.events.pending" }
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
    projectBindingId: `binding_${localProjectId}`,
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
  if (
    received.duplicate &&
    (received.status === "succeeded" ||
      received.status === "failed" ||
      received.status === "canceled")
  ) {
    return jobStore.pendingEvents(input.job.jobId);
  }

  const accepted = createJobEvent(
    input.job,
    input.leaseId,
    input.leaseEpoch,
    1,
    "job.accepted",
    {}
  );
  jobStore.commitEvent(accepted, "leased");

  const started = createJobEvent(
    input.job,
    input.leaseId,
    input.leaseEpoch,
    2,
    "job.started",
    {}
  );
  jobStore.commitEvent(started, "running");

  try {
    const result = await executeLocalFsRead(registry, input.job);
    const succeeded = createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      3,
      "job.succeeded",
      result
    );
    jobStore.commitEvent(succeeded, "succeeded", result);
  } catch (error) {
    const failure = {
      code: error instanceof WorkerError ? error.code : "WORKER_ERROR",
      message: error instanceof Error ? error.message : "Unknown worker error"
    };
    const failed = createJobEvent(
      input.job,
      input.leaseId,
      input.leaseEpoch,
      3,
      "job.failed",
      failure
    );
    jobStore.commitEvent(failed, "failed", failure);
  }
  return jobStore.pendingEvents(input.job.jobId);
}

parentPort.on("message", async ({ data: request }) => {
  try {
    let result: unknown;
    if (request.type === "projects.list") {
      result = registry.list().map(summarizeProject);
    } else if (request.type === "projects.bind") {
      result = summarizeProject(await registry.bindFolder(request.payload.rootPath));
    } else if (request.type === "projects.files") {
      result = await listProjectFiles(registry, request.payload.localProjectId);
    } else if (request.type === "local.fs.read") {
      result = await executeLocalFsRead(
        registry,
        createReadJob(request.payload.localProjectId, request.payload.relativePath)
      );
    } else if (request.type === "job.execute") {
      result = await executeCloudJob(request.payload);
    } else if (request.type === "job.events.pending") {
      result = jobStore.pendingEvents();
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
