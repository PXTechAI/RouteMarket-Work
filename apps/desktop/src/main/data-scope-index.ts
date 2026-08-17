import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type { RouteMarketDataScopePaths } from "./route-market-data-paths";

export type DataScopeIndexEntry = {
  scopeId: string;
  accountKey: string;
  spaceKey: string;
  accountName: string;
  spaceName: string;
  spaceKind: "personal" | "team" | "local";
  browserPartitions: string[];
  lastUsedAt: string;
};

type DataScopeIndexPayload = {
  version: 1;
  entries: DataScopeIndexEntry[];
};

type EncryptedDataScopeIndex = {
  version: 1;
  encrypted: string;
};

export class DataScopeIndex {
  constructor(private readonly filePath: string) {}

  async list(): Promise<DataScopeIndexEntry[]> {
    const payload = await this.read();
    return [...payload.entries].sort((left, right) =>
      right.lastUsedAt.localeCompare(left.lastUsedAt)
    );
  }

  async upsert(
    scope: RouteMarketDataScopePaths,
    metadata: Pick<DataScopeIndexEntry, "accountName" | "spaceName" | "spaceKind">
  ): Promise<void> {
    const payload = await this.read();
    const entry: DataScopeIndexEntry = {
      scopeId: scope.scopeId,
      accountKey: scope.accountKey,
      spaceKey: scope.spaceKey,
      ...metadata,
      browserPartitions: payload.entries.find((item) => item.scopeId === scope.scopeId)
        ?.browserPartitions ?? [],
      lastUsedAt: new Date().toISOString()
    };
    const entries = payload.entries.filter((item) => item.scopeId !== scope.scopeId);
    entries.push(entry);
    await this.write({ version: 1, entries: entries.slice(-500) });
  }

  async addBrowserPartition(scopeId: string, partition: string): Promise<void> {
    if (!/^persist:routemarket-[a-f0-9]{32}$/.test(partition)) return;
    const payload = await this.read();
    const entry = payload.entries.find((item) => item.scopeId === scopeId);
    if (!entry || entry.browserPartitions.includes(partition)) return;
    entry.browserPartitions = [...entry.browserPartitions, partition].slice(-500);
    await this.write(payload);
  }

  async remove(scopeId: string): Promise<DataScopeIndexEntry | null> {
    const payload = await this.read();
    const removed = payload.entries.find((entry) => entry.scopeId === scopeId) ?? null;
    if (!removed) return null;
    await this.write({
      version: 1,
      entries: payload.entries.filter((entry) => entry.scopeId !== scopeId)
    });
    return removed;
  }

  private async read(): Promise<DataScopeIndexPayload> {
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw) return { version: 1, entries: [] };
    this.requireEncryption();
    const envelope = JSON.parse(raw) as Partial<EncryptedDataScopeIndex>;
    if (envelope.version !== 1 || typeof envelope.encrypted !== "string") {
      throw new Error("Stored RouteMarket data scope index is invalid.");
    }
    const parsed = JSON.parse(
      safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"))
    ) as Partial<DataScopeIndexPayload>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(validEntry) : []
    };
  }

  private async write(payload: DataScopeIndexPayload): Promise<void> {
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

  async clear(): Promise<void> {
    await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  private requireEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local data index storage is unavailable on this device.");
    }
  }
}

function validEntry(value: unknown): value is DataScopeIndexEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<DataScopeIndexEntry>;
  return /^[a-f0-9]{24}$/.test(entry.scopeId ?? "") &&
    /^(?:guest|account_[a-f0-9]{24})$/.test(entry.accountKey ?? "") &&
    /^(?:local|space_[a-f0-9]{24})$/.test(entry.spaceKey ?? "") &&
    typeof entry.accountName === "string" && entry.accountName.length <= 200 &&
    typeof entry.spaceName === "string" && entry.spaceName.length <= 200 &&
    ["personal", "team", "local"].includes(entry.spaceKind ?? "") &&
    Array.isArray(entry.browserPartitions) &&
    entry.browserPartitions.length <= 500 &&
    entry.browserPartitions.every((partition) =>
      typeof partition === "string" && /^persist:routemarket-[a-f0-9]{32}$/.test(partition)
    ) &&
    typeof entry.lastUsedAt === "string" && Number.isFinite(Date.parse(entry.lastUsedAt));
}
