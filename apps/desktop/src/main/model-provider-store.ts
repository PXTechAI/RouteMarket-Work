import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type {
  ChatModel,
  ModelProviderCompatibility,
  ModelProviderHeader,
  ModelProviderInput,
  ModelProviderModel,
  ModelProviderProtocol,
  ModelProviderSummary
} from "../shared/desktop-api";

type StoredProvider = {
  id: string;
  name: string;
  protocol: ModelProviderProtocol;
  compatibility: ModelProviderCompatibility;
  baseUrl: string;
  apiKey: string;
  headers: ModelProviderHeader[];
  enabled: boolean;
  models: ModelProviderModel[];
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type ResolvedModelProvider = {
  provider: Pick<StoredProvider, "id" | "name" | "protocol" | "baseUrl" | "apiKey"> & {
    compatibility?: ModelProviderCompatibility;
    headers?: ModelProviderHeader[];
  };
  modelId: string;
};

type ProviderPayload = { version: 1; providers: StoredProvider[] };
type EncryptedProviderFile = { version: 1; encrypted: string };

export class ModelProviderStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<ModelProviderSummary[]> {
    return (await this.read()).providers.map(toSummary);
  }

  async listModels(): Promise<ChatModel[]> {
    return (await this.read()).providers.flatMap((provider) => provider.enabled
      ? provider.models.map((model) => ({
          code: externalModelCode(provider.id, model.id),
          displayName: model.displayName,
          source: "external" as const,
          providerId: provider.id,
          providerName: provider.name,
          category: model.category,
          supportsTools: model.supportsTools,
          supportsNativeWebSearch: false,
          supportsVision: model.supportsVision,
          supportsStream: model.supportsStream,
          supportsReasoningSummary: model.supportsReasoningSummary,
          preferredChatProtocol: null
        }))
      : []);
  }

  async save(input: ModelProviderInput): Promise<ModelProviderSummary> {
    return this.mutate(async (payload) => {
      const current = input.id
        ? payload.providers.find((provider) => provider.id === input.id)
        : undefined;
      const provider: StoredProvider = {
        id: current?.id ?? `provider_${randomUUID().replaceAll("-", "")}`,
        name: normalizeName(input.name),
        protocol: normalizeProtocol(input.protocol),
        compatibility: normalizeCompatibility(input.compatibility ?? current?.compatibility ?? "standard"),
        baseUrl: normalizeBaseUrl(input.baseUrl),
        apiKey: normalizeApiKey(input.apiKey?.trim() || current?.apiKey || ""),
        headers: input.headers ? normalizeProviderHeaders(input.headers) : current?.headers ?? [],
        enabled: input.enabled,
        models: input.models ? normalizeProviderModels(input.models) : current?.models ?? [],
        lastSyncedAt: current?.lastSyncedAt ?? null,
        lastError: null
      };
      payload.providers = payload.providers.filter((item) => item.id !== provider.id);
      payload.providers.push(provider);
      return toSummary(provider);
    });
  }

  async sync(providerId: string, signal?: AbortSignal): Promise<ModelProviderSummary> {
    let failure: Error | null = null;
    const summary = await this.mutate(async (payload) => {
      const provider = requireProvider(payload.providers, providerId);
      try {
        provider.models = mergeSynchronizedModels(
          provider.models,
          await fetchProviderModels(provider, signal)
        );
        provider.lastSyncedAt = new Date().toISOString();
        provider.lastError = null;
      } catch (error) {
        failure = error instanceof Error ? error : new Error("Model sync failed.");
        provider.lastError = failure.message.slice(0, 500);
      }
      return toSummary(provider);
    });
    if (failure) throw failure;
    return summary;
  }

  async remove(providerId: string): Promise<boolean> {
    return this.mutate(async (payload) => {
      const before = payload.providers.length;
      payload.providers = payload.providers.filter((provider) => provider.id !== providerId);
      return payload.providers.length !== before;
    });
  }

  async resolveModel(code: string): Promise<ResolvedModelProvider | null> {
    const parsed = parseExternalModelCode(code);
    if (!parsed) return null;
    const provider = (await this.read()).providers.find((item) => item.id === parsed.providerId);
    if (!provider?.enabled || !provider.models.some((model) => model.id === parsed.modelId)) return null;
    return {
      provider: {
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        compatibility: provider.compatibility,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        headers: provider.headers.map((header) => ({ ...header }))
      },
      modelId: parsed.modelId
    };
  }

  async clear(): Promise<void> {
    await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  private async mutate<TResult>(operation: (payload: ProviderPayload) => Promise<TResult>): Promise<TResult> {
    let result!: TResult;
    const run = this.mutationTail.then(async () => {
      const payload = await this.read();
      result = await operation(payload);
      await this.write(payload);
    });
    this.mutationTail = run.then(() => undefined, () => undefined);
    await run;
    return result;
  }

  private async read(): Promise<ProviderPayload> {
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw) return { version: 1, providers: [] };
    this.requireEncryption();
    const envelope = JSON.parse(raw) as Partial<EncryptedProviderFile>;
    if (envelope.version !== 1 || typeof envelope.encrypted !== "string") {
      throw new Error("Stored model provider configuration is invalid.");
    }
    const payload = JSON.parse(
      safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"))
    ) as Partial<ProviderPayload>;
    return {
      version: 1,
      providers: Array.isArray(payload.providers)
        ? payload.providers.flatMap((provider) => normalizeStoredProvider(provider))
        : []
    };
  }

  private async write(payload: ProviderPayload): Promise<void> {
    this.requireEncryption();
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const encrypted = safeStorage.encryptString(JSON.stringify(payload)).toString("base64");
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ version: 1, encrypted }), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }

  private requireEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure model provider storage is unavailable on this device.");
    }
  }
}

export function externalModelCode(providerId: string, modelId: string): string {
  return `external:${providerId}:${Buffer.from(modelId).toString("base64url")}`;
}

function parseExternalModelCode(code: string): { providerId: string; modelId: string } | null {
  const match = /^external:(provider_[a-f0-9]{32}):([A-Za-z0-9_-]+)$/.exec(code);
  if (!match) return null;
  const modelId = Buffer.from(match[2]!, "base64url").toString("utf8");
  return modelId ? { providerId: match[1]!, modelId } : null;
}

async function fetchProviderModels(provider: StoredProvider, signal?: AbortSignal): Promise<ModelProviderModel[]> {
  const headers = modelProviderRequestHeaders(provider);
  const url = new URL(`${provider.baseUrl}/models`);
  if (provider.protocol === "anthropic") url.searchParams.set("limit", "1000");
  const response = await fetch(url, { headers, signal });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(readProviderError(payload, response.status));
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const models = data.flatMap((value): ModelProviderModel[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 200) return [];
    if (provider.protocol === "openai-compatible" && isObviouslyNonChatModel(item.id)) return [];
    return [{
      id: item.id,
      displayName: typeof item.display_name === "string" && item.display_name.trim()
        ? item.display_name.slice(0, 200)
        : item.id,
      source: "synced",
      category: "chat",
      supportsTools: false,
      supportsVision: false,
      supportsStream: true,
      supportsReasoningSummary: false
    }];
  });
  if (!models.length) throw new Error("The provider returned no usable chat models.");
  return models.slice(0, 1000);
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("Provider name must be between 1 and 80 characters.");
  return name;
}

function normalizeProtocol(value: string): ModelProviderProtocol {
  if (value !== "openai-compatible" && value !== "anthropic") {
    throw new Error("Unsupported model provider protocol.");
  }
  return value;
}

function normalizeCompatibility(value: string): ModelProviderCompatibility {
  if (
    value !== "standard" &&
    value !== "openrouter" &&
    value !== "opencode" &&
    value !== "nine-router" &&
    value !== "custom"
  ) {
    throw new Error("Unsupported model provider compatibility mode.");
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Provider URL must use HTTPS, except for a loopback development server.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Provider URL cannot contain credentials, query parameters, or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeApiKey(value: string): string {
  const apiKey = value.trim();
  if (!apiKey || apiKey.length > 500 || /[\r\n]/.test(apiKey)) {
    throw new Error("A valid API key is required.");
  }
  return apiKey;
}

const BLOCKED_PROVIDER_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "origin"
]);

function normalizeProviderHeaders(values: ModelProviderHeader[]): ModelProviderHeader[] {
  if (!Array.isArray(values) || values.length > 20) {
    throw new Error("A provider can define at most 20 custom request headers.");
  }
  const normalized = new Map<string, ModelProviderHeader>();
  for (const value of values) {
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    const headerValue = typeof value?.value === "string" ? value.value.trim() : "";
    if (!name && !headerValue) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(name)) {
      throw new Error("A custom request header has an invalid name.");
    }
    if (BLOCKED_PROVIDER_HEADERS.has(name.toLowerCase())) {
      throw new Error(`The ${name} header is managed by RouteMarket and cannot be overridden.`);
    }
    if (!headerValue || headerValue.length > 1000 || /[\r\n\0]/.test(headerValue)) {
      throw new Error(`The ${name} header has an invalid value.`);
    }
    normalized.set(name.toLowerCase(), { name, value: headerValue });
  }
  return [...normalized.values()];
}

export function modelProviderRequestHeaders(provider: {
  protocol: ModelProviderProtocol;
  apiKey: string;
  compatibility?: ModelProviderCompatibility;
  headers?: ModelProviderHeader[];
}): Record<string, string> {
  const headers: Record<string, string> = provider.protocol === "anthropic"
    ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${provider.apiKey}` };
  headers["User-Agent"] = provider.compatibility === "opencode"
    ? "RouteMarket-Desktop (OpenCode-compatible)"
    : provider.compatibility === "nine-router"
      ? "RouteMarket-Desktop (9Router-compatible)"
      : "RouteMarket-Desktop";
  if (provider.compatibility === "openrouter") {
    headers["HTTP-Referer"] = "https://routemarket.ai";
    headers["X-Title"] = "RouteMarket Work";
  }
  for (const header of provider.headers ?? []) headers[header.name] = header.value;
  return headers;
}

function requireProvider(providers: StoredProvider[], providerId: string): StoredProvider {
  if (!/^provider_[a-f0-9]{32}$/.test(providerId)) throw new Error("Invalid provider identifier.");
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) throw new Error("The model provider no longer exists.");
  return provider;
}

function toSummary(provider: StoredProvider): ModelProviderSummary {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    compatibility: provider.compatibility,
    baseUrl: provider.baseUrl,
    headers: provider.headers.map((header) => ({ ...header })),
    hasApiKey: Boolean(provider.apiKey),
    enabled: provider.enabled,
    modelCount: provider.models.length,
    models: provider.models.map((model) => ({ ...model })),
    lastSyncedAt: provider.lastSyncedAt,
    lastError: provider.lastError
  };
}

function normalizeStoredProvider(value: unknown): StoredProvider[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const provider = value as Partial<StoredProvider>;
  if (
    !/^provider_[a-f0-9]{32}$/.test(provider.id ?? "") ||
    typeof provider.name !== "string" ||
    typeof provider.baseUrl !== "string" ||
    typeof provider.apiKey !== "string" ||
    typeof provider.enabled !== "boolean" ||
    (provider.protocol !== "openai-compatible" && provider.protocol !== "anthropic") ||
    !Array.isArray(provider.models)
  ) {
    return [];
  }
  return [{
    id: provider.id!,
    name: provider.name,
    protocol: provider.protocol,
    compatibility: normalizeStoredCompatibility(provider.compatibility),
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: Array.isArray(provider.headers) ? normalizeProviderHeaders(provider.headers) : [],
    enabled: provider.enabled,
    models: normalizeProviderModels(provider.models, true),
    lastSyncedAt: typeof provider.lastSyncedAt === "string" ? provider.lastSyncedAt : null,
    lastError: typeof provider.lastError === "string" ? provider.lastError : null
  }];
}

function normalizeStoredCompatibility(value: unknown): ModelProviderCompatibility {
  return value === "openrouter" || value === "opencode" || value === "nine-router" || value === "custom"
    ? value
    : "standard";
}

function normalizeProviderModels(values: unknown[], legacyDefaults = false): ModelProviderModel[] {
  const byId = new Map<string, ModelProviderModel>();
  for (const value of values.slice(0, 1000)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const model = value as Partial<ModelProviderModel>;
    const id = normalizeModelId(model.id);
    if (!id) continue;
    const displayName = typeof model.displayName === "string" && model.displayName.trim()
      ? model.displayName.trim().slice(0, 200)
      : id;
    byId.set(id, {
      id,
      displayName,
      source: model.source === "manual" ? "manual" : "synced",
      category: model.category === "reasoning" ? "reasoning" : "chat",
      supportsTools: typeof model.supportsTools === "boolean" ? model.supportsTools : legacyDefaults,
      supportsVision: typeof model.supportsVision === "boolean" ? model.supportsVision : legacyDefaults,
      supportsStream: typeof model.supportsStream === "boolean" ? model.supportsStream : true,
      supportsReasoningSummary: model.supportsReasoningSummary === true
    });
  }
  return [...byId.values()];
}

function mergeSynchronizedModels(
  current: ModelProviderModel[],
  synchronized: ModelProviderModel[]
): ModelProviderModel[] {
  const currentById = new Map(current.map((model) => [model.id, model]));
  const manual = current.filter((model) => model.source === "manual");
  const manualIds = new Set(manual.map((model) => model.id));
  return [
    ...manual,
    ...synchronized
      .filter((model) => !manualIds.has(model.id))
      .map((model) => {
        const existing = currentById.get(model.id);
        return existing ? {
          ...model,
          category: existing.category,
          supportsTools: existing.supportsTools,
          supportsVision: existing.supportsVision,
          supportsStream: existing.supportsStream,
          supportsReasoningSummary: existing.supportsReasoningSummary
        } : model;
      })
  ].slice(0, 1000);
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 200 || /[\r\n\0]/.test(id)) return null;
  return id;
}

function isObviouslyNonChatModel(id: string): boolean {
  return /(embedding|moderation|whisper|transcri|tts|dall-e|image|realtime|audio|babbage|davinci)/i.test(id);
}

function readProviderError(payload: Record<string, unknown> | null, status: number): string {
  const error = payload?.error && typeof payload.error === "object" && !Array.isArray(payload.error)
    ? payload.error as Record<string, unknown>
    : null;
  const message = typeof error?.message === "string"
    ? error.message
    : typeof payload?.message === "string" ? payload.message : "";
  return message ? `Provider request failed: ${message}` : `Provider request failed (${status}).`;
}
