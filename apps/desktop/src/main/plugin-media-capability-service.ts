import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PluginManifest, PluginModelResource } from "@routemarket/work-protocol";
import type {
  MediaGenerationRequest,
  MediaGenerationResult,
  MediaModel,
  MediaModelCategory
} from "../shared/desktop-api";

const MAX_REQUEST_BYTES = 256 * 1024;

export type MediaExecutionLocation = "local" | "cloud";
export type PluginMediaCapability = {
  backendId: string;
  capability: string;
  displayName: string;
  execution: MediaExecutionLocation;
  providerName: string;
  modelId: string;
  available: boolean;
  recommendedVramMb: number | null;
  license: string | null;
  price: number | null;
  metadata: Record<string, unknown>;
};
export type PluginMediaCapabilitySession = { baseUrl: string; token: string };
export type PluginMediaJobRequest = {
  capability: string;
  backendId: string;
  input: Record<string, unknown>;
};
export type PluginMediaJobResult = {
  jobId: string;
  capability: string;
  backendId: string;
  execution: MediaExecutionLocation;
  result: MediaGenerationResult;
};

type MediaBackend = {
  listMediaModels(kind: MediaModelCategory): Promise<MediaModel[]>;
  generateMedia(input: MediaGenerationRequest): Promise<MediaGenerationResult>;
};
type SessionPolicy = {
  pluginId: string;
  permissions: Set<PluginManifest["permissions"][number]>;
  localModels: PluginModelResource[];
};

export class PluginMediaCapabilityService {
  private readonly sessions = new Map<string, SessionPolicy>();
  private server: Server | null = null;
  private baseUrl: string | null = null;

  constructor(private readonly backend: MediaBackend) {}

  async createPluginSession(
    pluginId: string,
    permissions: Iterable<PluginManifest["permissions"][number]>,
    localModels: PluginModelResource[]
  ): Promise<PluginMediaCapabilitySession> {
    const baseUrl = await this.ensureServer();
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, {
      pluginId,
      permissions: new Set(permissions),
      localModels: structuredClone(localModels)
    });
    return { baseUrl, token };
  }

  revokePluginSession(token: string): void {
    this.sessions.delete(token);
  }

  async listCapabilities(policy: SessionPolicy): Promise<PluginMediaCapability[]> {
    const capabilities: PluginMediaCapability[] = [];
    if (policy.permissions.has("models.invoke.local")) {
      capabilities.push(...policy.localModels.flatMap(localModelCapability));
    }
    const categories: MediaModelCategory[] = ["audio", "video", "image"];
    const catalogs = await Promise.all(categories.map(async (kind) => ({
      kind,
      models: await this.backend.listMediaModels(kind).catch(() => [])
    })));
    for (const { models } of catalogs) {
      for (const model of models) {
        const execution: MediaExecutionLocation = model.source === "local" ? "local" : "cloud";
        const permission = execution === "local" ? "models.invoke.local" : "models.invoke.cloud";
        if (!policy.permissions.has(permission)) continue;
        capabilities.push(...hostModelCapabilities(model, execution));
      }
    }
    return capabilities.sort((left, right) => {
      if (left.capability !== right.capability) return left.capability.localeCompare(right.capability);
      if (left.execution !== right.execution) return left.execution === "local" ? -1 : 1;
      return left.displayName.localeCompare(right.displayName);
    });
  }

  async createJob(policy: SessionPolicy, request: PluginMediaJobRequest): Promise<PluginMediaJobResult> {
    const capability = normalizeCapability(request.capability);
    const backendId = normalizeBackendId(request.backendId);
    const available = await this.listCapabilities(policy);
    const selected = available.find((item) => item.backendId === backendId && item.capability === capability);
    if (!selected) throw new PluginMediaCapabilityError(404, "Requested media capability backend is unavailable.");
    if (backendId.startsWith("plugin:")) {
      throw new PluginMediaCapabilityError(409, "Plugin-local models must be invoked by the owning plugin runtime.");
    }
    const input = generationRequest(capability, selected.modelId, request.input);
    const result = await this.backend.generateMedia(input);
    return {
      jobId: result.taskId || randomUUID(),
      capability,
      backendId,
      execution: selected.execution,
      result
    };
  }

  async close(): Promise<void> {
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    this.baseUrl = null;
    if (!server) return;
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }

  private async ensureServer(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        const status = error instanceof PluginMediaCapabilityError ? error.status : 500;
        sendJson(response, status, {
          error: error instanceof Error ? error.message : "Media capability gateway failed."
        });
      });
    });
    await new Promise<void>((resolveListen, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Media capability gateway failed to bind.");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = /^Bearer (.+)$/.exec(String(request.headers.authorization || ""))?.[1] || "";
    const policy = this.sessions.get(token);
    if (!policy) throw new PluginMediaCapabilityError(401, "Media capability session is invalid.");
    const url = new URL(request.url || "/", this.baseUrl || "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, pluginId: policy.pluginId });
    }
    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      return sendJson(response, 200, { items: await this.listCapabilities(policy) });
    }
    if (request.method === "POST" && url.pathname === "/v1/jobs") {
      const body = await readJsonBody(request);
      return sendJson(response, 202, await this.createJob(policy, {
        capability: String(body.capability || ""),
        backendId: String(body.backendId || ""),
        input: jsonObject(body.input)
      }));
    }
    throw new PluginMediaCapabilityError(404, "Media capability endpoint does not exist.");
  }
}

class PluginMediaCapabilityError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function localModelCapability(model: PluginModelResource): PluginMediaCapability[] {
  const capabilities = model.capabilities?.length
    ? model.capabilities
    : [pluginModelCapability(model.kind)].filter((value): value is string => Boolean(value));
  return capabilities.map((capability) => ({
    backendId: `plugin:${model.id}`,
    capability,
    displayName: model.title,
    execution: "local",
    providerName: "Plugin runtime",
    modelId: model.id,
    available: true,
    recommendedVramMb: model.recommendedVramMb ?? null,
    license: model.license ?? null,
    price: null,
    metadata: { owner: "plugin", required: model.required }
  }));
}

function pluginModelCapability(kind: PluginModelResource["kind"]): string | null {
  if (kind === "tts") return "audio.speech.synthesize";
  if (kind === "speech_to_text") return "audio.speech.transcribe";
  if (kind === "speech_to_speech") return "audio.speech.transform";
  if (kind === "music") return "audio.music.generate";
  if (kind === "lip_sync") return "video.lip_sync";
  if (kind === "portrait_animation") return "avatar.portrait.animate";
  if (kind === "avatar_generation") return "avatar.generate";
  if (kind === "realtime_avatar") return "avatar.realtime";
  if (kind === "upscaler") return "video.upscale";
  return null;
}

function hostModelCapabilities(model: MediaModel, execution: MediaExecutionLocation): PluginMediaCapability[] {
  const names = model.category === "audio"
    ? model.audioModes.flatMap((mode) => {
      if (mode === "tts") return ["audio.speech.synthesize"];
      if (mode === "music") return ["audio.music.generate"];
      if (mode === "sfx") return ["audio.sound_effect.generate"];
      return [];
    })
    : model.category === "video" ? ["video.generate"] : ["image.generate"];
  return names.map((capability) => ({
    backendId: `host:${model.code}`,
    capability,
    displayName: model.displayName,
    execution,
    providerName: model.providerName,
    modelId: model.code,
    available: true,
    recommendedVramMb: null,
    license: null,
    price: model.price,
    metadata: { category: model.category, audioModes: model.audioModes }
  }));
}

function generationRequest(
  capability: string,
  model: string,
  value: Record<string, unknown>
): MediaGenerationRequest {
  const prompt = normalizedString(value.prompt ?? value.text, 20_000);
  if (!prompt) throw new PluginMediaCapabilityError(400, "Media generation text is required.");
  if (capability === "audio.speech.synthesize") {
    return {
      kind: "audio",
      model,
      prompt,
      ...(normalizedString(value.voice, 200) ? { voice: normalizedString(value.voice, 200) } : {}),
      ...(normalizedString(value.format, 32) ? { format: normalizedString(value.format, 32) } : {})
    };
  }
  if (capability === "audio.music.generate" || capability === "audio.sound_effect.generate") {
    return {
      kind: "audio",
      model,
      prompt,
      ...(normalizedString(value.format, 32) ? { format: normalizedString(value.format, 32) } : {})
    };
  }
  if (capability === "image.generate") {
    return {
      kind: "image",
      model,
      prompt,
      ...(normalizedString(value.size, 32) ? { size: normalizedString(value.size, 32) } : {}),
      ...(normalizedString(value.quality, 32) ? { quality: normalizedString(value.quality, 32) } : {}),
      ...(Number.isInteger(Number(value.count)) ? { count: Math.max(1, Math.min(8, Number(value.count))) } : {})
    };
  }
  if (capability === "video.generate") {
    return {
      kind: "video",
      model,
      prompt,
      ...(Number.isFinite(Number(value.durationSeconds))
        ? { durationSeconds: Math.max(1, Math.min(600, Number(value.durationSeconds))) }
        : {})
    };
  }
  throw new PluginMediaCapabilityError(400, "Media capability is not invokable through the host gateway yet.");
}

function normalizeCapability(value: unknown): string {
  const capability = normalizedString(value, 128);
  if (!/^[a-z][a-z0-9._-]{2,127}$/.test(capability)) {
    throw new PluginMediaCapabilityError(400, "Media capability is invalid.");
  }
  return capability;
}

function normalizeBackendId(value: unknown): string {
  const backendId = normalizedString(value, 512);
  if (!/^(?:plugin|host):[^\s]{1,500}$/.test(backendId)) {
    throw new PluginMediaCapabilityError(400, "Media capability backend is invalid.");
  }
  return backendId;
}

function normalizedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
    throw new PluginMediaCapabilityError(413, "Media capability payload is too large.");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new PluginMediaCapabilityError(413, "Media capability request is too large.");
    }
    chunks.push(buffer);
  }
  try {
    return jsonObject(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
  } catch (error) {
    if (error instanceof PluginMediaCapabilityError) throw error;
    throw new PluginMediaCapabilityError(400, "Media capability request body is invalid.");
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}
