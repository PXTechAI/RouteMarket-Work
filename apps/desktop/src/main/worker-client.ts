import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";
import type {
  ProjectFileTree,
  ProjectSummary,
  ReadResult
} from "../shared/desktop-api";

type WorkerRequestInput =
  | { type: "projects.list" }
  | { type: "projects.bind"; payload: { rootPath: string } }
  | { type: "projects.files"; payload: { localProjectId: string } }
  | {
      type: "local.fs.read";
      payload: { localProjectId: string; relativePath: string };
    }
  | {
      type: "job.execute";
      payload: { job: DesktopJob; leaseId: string; leaseEpoch: number };
    }
  | { type: "job.events.pending" }
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
    this.child?.kill();
    this.child = null;
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

  listProjectFiles(localProjectId: string): Promise<ProjectFileTree> {
    return this.request<ProjectFileTree>({
      type: "projects.files",
      payload: { localProjectId }
    });
  }

  readProjectFile(localProjectId: string, relativePath: string): Promise<ReadResult> {
    return this.request<ReadResult>({
      type: "local.fs.read",
      payload: { localProjectId, relativePath }
    });
  }

  executeJob(job: DesktopJob, leaseId: string, leaseEpoch: number): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({
      type: "job.execute",
      payload: { job, leaseId, leaseEpoch }
    });
  }

  pendingEvents(): Promise<JobEvent[]> {
    return this.request<JobEvent[]>({ type: "job.events.pending" });
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
