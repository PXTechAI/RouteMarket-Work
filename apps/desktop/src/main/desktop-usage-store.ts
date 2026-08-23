import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LocalApiGatewayUsage } from "../shared/desktop-api";
import { normalizeModelTokenPricing } from "./model-usage-cost";

export class DesktopUsageStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async record(record: LocalApiGatewayUsage): Promise<void> {
    const operation = this.mutationTail.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
    });
    this.mutationTail = operation.catch(() => undefined);
    await operation;
  }

  async list(limit = 1_000): Promise<LocalApiGatewayUsage[]> {
    await this.mutationTail;
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const normalizedLimit = Math.max(1, Math.min(5_000, Math.floor(limit)));
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-normalizedLimit)
      .flatMap((line) => {
        try {
          return [normalizeUsageRecord(JSON.parse(line) as unknown)];
        } catch {
          return [];
        }
      })
      .filter((record): record is LocalApiGatewayUsage => record !== null)
      .reverse();
  }
}

function normalizeUsageRecord(value: unknown): LocalApiGatewayUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<LocalApiGatewayUsage>;
  if (
    typeof record.id !== "string" ||
    typeof record.requestedModel !== "string" ||
    typeof record.resolvedModel !== "string" ||
    typeof record.durationMs !== "number" ||
    typeof record.success !== "boolean" ||
    typeof record.createdAt !== "string"
  ) return null;
  return {
    id: record.id,
    source: normalizeSource(record.source),
    kind: normalizeKind(record.kind),
    providerId: typeof record.providerId === "string" ? record.providerId : null,
    providerName: typeof record.providerName === "string" && record.providerName.trim()
      ? record.providerName.trim()
      : "RouteMarket",
    requestedModel: record.requestedModel,
    resolvedModel: record.resolvedModel,
    routeId: typeof record.routeId === "string" ? record.routeId : null,
    status: typeof record.status === "number" ? record.status : null,
    durationMs: Math.max(0, record.durationMs),
    success: record.success,
    inputTokens: normalizeTokenCount(record.inputTokens),
    outputTokens: normalizeTokenCount(record.outputTokens),
    totalTokens: normalizeTokenCount(record.totalTokens),
    cachedInputTokens: normalizeTokenCount(record.cachedInputTokens),
    cacheCreationInputTokens: normalizeTokenCount(record.cacheCreationInputTokens),
    pricingSnapshot: normalizeModelTokenPricing(record.pricingSnapshot),
    estimatedCostUsdMicros: normalizeCostMicros(record.estimatedCostUsdMicros),
    createdAt: record.createdAt
  };
}

function normalizeSource(value: unknown): LocalApiGatewayUsage["source"] {
  return value === "desktop_chat" || value === "desktop_media"
    ? value
    : "local_gateway";
}

function normalizeKind(value: unknown): LocalApiGatewayUsage["kind"] {
  return value === "responses" || value === "anthropic_messages" || value === "image" ||
    value === "audio" || value === "video"
    ? value
    : "chat";
}

function normalizeTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function normalizeCostMicros(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
