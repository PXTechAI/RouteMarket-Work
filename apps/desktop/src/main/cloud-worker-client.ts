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
  private accessToken: string | undefined;
  private runtimeId: string | null = null;
  private manifestRevision = 0;
  private status: CloudWorkerStatus = "disabled";
  private lastError: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connecting: { generation: number; promise: Promise<void> } | null = null;
  private syncing: { generation: number; promise: Promise<void> } | null = null;
  private processingGeneration: number | null = null;
  private generation = 0;
  private started = false;
  private stopped = false;

  constructor(private readonly options: CloudWorkerOptions) {}

  getState() {
    return {
      status: this.status,
      runtimeId: this.runtimeId,
      error: this.lastError
    };
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    this.started = true;
    if (!this.accessToken) {
      this.status = "disabled";
      return;
    }
    return this.connect(this.generation);
  }

  setAccessToken(token: string | undefined): void {
    if (this.stopped || token === this.accessToken) return;

    this.generation += 1;
    this.accessToken = token;
    this.disconnect();

    if (!token) {
      this.status = "disabled";
      return;
    }

    this.status = "connecting";
    if (this.started) {
      void this.connect(this.generation);
    }
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.generation += 1;
    this.accessToken = undefined;
    this.disconnect();
    this.status = "disabled";
  }

  syncProjects(): Promise<void> {
    return this.syncProjectsForGeneration(this.generation);
  }

  private connect(generation: number): Promise<void> {
    if (!this.isActive(generation)) return Promise.resolve();
    if (this.connecting?.generation === generation) return this.connecting.promise;

    const promise = this.performConnect(generation).finally(() => {
      if (this.connecting?.generation === generation) {
        this.connecting = null;
      }
    });
    this.connecting = { generation, promise };
    return promise;
  }

  private async performConnect(generation: number): Promise<void> {
    try {
      this.clearRecurringTimers();
      this.assertActive(generation);
      this.status = "connecting";
      const runtime = await this.request<RuntimeResponse>(generation, "/runtimes/register", {
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
      this.assertActive(generation);
      this.runtimeId = runtime.runtime_id;
      this.manifestRevision = runtime.manifest_revision;
      await this.syncProjectsForGeneration(generation);
      await this.flushPendingEvents(generation);
      this.assertActive(generation);

      this.status = "online";
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.options.onActivity("cloud.connected", "Cloud Worker connected", runtime.runtime_id);
      this.heartbeatTimer = setInterval(() => void this.heartbeat(generation), 10_000);
      this.pollTimer = setInterval(() => void this.poll(generation), 2_000);
      await this.poll(generation);
    } catch (error) {
      this.handleError(error, generation);
    }
  }

  private syncProjectsForGeneration(generation: number): Promise<void> {
    if (!this.isActive(generation) || !this.runtimeId) return Promise.resolve();
    if (this.syncing?.generation === generation) return this.syncing.promise;

    const promise = this.performProjectSync(generation).finally(() => {
      if (this.syncing?.generation === generation) {
        this.syncing = null;
      }
    });
    this.syncing = { generation, promise };
    return promise;
  }

  private async performProjectSync(generation: number): Promise<void> {
    if (!this.runtimeId) return;
    const projects = await this.options.workerClient.listProjects();
    this.assertActive(generation);
    const revision = this.manifestRevision + 1;
    const bindings = projects.map((project) => ({
      project,
      bindingId: bindingIdForProject(project.localProjectId)
    }));
    await this.request(generation, `/runtimes/${this.runtimeId}/capabilities`, {
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
      await this.bindProject(generation, project, bindingId);
    }
  }

  private bindProject(
    generation: number,
    project: ProjectSummary,
    bindingId: string
  ): Promise<unknown> {
    return this.request(generation, "/projects/bind", {
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

  private async heartbeat(generation: number): Promise<void> {
    if (!this.runtimeId || !this.isActive(generation)) return;
    try {
      await this.request(generation, `/runtimes/${this.runtimeId}/heartbeat`, {
        method: "POST"
      });
      if (this.status !== "online") {
        this.status = "online";
        this.lastError = null;
      }
    } catch (error) {
      this.handleError(error, generation);
    }
  }

  private async poll(generation: number): Promise<void> {
    if (
      !this.runtimeId ||
      !this.isActive(generation) ||
      this.processingGeneration === generation
    ) {
      return;
    }
    this.processingGeneration = generation;
    try {
      await this.flushPendingEvents(generation);
      const offers = await this.request<{ items: JobResponse[] }>(
        generation,
        `/jobs/offers?runtime_id=${encodeURIComponent(this.runtimeId)}`
      );
      const offer = offers.items[0];
      if (!offer) return;

      this.options.onActivity("job.offered", "Cloud job received", offer.jobId);
      const accepted = await this.request<JobResponse>(
        generation,
        `/jobs/${offer.jobId}/accept`,
        {
          method: "POST",
          body: { runtime_id: this.runtimeId }
        }
      );
      if (!accepted.leaseId || accepted.leaseEpoch < 1) {
        throw new Error("Cloud accepted the Job without a valid lease.");
      }
      const events = await this.options.workerClient.executeJob(
        toDesktopJob(accepted),
        accepted.leaseId,
        accepted.leaseEpoch
      );
      this.assertActive(generation);
      await this.sendEvents(generation, events);
    } catch (error) {
      this.handleError(error, generation);
    } finally {
      if (this.processingGeneration === generation) {
        this.processingGeneration = null;
      }
    }
  }

  private async flushPendingEvents(generation: number): Promise<void> {
    const events = await this.options.workerClient.pendingEvents();
    this.assertActive(generation);
    await this.sendEvents(generation, events);
  }

  private async sendEvents(generation: number, events: JobEvent[]): Promise<void> {
    for (const event of events) {
      const ack = await this.request<{ acknowledged: boolean }>(
        generation,
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
      this.assertActive(generation);
      if (event.eventType === "job.succeeded") {
        this.options.onActivity("job.succeeded", "Cloud job completed", event.jobId);
      } else if (event.eventType === "job.failed") {
        this.options.onActivity("job.failed", "Cloud job failed", event.jobId);
      }
    }
  }

  private async request<TResult = unknown>(
    generation: number,
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
    } = {}
  ): Promise<TResult> {
    this.assertActive(generation);
    const accessToken = this.accessToken;
    if (!accessToken) throw new StaleConnectionError();

    const response = await fetch(`${this.options.apiBaseUrl}/api/app/v1/work${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    this.assertActive(generation);
    const payload = await response.json().catch(() => null);
    this.assertActive(generation);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : `RouteMarket Work API request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload as TResult;
  }

  private handleError(error: unknown, generation: number): void {
    if (error instanceof StaleConnectionError || !this.isActive(generation)) return;
    const message = error instanceof Error ? error.message : "Unknown cloud worker error";
    this.clearRecurringTimers();
    this.status = "error";
    this.lastError = message;
    this.options.onActivity("cloud.error", "Cloud Worker connection error", message);
    this.scheduleReconnect(generation);
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isActive(generation) || this.reconnectTimer) return;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(generation);
    }, delay);
  }

  private disconnect(): void {
    this.clearRecurringTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.runtimeId = null;
    this.manifestRevision = 0;
    this.lastError = null;
    this.reconnectAttempt = 0;
    this.connecting = null;
    this.syncing = null;
    this.processingGeneration = null;
  }

  private isActive(generation: number): boolean {
    return !this.stopped && Boolean(this.accessToken) && this.generation === generation;
  }

  private assertActive(generation: number): void {
    if (!this.isActive(generation)) throw new StaleConnectionError();
  }

  private clearRecurringTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
  }
}

class StaleConnectionError extends Error {}

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
