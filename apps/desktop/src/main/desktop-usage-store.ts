import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LocalApiGatewayUsage } from "../shared/desktop-api";

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
    source: record.source === "desktop_chat" ? "desktop_chat" : "local_gateway",
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
    createdAt: record.createdAt
  };
}

function normalizeKind(value: unknown): LocalApiGatewayUsage["kind"] {
  return value === "responses" || value === "anthropic_messages" || value === "image" ||
    value === "audio" || value === "video"
    ? value
    : "chat";
}
