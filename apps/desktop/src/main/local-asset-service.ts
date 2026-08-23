import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAX_REQUEST_BYTES = 256 * 1024;
const ASSET_URI_PREFIX = "rmasset://";

export type LocalAssetPermission = "media.read" | "media.write";
export type LocalAssetSummary = {
  id: string;
  uri: string;
  kind: string;
  name: string;
  ownerPluginId: string;
  visibility: "private" | "shared";
  source: { fileName: string; size: number; mtimeMs: number; available: boolean };
  metadata: Record<string, unknown>;
  authorization: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
export type ResolvedLocalAsset = LocalAssetSummary & { path: string };
export type RegisterLocalAssetInput = {
  kind: string;
  name?: string;
  path: string;
  metadata?: Record<string, unknown>;
  authorization?: Record<string, unknown> | null;
};
export type LocalAssetPluginSession = { baseUrl: string; token: string };

type AssetRow = {
  id: string;
  uri: string;
  kind: string;
  name: string;
  source_path: string;
  source_key: string;
  source_size: number;
  source_mtime_ms: number;
  owner_plugin_id: string;
  visibility: string;
  metadata_json: string;
  authorization_json: string | null;
  created_at: string;
  updated_at: string;
};
type SessionPolicy = { pluginId: string; permissions: Set<LocalAssetPermission> };

export class LocalAssetService {
  private readonly db: DatabaseSync;
  private readonly sessions = new Map<string, SessionPolicy>();
  private server: Server | null = null;
  private baseUrl: string | null = null;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS local_assets (
        id TEXT PRIMARY KEY,
        uri TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_key TEXT NOT NULL,
        source_size INTEGER NOT NULL,
        source_mtime_ms REAL NOT NULL,
        owner_plugin_id TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'shared')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        authorization_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_plugin_id, kind, source_key)
      );
      CREATE INDEX IF NOT EXISTS idx_local_assets_owner_kind
        ON local_assets(owner_plugin_id, kind, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_local_assets_visibility_kind
        ON local_assets(visibility, kind, updated_at DESC);
    `);
  }

  async createPluginSession(pluginId: string, permissions: Iterable<string>): Promise<LocalAssetPluginSession> {
    const baseUrl = await this.ensureServer();
    const allowed = new Set<LocalAssetPermission>();
    for (const permission of permissions) {
      if (permission === "media.read" || permission === "media.write") allowed.add(permission);
    }
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { pluginId, permissions: allowed });
    return { baseUrl, token };
  }

  revokePluginSession(token: string): void {
    this.sessions.delete(token);
  }

  async register(pluginId: string, input: RegisterLocalAssetInput): Promise<LocalAssetSummary> {
    const kind = normalizedKind(input.kind);
    const canonicalPath = verifiedLocalFile(input.path);
    const sourceStat = statSync(canonicalPath);
    const sourceKey = platformPathKey(canonicalPath);
    const metadata = jsonObject(input.metadata);
    const authorization = input.authorization == null ? null : jsonObject(input.authorization);
    const existing = this.db.prepare(`
      SELECT * FROM local_assets
      WHERE owner_plugin_id = ? AND kind = ? AND source_key = ?
    `).get(pluginId, kind, sourceKey) as AssetRow | undefined;
    const now = new Date().toISOString();
    if (existing) {
      this.db.prepare(`
        UPDATE local_assets SET
          name = ?, source_path = ?, source_size = ?, source_mtime_ms = ?,
          metadata_json = ?, authorization_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        normalizedName(input.name, basename(canonicalPath)),
        canonicalPath,
        sourceStat.size,
        sourceStat.mtimeMs,
        JSON.stringify(metadata),
        authorization ? JSON.stringify(authorization) : null,
        now,
        existing.id
      );
      return this.getSummary(existing.id, pluginId);
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO local_assets (
        id, uri, kind, name, source_path, source_key, source_size,
        source_mtime_ms, owner_plugin_id, visibility, metadata_json,
        authorization_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?, ?)
    `).run(
      id,
      `${ASSET_URI_PREFIX}${id}`,
      kind,
      normalizedName(input.name, basename(canonicalPath)),
      canonicalPath,
      sourceKey,
      sourceStat.size,
      sourceStat.mtimeMs,
      pluginId,
      JSON.stringify(metadata),
      authorization ? JSON.stringify(authorization) : null,
      now,
      now
    );
    return this.getSummary(id, pluginId);
  }

  async list(pluginId: string, kind?: string): Promise<LocalAssetSummary[]> {
    const rows = (kind
      ? this.db.prepare(`
          SELECT * FROM local_assets
          WHERE kind = ? AND (owner_plugin_id = ? OR visibility = 'shared')
          ORDER BY updated_at DESC
        `).all(normalizedKind(kind), pluginId)
      : this.db.prepare(`
          SELECT * FROM local_assets
          WHERE owner_plugin_id = ? OR visibility = 'shared'
          ORDER BY updated_at DESC
        `).all(pluginId)) as AssetRow[];
    return rows.map(toSummary);
  }

  async resolve(assetIdOrUri: string, pluginId: string): Promise<ResolvedLocalAsset> {
    const id = assetId(assetIdOrUri);
    const row = this.db.prepare(`
      SELECT * FROM local_assets
      WHERE id = ? AND (owner_plugin_id = ? OR visibility = 'shared')
    `).get(id, pluginId) as AssetRow | undefined;
    if (!row) throw new LocalAssetError(404, "Local asset is not available.");
    return { ...toSummary(row), path: row.source_path };
  }

  async relink(assetIdOrUri: string, pluginId: string, nextPath: string): Promise<LocalAssetSummary> {
    const id = assetId(assetIdOrUri);
    const row = this.db.prepare(
      "SELECT * FROM local_assets WHERE id = ? AND owner_plugin_id = ?"
    ).get(id, pluginId) as AssetRow | undefined;
    if (!row) throw new LocalAssetError(404, "Local asset is not owned by this plugin.");
    const canonicalPath = verifiedLocalFile(nextPath);
    const sourceStat = statSync(canonicalPath);
    this.db.prepare(`
      UPDATE local_assets SET
        source_path = ?, source_key = ?, source_size = ?, source_mtime_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(
      canonicalPath,
      platformPathKey(canonicalPath),
      sourceStat.size,
      sourceStat.mtimeMs,
      new Date().toISOString(),
      id
    );
    return this.getSummary(id, pluginId);
  }

  async remove(assetIdOrUri: string, pluginId: string): Promise<boolean> {
    const result = this.db.prepare(
      "DELETE FROM local_assets WHERE id = ? AND owner_plugin_id = ?"
    ).run(assetId(assetIdOrUri), pluginId);
    return Number(result.changes) > 0;
  }

  setVisibility(assetIdOrUri: string, visibility: "private" | "shared"): LocalAssetSummary {
    const id = assetId(assetIdOrUri);
    const result = this.db.prepare(
      "UPDATE local_assets SET visibility = ?, updated_at = ? WHERE id = ?"
    ).run(visibility, new Date().toISOString(), id);
    if (!Number(result.changes)) throw new LocalAssetError(404, "Local asset is not available.");
    const row = this.db.prepare("SELECT * FROM local_assets WHERE id = ?").get(id) as AssetRow;
    return toSummary(row);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    this.baseUrl = null;
    if (server) {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
      });
    }
    this.db.close();
  }

  private getSummary(id: string, pluginId: string): LocalAssetSummary {
    const row = this.db.prepare(`
      SELECT * FROM local_assets
      WHERE id = ? AND (owner_plugin_id = ? OR visibility = 'shared')
    `).get(id, pluginId) as AssetRow | undefined;
    if (!row) throw new LocalAssetError(404, "Local asset is not available.");
    return toSummary(row);
  }

  private async ensureServer(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        const status = error instanceof LocalAssetError ? error.status : 500;
        sendJson(response, status, { error: error instanceof Error ? error.message : "Local asset service failed." });
      });
    });
    await new Promise<void>((resolveListen, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Local asset service failed to bind.");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  private async handleRequest(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse
  ): Promise<void> {
    const token = /^Bearer (.+)$/.exec(String(request.headers.authorization || ""))?.[1] || "";
    const policy = this.sessions.get(token);
    if (!policy) throw new LocalAssetError(401, "Local asset session is invalid.");
    const url = new URL(request.url || "/", this.baseUrl || "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ok: true });
    if (!policy.permissions.has("media.read")) {
      throw new LocalAssetError(403, "Desktop extension has not declared media.read.");
    }
    if (request.method === "GET" && url.pathname === "/v1/assets") {
      return sendJson(response, 200, await this.list(policy.pluginId, url.searchParams.get("kind") || undefined));
    }
    if (request.method === "POST" && url.pathname === "/v1/assets/register") {
      return sendJson(response, 201, await this.register(
        policy.pluginId,
        await readJsonBody(request) as unknown as RegisterLocalAssetInput
      ));
    }
    const resolveMatch = /^\/v1\/assets\/([^/]+)\/resolve$/.exec(url.pathname);
    if (request.method === "GET" && resolveMatch) {
      return sendJson(response, 200, await this.resolve(decodeURIComponent(resolveMatch[1]), policy.pluginId));
    }
    const relinkMatch = /^\/v1\/assets\/([^/]+)\/relink$/.exec(url.pathname);
    if (request.method === "PATCH" && relinkMatch) {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await this.relink(
        decodeURIComponent(relinkMatch[1]),
        policy.pluginId,
        String(body.path || "")
      ));
    }
    const assetMatch = /^\/v1\/assets\/([^/]+)$/.exec(url.pathname);
    if (request.method === "DELETE" && assetMatch) {
      return sendJson(response, 200, {
        removed: await this.remove(decodeURIComponent(assetMatch[1]), policy.pluginId)
      });
    }
    throw new LocalAssetError(404, "Local asset endpoint does not exist.");
  }
}

class LocalAssetError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function toSummary(row: AssetRow): LocalAssetSummary {
  let available = false;
  let size = Number(row.source_size) || 0;
  let mtimeMs = Number(row.source_mtime_ms) || 0;
  try {
    const sourceStat = statSync(row.source_path);
    available = sourceStat.isFile();
    size = sourceStat.size;
    mtimeMs = sourceStat.mtimeMs;
  } catch {}
  return {
    id: row.id,
    uri: row.uri,
    kind: row.kind,
    name: row.name,
    ownerPluginId: row.owner_plugin_id,
    visibility: row.visibility === "shared" ? "shared" : "private",
    source: { fileName: basename(row.source_path), size, mtimeMs, available },
    metadata: parsedObject(row.metadata_json),
    authorization: row.authorization_json ? parsedObject(row.authorization_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function verifiedLocalFile(value: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new LocalAssetError(400, "Local asset path must be absolute.");
  }
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(resolve(value));
    if (!statSync(canonicalPath).isFile()) throw new Error("not a file");
  } catch {
    throw new LocalAssetError(400, "Local asset file does not exist.");
  }
  return canonicalPath;
}

function platformPathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function normalizedKind(value: string): string {
  const kind = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(kind)) throw new LocalAssetError(400, "Local asset kind is invalid.");
  return kind;
}

function normalizedName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  return (name || fallback).slice(0, 160);
}

function assetId(value: string): string {
  const id = String(value || "").startsWith(ASSET_URI_PREFIX)
    ? String(value).slice(ASSET_URI_PREFIX.length)
    : String(value || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new LocalAssetError(400, "Local asset handle is invalid.");
  return id.toLowerCase();
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
    throw new LocalAssetError(413, "Local asset metadata is too large.");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function parsedObject(value: string): Record<string, unknown> {
  try {
    return jsonObject(JSON.parse(value));
  } catch {
    return {};
  }
}

async function readJsonBody(
  request: import("node:http").IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new LocalAssetError(413, "Local asset request is too large.");
    chunks.push(buffer);
  }
  try {
    return jsonObject(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
  } catch {
    throw new LocalAssetError(400, "Local asset request body is invalid.");
  }
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}
