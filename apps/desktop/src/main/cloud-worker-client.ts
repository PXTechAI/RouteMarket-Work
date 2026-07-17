import { createHash } from "node:crypto";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";
import type { ActivityItem, CloudWorkerStatus, ProjectSummary } from "../shared/desktop-api";
import type { WorkerClient } from "./worker-client";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export type CloudWorkerTransport = Pick<
  WorkerClient,
  "listProjects" | "executeJob" | "pendingEvents" | "acknowledgeEvent"
>;

type CloudWorkerOptions = {
  apiBaseUrl: string;
  sessionToken: string | undefined;
  installationId: string;
  deviceName: string;
  platform: "windows" | "macos";
  arch: "x64" | "arm64";
  appVersion: string;
  workerVersion: string;
  workerClient: CloudWorkerTransport;
  onActivity: (kind: ActivityItem["kind"], title: string, detail: string) => void;
};

type RuntimeResponse = {
  runtime_id: string;
  manifest_revision: number;
};

type JobResponse = DesktopJob & {
  leaseId: string | null;
  leaseEpoch: number;
};

export class CloudWorkerClient {
  private runtimeId: string | null = null;
  private manifestRevision = 0;
  private status: CloudWorkerStatus;
  private lastError: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connecting: Promise<void> | null = null;
  private processing = false;
  private syncing: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly options: CloudWorkerOptions) {
    this.status = options.sessionToken ? "connecting" : "disabled";
  }

  getState() {
    return {
      status: this.status,
      runtimeId: this.runtimeId,
      error: this.lastError
    };
  }

  async start(): Promise<void> {
    if (!this.options.sessionToken || this.stopped) return;
    return this.connect();
  }

  private connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.performConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async performConnect(): Promise<void> {
    try {
      this.clearRecurringTimers();
      this.status = "connecting";
      const runtime = await this.request<RuntimeResponse>("/runtimes/register", {
        method: "POST",
        body: {
          installation_id: this.options.installationId,
          device_name: this.options.deviceName,
          platform: this.options.platform,
          arch: this.options.arch,
          app_version: this.options.appVersion,
          worker_version: this.options.workerVersion,
          protocol_version: "routemarket-work/1"
        }
      });
      this.runtimeId = runtime.runtime_id;
      this.manifestRevision = runtime.manifest_revision;
      await this.syncProjects();
      await this.flushPendingEvents();
      this.status = "online";
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.options.onActivity("cloud.connected", "云端 Worker 已连接", runtime.runtime_id);
      this.heartbeatTimer = setInterval(() => void this.heartbeat(), 10_000);
      this.pollTimer = setInterval(() => void this.poll(), 2_000);
      await this.poll();
    } catch (error) {
      this.handleError(error);
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearRecurringTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  syncProjects(): Promise<void> {
    if (!this.options.sessionToken || !this.runtimeId) return Promise.resolve();
    if (this.syncing) return this.syncing;
    this.syncing = this.performProjectSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async performProjectSync(): Promise<void> {
    if (!this.runtimeId) return;
    const projects = await this.options.workerClient.listProjects();
    const revision = this.manifestRevision + 1;
    const bindings = projects.map((project) => ({
      project,
      bindingId: bindingIdForProject(project.localProjectId)
    }));
    await this.request(`/runtimes/${this.runtimeId}/capabilities`, {
      method: "PUT",
      body: {
        schemaVersion: 1,
        revision,
        generatedAt: new Date().toISOString(),
        runtime: {
          platform: this.options.platform,
          arch: this.options.arch,
          appVersion: this.options.appVersion,
          workerVersion: this.options.workerVersion
        },
        limits: {
          maxConcurrentJobs: 1,
          maxInlineResultBytes: 262_144
        },
        capabilities: [
          {
            key: "local.fs.read",
            version: 1,
            risk: "R0",
            operations: ["read_text", "stat", "list"]
          }
        ],
        projects: bindings.map(({ project, bindingId }) => ({
          projectBindingId: bindingId,
          localProjectId: project.localProjectId,
          access: ["read"],
          rootFingerprint: project.rootFingerprint
        })),
        mcpServers: []
      }
    });
    this.manifestRevision = revision;
    for (const { project, bindingId } of bindings) {
      await this.bindProject(project, bindingId);
    }
  }

  private bindProject(project: ProjectSummary, bindingId: string) {
    return this.request("/projects/bind", {
      method: "POST",
      body: {
        runtime_id: this.runtimeId,
        binding_id: bindingId,
        local_project_id: project.localProjectId,
        display_name: project.displayName,
        root_fingerprint: project.rootFingerprint,
        capabilities: ["local.fs.read"]
      }
    });
  }

  private async heartbeat(): Promise<void> {
    if (!this.runtimeId || this.stopped) return;
    try {
      await this.request(`/runtimes/${this.runtimeId}/heartbeat`, { method: "POST" });
      if (this.status !== "online") {
        this.status = "online";
        this.lastError = null;
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private async poll(): Promise<void> {
    if (!this.runtimeId || this.processing || this.stopped) return;
    this.processing = true;
    try {
      await this.flushPendingEvents();
      const offers = await this.request<{ items: JobResponse[] }>(
        `/jobs/offers?runtime_id=${encodeURIComponent(this.runtimeId)}`
      );
      const offer = offers.items[0];
      if (!offer) return;
      this.options.onActivity("job.offered", "收到云端任务", offer.jobId);
      const accepted = await this.request<JobResponse>(`/jobs/${offer.jobId}/accept`, {
        method: "POST",
        body: { runtime_id: this.runtimeId }
      });
      if (!accepted.leaseId || accepted.leaseEpoch < 1) {
        throw new Error("Cloud accepted the Job without a valid lease.");
      }
      const events = await this.options.workerClient.executeJob(
        toDesktopJob(accepted),
        accepted.leaseId,
        accepted.leaseEpoch
      );
      await this.sendEvents(events);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.processing = false;
    }
  }

  private async flushPendingEvents(): Promise<void> {
    const events = await this.options.workerClient.pendingEvents();
    await this.sendEvents(events);
  }

  private async sendEvents(events: JobEvent[]): Promise<void> {
    for (const event of events) {
      const ack = await this.request<{ acknowledged: boolean }>(
        `/jobs/${event.jobId}/events`,
        {
          method: "POST",
          body: {
            eventId: event.eventId,
            jobId: event.jobId,
            runtimeId: event.runtimeId,
            leaseId: event.leaseId,
            leaseEpoch: event.leaseEpoch,
            sequence: event.seq,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            data: event.data
          }
        }
      );
      if (!ack.acknowledged) {
        throw new Error(`Cloud did not acknowledge event ${event.eventId}.`);
      }
      await this.options.workerClient.acknowledgeEvent(event.eventId);
      if (event.eventType === "job.succeeded") {
        this.options.onActivity("job.succeeded", "云端任务完成", event.jobId);
      } else if (event.eventType === "job.failed") {
        this.options.onActivity("job.failed", "云端任务失败", event.jobId);
      }
    }
  }

  private async request<TResult = unknown>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
    } = {}
  ): Promise<TResult> {
    const response = await fetch(`${this.options.apiBaseUrl}/api/app/v1/work${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.options.sessionToken}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : `RouteMarket Work API request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload as TResult;
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown cloud worker error";
    this.clearRecurringTimers();
    this.status = "error";
    this.lastError = message;
    this.options.onActivity("cloud.error", "云端 Worker 连接异常", message);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.options.sessionToken) return;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearRecurringTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
  }
}

function bindingIdForProject(localProjectId: string) {
  return `binding_${createHash("sha256").update(localProjectId).digest("hex").slice(0, 32)}`;
}

function toDesktopJob(job: JobResponse): DesktopJob {
  return {
    jobId: job.jobId,
    workflowRunId: job.workflowRunId,
    workflowNodeRunId: job.workflowNodeRunId,
    runtimeId: job.runtimeId,
    projectBindingId: job.projectBindingId,
    executorKey: "local.fs.read",
    executorVersion: 1,
    input: job.input,
    requiredCapabilities: ["local.fs.read"],
    executionClass: "pure_read",
    approvalPolicy: {
      risk: "R0",
      mode: "project_grant"
    },
    idempotencyKey: job.idempotencyKey,
    deadlineAt: job.deadlineAt,
    maxInlineResultBytes: job.maxInlineResultBytes
  };
}
