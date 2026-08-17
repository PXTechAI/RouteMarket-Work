import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type {
  ChatModel,
  LocalApiGatewayRoute,
  LocalApiGatewayRouteInput,
  LocalApiGatewayState,
  LocalApiGatewayUpdate,
  LocalApiGatewayUsage
} from "../shared/desktop-api";
import { modelProviderRequestHeaders, type ResolvedModelProvider } from "./model-provider-store";
import type { RouteMarketApiClient } from "./routemarket-api-client";

type GatewayConfig = {
  version: 1;
  enabled: boolean;
  port: number;
  token: string;
  routes: LocalApiGatewayRoute[];
};

type EncryptedGatewayFile = { version: 1; encrypted: string };

type LocalApiGatewayOptions = {
  filePath: string;
  listModels(): Promise<ChatModel[]>;
  resolveExternalModel(code: string): Promise<ResolvedModelProvider | null>;
  getApiClient(): RouteMarketApiClient | null;
  recordUsage?(record: LocalApiGatewayUsage): Promise<void>;
  listUsage?(limit: number): Promise<LocalApiGatewayUsage[]>;
};

const DEFAULT_PORT = 17480;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

type TargetRuntimeHealth = {
  consecutiveFailures: number;
  openUntil: number;
  lastStatus: number | null;
};

type GatewayTextProtocol = "chat" | "responses" | "anthropic";

export class LocalApiGateway {
  private config: GatewayConfig = defaultConfig();
  private server: Server | null = null;
  private requestCount = 0;
  private lastRequestAt: string | null = null;
  private lastError: string | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly targetHealth = new Map<string, TargetRuntimeHealth>();
  private readonly roundRobinCursor = new Map<string, number>();

  constructor(private readonly options: LocalApiGatewayOptions) {}

  async initialize(): Promise<LocalApiGatewayState> {
    this.config = await this.read();
    if (this.config.enabled) {
      await this.start().catch((error) => {
        this.lastError = errorMessage(error);
      });
    }
    return this.getState();
  }

  getState(): LocalApiGatewayState {
    return {
      enabled: this.config.enabled,
      port: this.config.port,
      running: this.server?.listening === true,
      baseUrl: `http://127.0.0.1:${this.config.port}/v1`,
      token: this.config.token,
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
      lastError: this.lastError,
      routes: this.config.routes.map((route) => ({ ...route, targets: [...route.targets] })),
      targetHealth: [...this.targetHealth.entries()].map(([model, health]) => ({
        model,
        consecutiveFailures: health.consecutiveFailures,
        openUntil: health.openUntil > Date.now() ? new Date(health.openUntil).toISOString() : null,
        lastStatus: health.lastStatus
      }))
    };
  }

  async update(input: LocalApiGatewayUpdate): Promise<LocalApiGatewayState> {
    return this.mutate(async () => {
      const nextPort = input.port === undefined ? this.config.port : normalizePort(input.port);
      const nextEnabled = input.enabled ?? this.config.enabled;
      const shouldRestart = this.server !== null && (nextPort !== this.config.port || !nextEnabled);
      if (shouldRestart) await this.stop();
      this.config = {
        version: 1,
        enabled: nextEnabled,
        port: nextPort,
        token: input.rotateToken ? createToken() : this.config.token,
        routes: this.config.routes
      };
      await this.write(this.config);
      this.lastError = null;
      if (this.config.enabled && !this.server) {
        try {
          await this.start();
        } catch (error) {
          this.lastError = errorMessage(error);
          throw error;
        }
      }
      return this.getState();
    });
  }

  async close(): Promise<void> {
    await this.stop();
  }

  async saveRoute(input: LocalApiGatewayRouteInput): Promise<LocalApiGatewayState> {
    return this.mutate(async () => {
      const route = normalizeRoute(input, input.id
        ? this.config.routes.find((item) => item.id === input.id)?.id
        : undefined);
      this.config.routes = [...this.config.routes.filter((item) => item.id !== route.id), route].slice(-50);
      await this.write(this.config);
      return this.getState();
    });
  }

  async removeRoute(routeId: string): Promise<LocalApiGatewayState> {
    return this.mutate(async () => {
      if (!/^route_[a-f0-9]{32}$/.test(routeId)) throw new Error("Invalid local route identifier.");
      this.config.routes = this.config.routes.filter((route) => route.id !== routeId);
      await this.write(this.config);
      return this.getState();
    });
  }

  async listUsage(limit = 50): Promise<LocalApiGatewayUsage[]> {
    if (this.options.listUsage) return this.options.listUsage(limit);
    const raw = await readFile(`${this.options.filePath}.usage.jsonl`, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return raw.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(200, Math.floor(limit)))).flatMap((line) => {
      try {
        return [JSON.parse(line) as LocalApiGatewayUsage];
      } catch {
        return [];
      }
    }).reverse();
  }

  private async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        if (!response.headersSent) writeJson(response, 500, { error: { message: errorMessage(error), type: "gateway_error" } });
        else response.destroy(error instanceof Error ? error : undefined);
      });
    });
    server.requestTimeout = 10 * 60_000;
    server.headersTimeout = 30_000;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.config.port, "127.0.0.1");
    });
    this.server = server;
  }

  private async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setSecurityHeaders(response);
    if (!validHost(request.headers.host, this.config.port)) {
      writeJson(response, 400, { error: { message: "Invalid local gateway host.", type: "invalid_request_error" } });
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.config.port}`);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      writeJson(response, 200, { status: "ok", service: "routemarket-local-gateway" });
      return;
    }
    if (!authorized(request, this.config.token)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      writeJson(response, 401, { error: { message: "Invalid local gateway token.", type: "authentication_error" } });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      await this.handleModels(response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      await this.handleTextRequest(request, response, "chat");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/responses") {
      await this.handleTextRequest(request, response, "responses");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/messages") {
      await this.handleTextRequest(request, response, "anthropic");
      return;
    }
    writeJson(response, 404, { error: { message: "Local gateway route not found.", type: "invalid_request_error" } });
  }

  private async handleModels(response: ServerResponse): Promise<void> {
    const models = await this.options.listModels();
    writeJson(response, 200, {
      object: "list",
      data: models.map((model) => ({
        id: publicModelId(model),
        object: "model",
        created: 0,
        owned_by: model.source === "routemarket" ? "routemarket" : `byok:${model.providerName}`,
        name: model.displayName,
        capabilities: {
          tools: model.supportsTools,
          vision: model.supportsVision,
          streaming: model.supportsStream
        }
      })).concat(this.config.routes.map((route) => ({
        id: routeModelId(route.id),
        object: "model",
        created: 0,
        owned_by: "routemarket:local-route",
        name: route.name,
        capabilities: { tools: true, vision: true, streaming: true }
      })))
    });
  }

  private async handleTextRequest(request: IncomingMessage, response: ServerResponse, protocol: GatewayTextProtocol): Promise<void> {
    const body = await readJsonBody(request);
    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!requestedModel) {
      writeJson(response, 400, { error: { message: "model is required.", type: "invalid_request_error" } });
      return;
    }
    const models = await this.options.listModels();
    const route = this.config.routes.find((candidate) => routeModelId(candidate.id) === requestedModel);
    const model = route ? null : models.find((candidate) => publicModelId(candidate) === requestedModel || candidate.code === requestedModel);
    if (!model && !route) {
      writeJson(response, 404, { error: { message: `Unknown model: ${requestedModel}`, type: "invalid_request_error" } });
      return;
    }
    this.requestCount += 1;
    this.lastRequestAt = new Date().toISOString();
    const upstream = route
      ? await this.requestRoute(route, models, body, request, protocol)
      : await this.requestSingleModel(model!, body, request, requestedModel, null, protocol);
    await pipeFetchResponse(upstream, response);
  }

  private async requestRoute(route: LocalApiGatewayRoute, models: ChatModel[], body: Record<string, unknown>, request: IncomingMessage, protocol: GatewayTextProtocol): Promise<Response> {
    let lastResponse: Response | null = null;
    let lastError: unknown = null;
    const targets = this.orderedRouteTargets(route);
    for (const [targetIndex, target] of targets.entries()) {
      const model = models.find((candidate) => publicModelId(candidate) === target || candidate.code === target);
      if (!model) continue;
      try {
        const response = await this.requestSingleModel(model, body, request, routeModelId(route.id), route.id, protocol);
        lastResponse = response;
        if (!retryableStatus(response.status)) {
          this.markTargetSuccess(target, response.status);
          return response;
        }
        this.markTargetFailure(target, response.status);
        if (targetIndex < targets.length - 1) {
          await response.body?.cancel().catch(() => undefined);
        }
      } catch (error) {
        this.markTargetFailure(target, null);
        lastError = error;
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError instanceof Error ? lastError : new Error("No available model in this local route.");
  }

  private orderedRouteTargets(route: LocalApiGatewayRoute): string[] {
    const now = Date.now();
    const available = route.targets.filter((target) => (this.targetHealth.get(target)?.openUntil ?? 0) <= now);
    const candidates = available.length ? available : [...route.targets].sort((left, right) =>
      (this.targetHealth.get(left)?.openUntil ?? 0) - (this.targetHealth.get(right)?.openUntil ?? 0)
    );
    if (route.strategy !== "round-robin" || candidates.length < 2) return candidates;
    const cursor = this.roundRobinCursor.get(route.id) ?? 0;
    this.roundRobinCursor.set(route.id, (cursor + 1) % candidates.length);
    const start = cursor % candidates.length;
    return [...candidates.slice(start), ...candidates.slice(0, start)];
  }

  private markTargetFailure(target: string, status: number | null): void {
    const current = this.targetHealth.get(target) ?? { consecutiveFailures: 0, openUntil: 0, lastStatus: null };
    const consecutiveFailures = current.consecutiveFailures + 1;
    this.targetHealth.set(target, {
      consecutiveFailures,
      openUntil: consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_COOLDOWN_MS : 0,
      lastStatus: status
    });
  }

  private markTargetSuccess(target: string, status: number): void {
    this.targetHealth.set(target, { consecutiveFailures: 0, openUntil: 0, lastStatus: status });
  }

  private async requestSingleModel(model: ChatModel, body: Record<string, unknown>, request: IncomingMessage, requestedModel: string, routeId: string | null, protocol: GatewayTextProtocol): Promise<Response> {
    const startedAt = Date.now();
    try {
      const response = protocol === "responses"
        ? model.source === "external"
          ? await this.requestExternalResponses(model, body, request)
          : await this.requestRouteMarketResponses(model, body, request)
        : protocol === "anthropic"
          ? model.source === "external"
            ? await this.requestExternalAnthropic(model, body, request)
            : jsonResponse(501, "This RouteMarket account model does not support the native Anthropic Messages protocol.")
          : model.source === "external"
            ? await this.requestExternal(model, body, request)
            : await this.requestRouteMarket(model, body, request);
      await this.recordUsage({
        id: randomUUID(),
        source: "local_gateway",
        kind: usageKind(protocol),
        providerId: model.providerId,
        providerName: model.providerName,
        requestedModel,
        resolvedModel: publicModelId(model),
        routeId,
        status: response.status,
        durationMs: Date.now() - startedAt,
        success: response.ok,
        createdAt: new Date().toISOString()
      });
      return response;
    } catch (error) {
      await this.recordUsage({
        id: randomUUID(),
        source: "local_gateway",
        kind: usageKind(protocol),
        providerId: model.providerId,
        providerName: model.providerName,
        requestedModel,
        resolvedModel: publicModelId(model),
        routeId,
        status: null,
        durationMs: Date.now() - startedAt,
        success: false,
        createdAt: new Date().toISOString()
      });
      throw error;
    }
  }

  private async requestExternal(model: ChatModel, body: Record<string, unknown>, request: IncomingMessage): Promise<Response> {
    const resolved = await this.options.resolveExternalModel(model.code);
    if (!resolved) throw new Error("The selected third-party model is no longer available.");
    if (resolved.provider.protocol !== "openai-compatible") {
      return jsonResponse(501, "This provider uses native Anthropic Messages and cannot serve an OpenAI Chat Completions request.");
    }
    return fetch(`${resolved.provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal: requestSignal(request),
      headers: {
        ...modelProviderRequestHeaders(resolved.provider),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ...body, model: resolved.modelId })
    });
  }

  private async requestExternalResponses(model: ChatModel, body: Record<string, unknown>, request: IncomingMessage): Promise<Response> {
    const resolved = await this.options.resolveExternalModel(model.code);
    if (!resolved) throw new Error("The selected third-party model is no longer available.");
    if (resolved.provider.protocol !== "openai-compatible") {
      return jsonResponse(501, "This provider does not expose an OpenAI Responses endpoint.");
    }
    return fetch(`${resolved.provider.baseUrl}/responses`, {
      method: "POST",
      signal: requestSignal(request),
      headers: {
        ...modelProviderRequestHeaders(resolved.provider),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ...body, model: resolved.modelId })
    });
  }

  private async requestExternalAnthropic(model: ChatModel, body: Record<string, unknown>, request: IncomingMessage): Promise<Response> {
    const resolved = await this.options.resolveExternalModel(model.code);
    if (!resolved) throw new Error("The selected third-party model is no longer available.");
    if (resolved.provider.protocol !== "anthropic") {
      return jsonResponse(501, "This provider does not expose a native Anthropic Messages endpoint.");
    }
    return fetch(`${resolved.provider.baseUrl}/messages`, {
      method: "POST",
      signal: requestSignal(request),
      headers: {
        ...modelProviderRequestHeaders(resolved.provider),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ...body, model: resolved.modelId })
    });
  }

  private async requestRouteMarket(model: ChatModel, body: Record<string, unknown>, request: IncomingMessage): Promise<Response> {
    const apiClient = this.options.getApiClient();
    if (!apiClient) return jsonResponse(503, "RouteMarket is not ready.");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemPrompt = messages.flatMap((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return [];
      const record = message as Record<string, unknown>;
      return record.role === "system" && typeof record.content === "string" ? [record.content] : [];
    }).join("\n\n");
    const nonSystemMessages = messages.filter((message) => !message || typeof message !== "object" || Array.isArray(message) || (message as Record<string, unknown>).role !== "system");
    const upstream = await apiClient.request("/api/app/v1/work/chat/local", {
      method: "POST",
      signal: requestSignal(request),
      headers: {
        "Content-Type": "application/json",
        "X-RouteMarket-Request-Source": "desktop_gateway",
        "x-request-id": safeRequestId(request.headers["x-request-id"])
      },
      body: JSON.stringify({
        session_id: `desktop_gateway_${randomUUID()}`,
        request_id: randomUUID(),
        model: model.code,
        system_prompt: systemPrompt,
        messages: nonSystemMessages,
        ...(Array.isArray(body.tools) ? { tools: body.tools } : {}),
        ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
        ...(typeof body.parallel_tool_calls === "boolean" ? { parallel_tool_calls: body.parallel_tool_calls } : {}),
        ...(model.preferredChatProtocol === "openai_responses" ? { protocol: "openai_responses" } : {}),
        stream: body.stream === true
      })
    }, "required");
    return body.stream === true || !upstream.ok
      ? upstream
      : collectRouteMarketChatResponse(upstream, model.code);
  }

  private async requestRouteMarketResponses(model: ChatModel, body: Record<string, unknown>, request: IncomingMessage): Promise<Response> {
    const apiClient = this.options.getApiClient();
    if (!apiClient) return jsonResponse(503, "RouteMarket is not ready.");
    const inputMessages = responsesInputMessages(body.input);
    const instructions = typeof body.instructions === "string" ? body.instructions : "";
    const upstream = await apiClient.request("/api/app/v1/work/chat/local", {
      method: "POST",
      signal: requestSignal(request),
      headers: {
        "Content-Type": "application/json",
        "X-RouteMarket-Request-Source": "desktop_gateway",
        "x-request-id": safeRequestId(request.headers["x-request-id"])
      },
      body: JSON.stringify({
        session_id: `desktop_gateway_${randomUUID()}`,
        request_id: randomUUID(),
        model: model.code,
        system_prompt: instructions,
        messages: inputMessages,
        ...(Array.isArray(body.tools) ? { tools: body.tools } : {}),
        ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
        protocol: "openai_responses",
        stream: body.stream === true,
        adapter_payload: {
          body: {
            ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
            ...(typeof body.max_output_tokens === "number" ? { max_output_tokens: body.max_output_tokens } : {}),
            ...(body.reasoning && typeof body.reasoning === "object" ? { reasoning: body.reasoning } : {})
          }
        }
      })
    }, "required");
    return body.stream === true || !upstream.ok
      ? upstream
      : collectRouteMarketResponsesResponse(upstream, model.code);
  }

  private async mutate<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    let result!: TResult;
    const run = this.mutationTail.then(async () => { result = await operation(); });
    this.mutationTail = run.then(() => undefined, () => undefined);
    await run;
    return result;
  }

  private async recordUsage(record: LocalApiGatewayUsage): Promise<void> {
    if (this.options.recordUsage) {
      await this.options.recordUsage(record);
      return;
    }
    await mkdir(dirname(this.options.filePath), { recursive: true, mode: 0o700 });
    await appendFile(`${this.options.filePath}.usage.jsonl`, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private async read(): Promise<GatewayConfig> {
    const raw = await readFile(this.options.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw) return defaultConfig();
    requireEncryption();
    const envelope = JSON.parse(raw) as Partial<EncryptedGatewayFile>;
    if (envelope.version !== 1 || typeof envelope.encrypted !== "string") throw new Error("Local gateway configuration is invalid.");
    const payload = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"))) as Partial<GatewayConfig>;
    return {
      version: 1,
      enabled: payload.enabled === true,
      port: normalizePort(payload.port ?? DEFAULT_PORT),
      token: typeof payload.token === "string" && /^rm_local_[A-Za-z0-9_-]{20,}$/.test(payload.token) ? payload.token : createToken(),
      routes: Array.isArray(payload.routes) ? payload.routes.flatMap((route) => normalizeStoredRoute(route)) : []
    };
  }

  private async write(config: GatewayConfig): Promise<void> {
    requireEncryption();
    await mkdir(dirname(this.options.filePath), { recursive: true, mode: 0o700 });
    const encrypted = safeStorage.encryptString(JSON.stringify(config)).toString("base64");
    const temporaryPath = `${this.options.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ version: 1, encrypted }), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.options.filePath);
  }
}

function usageKind(protocol: GatewayTextProtocol): LocalApiGatewayUsage["kind"] {
  return protocol === "responses" ? "responses" : protocol === "anthropic" ? "anthropic_messages" : "chat";
}

export function publicModelId(model: Pick<ChatModel, "code" | "source" | "providerId">): string {
  if (model.source === "routemarket") return `routemarket/${model.code}`;
  return `byok/${model.providerId ?? "provider"}/${Buffer.from(model.code).toString("base64url")}`;
}

function defaultConfig(): GatewayConfig {
  return { version: 1, enabled: false, port: DEFAULT_PORT, token: createToken(), routes: [] };
}

function routeModelId(routeId: string): string {
  return `route/${routeId}`;
}

function normalizeRoute(input: LocalApiGatewayRouteInput, existingId?: string): LocalApiGatewayRoute {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Local route name must be between 1 and 80 characters.");
  const targets = [...new Set(input.targets.filter((target) => typeof target === "string").map((target) => target.trim()).filter(Boolean))].slice(0, 20);
  if (!targets.length) throw new Error("A local route requires at least one target model.");
  const strategy = input.strategy === "round-robin" ? "round-robin" : "priority";
  return { id: existingId ?? `route_${randomUUID().replaceAll("-", "")}`, name, strategy, targets };
}

function normalizeStoredRoute(value: unknown): LocalApiGatewayRoute[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const route = value as Partial<LocalApiGatewayRoute>;
  if (!/^route_[a-f0-9]{32}$/.test(route.id ?? "") || typeof route.name !== "string" || !Array.isArray(route.targets)) return [];
  try {
    return [normalizeRoute({ id: route.id, name: route.name, strategy: route.strategy, targets: route.targets.filter((target): target is string => typeof target === "string") }, route.id)];
  } catch {
    return [];
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function createToken(): string {
  return `rm_local_${randomBytes(24).toString("base64url")}`;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Local gateway port must be between 1024 and 65535.");
  return value;
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure local gateway storage is unavailable on this device.");
}

function validHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function authorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Local gateway request body is too large.");
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Local gateway request body must be a JSON object.");
  }
}

function requestSignal(request: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  request.once("close", () => {
    if (!request.complete) controller.abort();
  });
  return controller.signal;
}

async function pipeFetchResponse(upstream: Response, response: ServerResponse): Promise<void> {
  response.statusCode = upstream.status;
  for (const name of ["content-type", "cache-control", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  if (!upstream.body) {
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await new Promise<void>((resolve) => response.once("drain", resolve));
    }
  } finally {
    reader.releaseLock();
    response.end();
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function jsonResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: "gateway_error" } }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function safeRequestId(value: string | string[] | undefined): string {
  const requestId = Array.isArray(value) ? value[0] : value;
  return typeof requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : randomUUID();
}

function responsesInputMessages(input: unknown): unknown[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (record.type === "message" || record.role === "user" || record.role === "assistant" || record.role === "system") {
      return [{ role: record.role ?? "user", content: record.content ?? "" }];
    }
    return [record];
  });
}

async function collectRouteMarketChatResponse(upstream: Response, model: string): Promise<Response> {
  const events = await readSseJsonEvents(upstream);
  let id = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
  let created = Math.floor(Date.now() / 1000);
  let content = "";
  let reasoning = "";
  let finishReason: unknown = "stop";
  let usage: unknown;
  const toolCalls = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
  for (const event of events) {
    if (typeof event.id === "string") id = event.id;
    if (typeof event.created === "number") created = event.created;
    if (event.usage && typeof event.usage === "object") usage = event.usage;
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
    if (!choice) continue;
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
    const delta = choice.delta && typeof choice.delta === "object" && !Array.isArray(choice.delta)
      ? choice.delta as Record<string, unknown>
      : {};
    if (typeof delta.content === "string") content += delta.content;
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
    if (Array.isArray(delta.tool_calls)) {
      for (const value of delta.tool_calls) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const call = value as Record<string, unknown>;
        const index = typeof call.index === "number" ? call.index : toolCalls.size;
        const fn = call.function && typeof call.function === "object" && !Array.isArray(call.function)
          ? call.function as Record<string, unknown>
          : {};
        const current = toolCalls.get(index) ?? {
          id: typeof call.id === "string" ? call.id : `call_${randomUUID().replaceAll("-", "")}`,
          type: "function" as const,
          function: { name: "", arguments: "" }
        };
        if (typeof call.id === "string") current.id = call.id;
        if (typeof fn.name === "string") current.function.name += fn.name;
        if (typeof fn.arguments === "string") current.function.arguments += fn.arguments;
        toolCalls.set(index, current);
      }
    }
  }
  const message: Record<string, unknown> = { role: "assistant", content };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.size) message.tool_calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  return new Response(JSON.stringify({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    ...(usage ? { usage } : {})
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function collectRouteMarketResponsesResponse(upstream: Response, model: string): Promise<Response> {
  const events = await readSseJsonEvents(upstream);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "response.completed" && event.response && typeof event.response === "object") {
      return new Response(JSON.stringify(event.response), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (event.object === "response" && event.status === "completed") {
      return new Response(JSON.stringify(event), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }
  let text = "";
  let responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  for (const event of events) {
    if (typeof event.response_id === "string") responseId = event.response_id;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    if (event.type === "response.output_text.done" && typeof event.text === "string") text = event.text;
  }
  const response = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output: [{ type: "message", id: `msg_${randomUUID().replaceAll("-", "")}`, role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
    output_text: text
  };
  return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function readSseJsonEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  if (text.length > 16 * 1024 * 1024) throw new Error("RouteMarket gateway response is too large to aggregate.");
  const events: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) events.push(parsed as Record<string, unknown>);
    } catch {
      // Ignore non-JSON SSE metadata lines.
    }
  }
  return events;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown local gateway error.";
  return message.replace(/\brm_local_[A-Za-z0-9_-]+\b/g, "[redacted]").slice(0, 500);
}
