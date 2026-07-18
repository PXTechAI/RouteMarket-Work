import { randomUUID } from "node:crypto";
import {
  assertDesktopJob,
  checkEnvelope,
  WORK_PROTOCOL,
  type DesktopJob,
  type JobEvent,
  type WorkEnvelope
} from "@routemarket/work-protocol";
import { projectBindingIdFor, type JobRecoveryState } from "@routemarket/work-worker-core";
import WebSocket, { type RawData } from "ws";
import type { ActivityItem, CloudWorkerStatus, ProjectSummary } from "../shared/desktop-api";
import type { WorkerClient } from "./worker-client";
import { redactCloudData } from "./cloud-redaction";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export type CloudWorkerTransport = Pick<
  WorkerClient,
  | "listProjects"
  | "executeJob"
  | "listMcpServers"
  | "cancelJob"
  | "pendingEvents"
  | "eventsFrom"
  | "recoveryState"
  | "acknowledgeEvent"
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
  executeDesktopJob?: (
    job: DesktopJob,
    leaseId: string,
    leaseEpoch: number,
    signal: AbortSignal,
    emitEvents: (events: JobEvent[]) => Promise<void>
  ) => Promise<JobEvent[]>;
  socketFactory?: false | ((url: string, accessToken: string) => WebSocket);
};

type RuntimeResponse = {
  runtime_id: string;
  manifest_revision: number;
};

type JobResponse = DesktopJob & {
  leaseId: string | null;
  leaseEpoch: number;
  status?: string;
  leaseExpiresAt?: string | null;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  output?: unknown;
  error?: unknown;
};

type ReconcileAction = {
  action: "continue" | "resend_from_seq" | "cancel" | "reconcile" | "forget";
  resendFromSeq?: number;
  leaseId?: string;
  leaseEpoch?: number;
};

class CloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

export class CloudWorkerClient {
  private accessToken: string | undefined;
  private runtimeId: string | null = null;
  private manifestRevision = 0;
  private status: CloudWorkerStatus = "disabled";
  private lastError: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private socketReconnectTimer: NodeJS.Timeout | null = null;
  private socketReconnectAttempt = 0;
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private connecting: { generation: number; promise: Promise<void> } | null = null;
  private syncing: { generation: number; promise: Promise<void> } | null = null;
  private processingGeneration: number | null = null;
  private readonly activeExternalJobs = new Map<string, AbortController>();
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
    for (const controller of this.activeExternalJobs.values()) controller.abort();
    this.activeExternalJobs.clear();
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
      await this.reconcileJobs(generation);
      await this.flushPendingEvents(generation);
      this.assertActive(generation);

      this.status = "online";
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.options.onActivity("cloud.connected", "Cloud Worker connected", runtime.runtime_id);
      this.heartbeatTimer = setInterval(() => void this.heartbeat(generation), 10_000);
      this.pollTimer = setInterval(() => void this.poll(generation), 2_000);
      this.openRuntimeChannel(generation);
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
    const mcpServers = await this.options.workerClient.listMcpServers();
    this.assertActive(generation);
    const revision = this.manifestRevision + 1;
    const bindings = projects.map((project) => ({
      project,
      bindingId: projectBindingIdFor(project.localProjectId)
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
          },
          { key: "local.browser.navigate", version: 1, risk: "R1", operations: ["navigate"] },
          { key: "local.browser.click", version: 1, risk: "R2", operations: ["click"] },
          { key: "local.browser.type", version: 1, risk: "R2", operations: ["type"] },
          { key: "local.browser.extract", version: 1, risk: "R0", operations: ["extract"] },
          { key: "local.browser.screenshot", version: 1, risk: "R0", operations: ["screenshot"] },
          { key: "local.mcp.call", version: 1, risk: "R2", operations: ["call"] },
          { key: "local.skill.invoke", version: 1, risk: "R0", operations: ["invoke"] },
          { key: "local.app.open", version: 1, risk: "R2", operations: ["open"] },
          { key: "desktop.trigger.file_changed", version: 1, risk: "R1", operations: ["watch"] },
          { key: "desktop.trigger.folder_added", version: 1, risk: "R1", operations: ["watch"] },
          { key: "desktop.trigger.schedule", version: 1, risk: "R1", operations: ["schedule"] },
          { key: "desktop.trigger.hotkey", version: 1, risk: "R2", operations: ["register"] }
        ],
        projects: bindings.map(({ project, bindingId }) => ({
          projectBindingId: bindingId,
          localProjectId: project.localProjectId,
          access: ["read"],
          rootFingerprint: project.rootFingerprint
        })),
        mcpServers: mcpServers.map((server) => ({
          serverId: server.serverId,
          name: server.name,
          transport: server.transport,
          status: server.status,
          projectBindingId: server.localProjectId
            ? projectBindingIdFor(server.localProjectId)
            : null,
          tools: server.tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }))
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
        capabilities: [
          "local.fs.read",
          "local.browser.navigate",
          "local.browser.click",
          "local.browser.type",
          "local.browser.extract",
          "local.browser.screenshot",
          "local.mcp.call",
          "local.skill.invoke",
          "local.app.open",
          "desktop.trigger.file_changed",
          "desktop.trigger.folder_added",
          "desktop.trigger.schedule",
          "desktop.trigger.hotkey"
        ]
      }
    });
  }

  private async heartbeat(generation: number): Promise<void> {
    if (!this.runtimeId || !this.isActive(generation)) return;
    try {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendSocketEnvelope(this.socket, "runtime.heartbeat", {
          runtimeId: this.runtimeId,
          manifestRevision: this.manifestRevision
        });
      } else {
        await this.request(generation, `/runtimes/${this.runtimeId}/heartbeat`, {
          method: "POST"
        });
      }
      if (
        this.status !== "online" &&
        (this.options.socketFactory === false || this.socket?.readyState === WebSocket.OPEN)
      ) {
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
      await this.processOffer(generation, offer);
    } catch (error) {
      this.handleError(error, generation);
    } finally {
      if (this.processingGeneration === generation) {
        this.processingGeneration = null;
      }
    }
  }

  private async processOffer(generation: number, offer: JobResponse): Promise<void> {
    if (!this.runtimeId) return;
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
    if (accepted.runtimeId !== this.runtimeId) {
      throw new Error("Cloud returned a Job assigned to another Runtime.");
    }
    const job = toDesktopJob(accepted);
    let events: JobEvent[];
    if (job.executorKey === "local.fs.read" || job.executorKey === "local.skill.invoke") {
      events = await this.options.workerClient.executeJob(job, accepted.leaseId, accepted.leaseEpoch);
    } else if (this.options.executeDesktopJob) {
      const controller = new AbortController();
      this.activeExternalJobs.set(job.jobId, controller);
      try {
        events = await this.options.executeDesktopJob(
          job,
          accepted.leaseId,
          accepted.leaseEpoch,
          controller.signal,
          (nextEvents) => this.sendEvents(generation, nextEvents)
        );
      } finally {
        if (this.activeExternalJobs.get(job.jobId) === controller) {
          this.activeExternalJobs.delete(job.jobId);
        }
      }
    } else {
      throw new Error(`Desktop executor is unavailable: ${job.executorKey}`);
    }
    this.assertActive(generation);
    await this.sendEvents(generation, events);
  }

  private async reconcileJobs(generation: number): Promise<void> {
    const jobs = await this.options.workerClient.recoveryState();
    this.assertActive(generation);
    for (const job of jobs) {
      const response = await this.request<ReconcileAction>(
        generation,
        `/jobs/${job.jobId}/reconcile`,
        { method: "POST", body: recoveryPayload(job, this.runtimeId) }
      );
      await this.applyReconcileAction(generation, job, response);
    }
  }

  private async applyReconcileAction(
    generation: number,
    job: JobRecoveryState,
    response: ReconcileAction
  ): Promise<void> {
    if (response.action === "cancel") {
      const leaseId = response.leaseId ?? job.leaseId;
      const leaseEpoch = response.leaseEpoch ?? job.leaseEpoch;
      if (!leaseId || leaseEpoch < 1) {
        throw new Error(`Cloud requested cancellation without a valid lease for ${job.jobId}.`);
      }
      const events = await this.options.workerClient.cancelJob(job.jobId, leaseId, leaseEpoch);
      await this.sendEvents(generation, events);
      await this.sendCancelAck(generation, job.jobId, leaseId, leaseEpoch);
      return;
    }
    if (response.action === "resend_from_seq") {
      const from = response.resendFromSeq;
      if (!Number.isInteger(from) || (from ?? 0) < 1) {
        throw new Error(`Cloud returned an invalid resend sequence for ${job.jobId}.`);
      }
      const events = await this.options.workerClient.eventsFrom(job.jobId, from!);
      await this.sendEvents(generation, events);
    }
  }

  private openRuntimeChannel(generation: number): void {
    if (!this.runtimeId || !this.accessToken || !this.isActive(generation)) return;
    if (this.options.socketFactory === false) return;
    const socketUrl = new URL(`${this.options.apiBaseUrl}/api/app/v1/work/runtime-channel`);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    const factory = this.options.socketFactory ?? ((url: string, token: string) => new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` }
    }));
    const socket = factory(socketUrl.toString(), this.accessToken);
    this.socket = socket;
    socket.on("open", () => void this.onSocketOpen(socket, generation));
    socket.on("message", (data) => void this.onSocketMessage(socket, generation, data));
    socket.on("error", (error) => {
      if (this.socket === socket) this.lastError = error.message;
    });
    socket.on("close", () => this.onSocketClose(socket, generation));
  }

  private async onSocketOpen(socket: WebSocket, generation: number): Promise<void> {
    if (this.socket !== socket || !this.runtimeId || !this.isActive(generation)) {
      socket.close();
      return;
    }
    this.socketReconnectAttempt = 0;
    this.status = "online";
    this.lastError = null;
    this.sendSocketEnvelope(socket, "runtime.hello", {
      runtimeId: this.runtimeId,
      protocolVersion: WORK_PROTOCOL,
      manifestRevision: this.manifestRevision
    });
    const activeJobs = await this.options.workerClient.recoveryState();
    if (this.socket !== socket || !this.isActive(generation)) return;
    this.sendSocketEnvelope(socket, "runtime.resume", {
      runtimeId: this.runtimeId,
      connectionNonce: `nonce_${randomUUID().replaceAll("-", "")}`,
      manifestRevision: this.manifestRevision,
      activeJobs
    });
  }

  private async onSocketMessage(
    socket: WebSocket,
    generation: number,
    raw: RawData
  ): Promise<void> {
    if (this.socket !== socket || !this.isActive(generation)) return;
    let envelope: WorkEnvelope;
    try {
      envelope = JSON.parse(raw.toString()) as WorkEnvelope;
    } catch {
      socket.close(1002, "Invalid JSON envelope");
      return;
    }
    if (!checkEnvelope(envelope).ok) {
      socket.close(1002, "Invalid protocol envelope");
      return;
    }
    try {
      if (envelope.type === "runtime.ping") {
        this.sendSocketEnvelope(socket, "runtime.pong", {
          runtimeId: this.runtimeId,
          pingMessageId: envelope.messageId
        });
      } else if (envelope.type === "runtime.capability_refresh") {
        await this.syncProjectsForGeneration(generation);
      } else if (envelope.type === "job.offer") {
        const payload = envelope.payload.job && typeof envelope.payload.job === "object"
          ? envelope.payload.job as JobResponse
          : envelope.payload as JobResponse;
        if (this.processingGeneration === generation) return;
        this.processingGeneration = generation;
        try {
          await this.processOffer(generation, payload);
        } finally {
          if (this.processingGeneration === generation) this.processingGeneration = null;
        }
      } else if (envelope.type === "job.cancel") {
        await this.handleRemoteCancel(generation, envelope.payload);
      } else if (envelope.type === "job.event_ack") {
        const eventId = String(envelope.payload.eventId ?? "");
        if (eventId) await this.options.workerClient.acknowledgeEvent(eventId);
      } else if (envelope.type === "job.event_nack") {
        const jobId = String(envelope.payload.jobId ?? "");
        const from = Number(envelope.payload.resendFromSeq);
        if (jobId && Number.isInteger(from) && from > 0) {
          await this.sendEvents(generation, await this.options.workerClient.eventsFrom(jobId, from));
        }
      } else if (envelope.type === "auth.expiring") {
        this.options.onActivity("cloud.error", "Cloud authentication expiring", "Token refresh required");
      }
    } catch (error) {
      this.handleError(error, generation);
    }
  }

  private async handleRemoteCancel(
    generation: number,
    payload: Record<string, unknown>
  ): Promise<void> {
    const jobId = String(payload.jobId ?? "");
    const leaseId = String(payload.leaseId ?? "");
    const leaseEpoch = Number(payload.leaseEpoch);
    if (!jobId || !leaseId || !Number.isInteger(leaseEpoch) || leaseEpoch < 1) {
      throw new Error("Cloud sent an invalid Job cancellation command.");
    }
    this.activeExternalJobs.get(jobId)?.abort();
    const events = await this.options.workerClient.cancelJob(jobId, leaseId, leaseEpoch);
    await this.sendEvents(generation, events);
    await this.sendCancelAck(generation, jobId, leaseId, leaseEpoch);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendSocketEnvelope(this.socket, "job.cancel_ack", { jobId, leaseId, leaseEpoch });
    }
  }

  private sendCancelAck(
    generation: number,
    jobId: string,
    leaseId: string,
    leaseEpoch: number
  ): Promise<unknown> {
    return this.request(generation, `/jobs/${jobId}/cancel-ack`, {
      method: "POST",
      body: { runtime_id: this.runtimeId, lease_id: leaseId, lease_epoch: leaseEpoch }
    });
  }

  private sendSocketEnvelope(
    socket: WebSocket,
    type: WorkEnvelope["type"],
    payload: Record<string, unknown>
  ): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      protocol: WORK_PROTOCOL,
      messageId: `msg_${randomUUID().replaceAll("-", "")}`,
      type,
      sentAt: new Date().toISOString(),
      payload
    } satisfies WorkEnvelope));
  }

  private onSocketClose(socket: WebSocket, generation: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    if (!this.isActive(generation)) return;
    this.status = "degraded";
    this.lastError ??= "Runtime channel disconnected; HTTPS fallback remains active.";
    this.options.onActivity("cloud.error", "Runtime channel disconnected", this.lastError);
    this.scheduleSocketReconnect(generation);
  }

  private scheduleSocketReconnect(generation: number): void {
    if (!this.isActive(generation) || this.socketReconnectTimer) return;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.socketReconnectAttempt,
      MAX_RECONNECT_DELAY_MS
    );
    this.socketReconnectAttempt += 1;
    this.socketReconnectTimer = setTimeout(() => {
      this.socketReconnectTimer = null;
      this.openRuntimeChannel(generation);
    }, delay);
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
            data: redactCloudData(event.data)
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
      } else if (event.eventType === "job.canceled") {
        this.options.onActivity("job.canceled", "Cloud job canceled", event.jobId);
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
      throw new CloudApiError(response.status, message);
    }
    return payload as TResult;
  }

  private handleError(error: unknown, generation: number): void {
    if (error instanceof StaleConnectionError || !this.isActive(generation)) return;
    const message = error instanceof Error ? error.message : "Unknown cloud worker error";
    if (error instanceof CloudApiError && (error.status === 401 || error.status === 403)) {
      this.generation += 1;
      for (const controller of this.activeExternalJobs.values()) controller.abort();
      this.activeExternalJobs.clear();
      this.disconnect();
      this.status = "access_required";
      this.lastError = message;
      this.options.onActivity("cloud.error", "Cloud access requires attention", message);
      return;
    }
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
    if (this.socketReconnectTimer) clearTimeout(this.socketReconnectTimer);
    this.reconnectTimer = null;
    this.socketReconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.close();
    this.runtimeId = null;
    this.manifestRevision = 0;
    this.lastError = null;
    this.reconnectAttempt = 0;
    this.socketReconnectAttempt = 0;
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

function toDesktopJob(job: JobResponse): DesktopJob {
  const desktopJob = {
    jobId: job.jobId,
    ...(job.workflowRunId !== undefined ? { workflowRunId: job.workflowRunId } : {}),
    ...(job.workflowNodeRunId !== undefined
      ? { workflowNodeRunId: job.workflowNodeRunId }
      : {}),
    runtimeId: job.runtimeId,
    projectBindingId: job.projectBindingId,
    executorKey: job.executorKey,
    executorVersion: job.executorVersion,
    input: job.input,
    requiredCapabilities: job.requiredCapabilities,
    executionClass: job.executionClass,
    approvalPolicy: job.approvalPolicy,
    idempotencyKey: job.idempotencyKey,
    deadlineAt: job.deadlineAt,
    maxInlineResultBytes: job.maxInlineResultBytes
  };
  assertDesktopJob(desktopJob);
  return desktopJob;
}

function recoveryPayload(job: JobRecoveryState, runtimeId: string | null) {
  return {
    runtimeId,
    leaseId: job.leaseId,
    leaseEpoch: job.leaseEpoch,
    localStatus: job.localStatus,
    lastProducedSeq: job.lastProducedSeq,
    lastAckedSeq: job.lastAckedSeq
  };
}
