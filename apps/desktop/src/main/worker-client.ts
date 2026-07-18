import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { DesktopJob, DesktopWorkflowNodeRegistry, JobEvent } from "@routemarket/work-protocol";
import type {
  CreateResult,
  ManagedProcessSummary,
  LocalSkillInvocationResult,
  McpServerSummary,
  ProjectAssetPreview,
  ProjectFileTree,
  ProjectFileVersion,
  ProjectFileVersionSummary,
  ProjectSearchResult,
  ProjectSummary,
  ReadResult,
  WriteResult
} from "../shared/desktop-api";
import type { JobRecoveryState } from "@routemarket/work-worker-core";
import type { ProjectContext } from "@routemarket/work-worker-core";

type WorkerRequestInput =
  | { type: "projects.list" }
  | { type: "projects.bind"; payload: { rootPath: string } }
  | { type: "projects.root"; payload: { localProjectId: string } }
  | { type: "projects.files"; payload: { localProjectId: string } }
  | { type: "projects.search"; payload: { localProjectId: string; query: string } }
  | { type: "projects.context"; payload: { localProjectId: string } }
  | {
      type: "local.skill.invoke";
      payload: { localProjectId: string; skillId: string; task: string };
    }
  | { type: "projects.asset"; payload: { localProjectId: string; relativePath: string } }
  | { type: "workflow.registry"; payload: { localProjectId: string } }
  | {
      type: "local.fs.read";
      payload: { localProjectId: string; relativePath: string };
    }
  | {
      type: "local.fs.write";
      payload: {
        localProjectId: string;
        relativePath: string;
        text: string;
        expectedSha256: string;
      };
    }
  | {
      type: "local.fs.create";
      payload: { localProjectId: string; relativePath: string; text: string };
    }
  | { type: "versions.list"; payload: { localProjectId: string; relativePath: string } }
  | {
      type: "versions.read";
      payload: { localProjectId: string; relativePath: string; versionId: string };
    }
  | {
      type: "versions.restore";
      payload: { localProjectId: string; relativePath: string; versionId: string };
    }
  | {
      type: "process.start";
      payload: { localProjectId: string; executable: string; args: string[] };
    }
  | { type: "process.list" }
  | { type: "process.stop"; payload: { processId: string } }
  | { type: "process.stop-all" }
  | {
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
  | { type: "mcp.list" }
  | { type: "mcp.start"; payload: { serverId: string } }
  | { type: "mcp.stop"; payload: { serverId: string } }
  | { type: "mcp.remove"; payload: { serverId: string } }
  | { type: "mcp.tools.refresh"; payload: { serverId: string } }
  | {
      type: "mcp.tool.call";
      payload: { serverId: string; name: string; args: Record<string, unknown> };
    }
  | {
      type: "job.execute";
      payload: { job: DesktopJob; leaseId: string; leaseEpoch: number };
    }
  | {
      type: "job.external.begin";
      payload: { job: DesktopJob; leaseId: string; leaseEpoch: number };
    }
  | {
      type: "job.external.approval";
      payload: {
        job: DesktopJob;
        leaseId: string;
        leaseEpoch: number;
        eventType: "approval.requested" | "approval.resolved";
        data: Record<string, unknown>;
      };
    }
  | {
      type: "job.external.complete";
      payload: {
        job: DesktopJob;
        leaseId: string;
        leaseEpoch: number;
        result: Record<string, unknown>;
      };
    }
  | {
      type: "job.external.fail";
      payload: {
        job: DesktopJob;
        leaseId: string;
        leaseEpoch: number;
        failure: { code: string; message: string };
      };
    }
  | { type: "job.cancel"; payload: { jobId: string; leaseId: string; leaseEpoch: number } }
  | { type: "job.events.pending" }
  | { type: "job.events-from"; payload: { jobId: string; sequence: number } }
  | { type: "job.recovery-state" }
  | { type: "job.event.ack"; payload: { eventId: string } };

type WorkerRequest = WorkerRequestInput & { requestId: string };

type WorkerResponse =
  | { requestId: string; ok: true; result: unknown }
  | { requestId: string; ok: false; error: { code: string; message: string } };

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export class WorkerClient {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly userDataPath: string) {}

  start(): void {
    if (this.child) return;
    const workerPath = join(__dirname, "worker.js");
    const child = utilityProcess.fork(workerPath, [this.userDataPath], {
      serviceName: "RouteMarket Work Worker",
      stdio: "pipe"
    });
    child.on("message", (message: WorkerResponse) => this.handleMessage(message));
    child.on("exit", () => {
      this.child = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("RouteMarket Worker stopped."));
      }
      this.pending.clear();
    });
    this.child = child;
  }

  stop(): void {
    const child = this.child;
    if (!child) return;
    void this.request<{ stopped: true }>({ type: "process.stop-all" })
      .catch(() => undefined)
      .finally(() => {
        if (this.child === child) {
          child.kill();
          this.child = null;
        }
      });
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.request<ProjectSummary[]>({ type: "projects.list" });
  }

  bindProject(rootPath: string): Promise<ProjectSummary> {
    return this.request<ProjectSummary>({
      type: "projects.bind",
      payload: { rootPath }
    });
  }

  projectRoot(localProjectId: string): Promise<string> {
    return this.request<string>({ type: "projects.root", payload: { localProjectId } });
  }

  listProjectFiles(localProjectId: string): Promise<ProjectFileTree> {
    return this.request<ProjectFileTree>({
      type: "projects.files",
      payload: { localProjectId }
    });
  }

  searchProject(localProjectId: string, query: string): Promise<ProjectSearchResult> {
    return this.request<ProjectSearchResult>({
      type: "projects.search",
      payload: { localProjectId, query }
    });
  }

  projectContext(localProjectId: string): Promise<ProjectContext> {
    return this.request<ProjectContext>({
      type: "projects.context",
      payload: { localProjectId }
    });
  }

  invokeProjectSkill(
    localProjectId: string,
    skillId: string,
    task: string
  ): Promise<LocalSkillInvocationResult> {
    return this.request<LocalSkillInvocationResult>({
      type: "local.skill.invoke",
      payload: { localProjectId, skillId, task }
    });
  }

  workflowNodeRegistry(localProjectId: string): Promise<DesktopWorkflowNodeRegistry> {
    return this.request<DesktopWorkflowNodeRegistry>({
      type: "workflow.registry",
      payload: { localProjectId }
    });
  }

  readProjectFile(localProjectId: string, relativePath: string): Promise<ReadResult> {
    return this.request<ReadResult>({
      type: "local.fs.read",
      payload: { localProjectId, relativePath }
    });
  }

  readProjectAsset(localProjectId: string, relativePath: string): Promise<ProjectAssetPreview> {
    return this.request<ProjectAssetPreview>({
      type: "projects.asset",
      payload: { localProjectId, relativePath }
    });
  }

  writeProjectFile(
    localProjectId: string,
    relativePath: string,
    text: string,
    expectedSha256: string
  ): Promise<WriteResult> {
    return this.request<WriteResult>({
      type: "local.fs.write",
      payload: { localProjectId, relativePath, text, expectedSha256 }
    });
  }

  createProjectFile(
    localProjectId: string,
    relativePath: string,
    text: string
  ): Promise<CreateResult> {
    return this.request<CreateResult>({
      type: "local.fs.create",
      payload: { localProjectId, relativePath, text }
    });
  }

  listProjectFileVersions(
    localProjectId: string,
    relativePath: string
  ): Promise<ProjectFileVersionSummary[]> {
    return this.request<ProjectFileVersionSummary[]>({
      type: "versions.list",
      payload: { localProjectId, relativePath }
    });
  }

  readProjectFileVersion(
    localProjectId: string,
    relativePath: string,
    versionId: string
  ): Promise<ProjectFileVersion> {
    return this.request<ProjectFileVersion>({
      type: "versions.read",
      payload: { localProjectId, relativePath, versionId }
    });
  }

  restoreProjectFileVersion(
    localProjectId: string,
    relativePath: string,
    versionId: string
  ): Promise<WriteResult> {
    return this.request<WriteResult>({
      type: "versions.restore",
      payload: { localProjectId, relativePath, versionId }
    });
  }

  startProcess(
    localProjectId: string,
    executable: string,
    args: string[]
  ): Promise<ManagedProcessSummary> {
    return this.request<ManagedProcessSummary>({
      type: "process.start",
      payload: { localProjectId, executable, args }
    });
  }

  listProcesses(): Promise<ManagedProcessSummary[]> {
    return this.request<ManagedProcessSummary[]>({ type: "process.list" });
  }

  stopProcess(processId: string): Promise<ManagedProcessSummary> {
    return this.request<ManagedProcessSummary>({
      type: "process.stop",
      payload: { processId }
    });
  }

  installMcpServer(input: {
    name: string;
    transport: "stdio" | "streamable-http";
    command?: string;
    args: string[];
    url?: string;
    localProjectId: string | null;
  }): Promise<McpServerSummary> {
    return this.request<McpServerSummary>({ type: "mcp.install", payload: input });
  }

  listMcpServers(): Promise<McpServerSummary[]> {
    return this.request<McpServerSummary[]>({ type: "mcp.list" });
  }

  startMcpServer(serverId: string): Promise<McpServerSummary> {
    return this.request<McpServerSummary>({ type: "mcp.start", payload: { serverId } });
  }

  stopMcpServer(serverId: string): Promise<McpServerSummary> {
    return this.request<McpServerSummary>({ type: "mcp.stop", payload: { serverId } });
  }

  removeMcpServer(serverId: string): Promise<void> {
    return this.request<void>({ type: "mcp.remove", payload: { serverId } });
  }

  refreshMcpTools(serverId: string): Promise<McpServerSummary> {
    return this.request<McpServerSummary>({
      type: "mcp.tools.refresh",
      payload: { serverId }
    });
  }

  callMcpTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      type: "mcp.tool.call",
      payload: { serverId, name, args }
    });
  }

  executeJob(job: DesktopJob, leaseId: string, leaseEpoch: number): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.execute",
      payload: { job, leaseId, leaseEpoch }
    });
  }

  beginExternalJob(
    job: DesktopJob,
    leaseId: string,
    leaseEpoch: number
  ): Promise<{ execute: boolean; events: JobEvent[] }> {
    return this.request<{ execute: boolean; events: JobEvent[] }>({
      type: "job.external.begin",
      payload: { job, leaseId, leaseEpoch }
    });
  }

  recordExternalApproval(
    job: DesktopJob,
    leaseId: string,
    leaseEpoch: number,
    eventType: "approval.requested" | "approval.resolved",
    data: Record<string, unknown>
  ): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.external.approval",
      payload: { job, leaseId, leaseEpoch, eventType, data }
    });
  }

  completeExternalJob(
    job: DesktopJob,
    leaseId: string,
    leaseEpoch: number,
    result: Record<string, unknown>
  ): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.external.complete",
      payload: { job, leaseId, leaseEpoch, result }
    });
  }

  failExternalJob(
    job: DesktopJob,
    leaseId: string,
    leaseEpoch: number,
    failure: { code: string; message: string }
  ): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.external.fail",
      payload: { job, leaseId, leaseEpoch, failure }
    });
  }

  cancelJob(jobId: string, leaseId: string, leaseEpoch: number): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.cancel",
      payload: { jobId, leaseId, leaseEpoch }
    });
  }

  pendingEvents(): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({ type: "job.events.pending" });
  }

  eventsFrom(jobId: string, sequence: number): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.events-from",
      payload: { jobId, sequence }
    });
  }

  recoveryState(): Promise<JobRecoveryState[]> {
    return this.request<JobRecoveryState[]>({ type: "job.recovery-state" });
  }

  acknowledgeEvent(eventId: string): Promise<{ acknowledged: true }> {
    return this.request<{ acknowledged: true }>({
      type: "job.event.ack",
      payload: { eventId }
    });
  }

  private request<TResult>(
    input: WorkerRequestInput
  ): Promise<TResult> {
    this.start();
    const requestId = `request_${randomUUID().replaceAll("-", "")}`;
    const request = { ...input, requestId } as WorkerRequest;
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("RouteMarket Worker request timed out."));
      }, 30_000);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer
      });
      this.child?.postMessage(request);
    });
  }

  private handleMessage(message: WorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    const error = new Error(message.error.message);
    Object.assign(error, { code: message.error.code });
    pending.reject(error);
  }
}
