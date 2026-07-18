import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkerError } from "./errors";

export type McpServerConfig = {
  serverId: string;
  name: string;
  transport: "stdio" | "streamable-http";
  command: string;
  args: string[];
  url: string | null;
  localProjectId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type McpServerRow = {
  server_id: string;
  name: string;
  transport: "stdio" | "streamable-http";
  command: string;
  args_json: string;
  url: string | null;
  local_project_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export class McpRegistry {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_mcp_servers (
        server_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL DEFAULT 'stdio',
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        url TEXT,
        local_project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("local_mcp_servers", "transport", "TEXT NOT NULL DEFAULT 'stdio'");
    this.ensureColumn("local_mcp_servers", "url", "TEXT");
  }

  install(input: {
    name: string;
    transport?: "stdio" | "streamable-http";
    command?: string;
    args?: string[];
    url?: string;
    localProjectId?: string | null;
  }): McpServerConfig {
    const name = input.name.trim();
    const transport = input.transport ?? "stdio";
    const command = input.command?.trim() ?? "";
    const url = input.url?.trim() ?? "";
    const args = input.args ?? [];
    if (!name || name.length > 128 || !["stdio", "streamable-http"].includes(transport)) {
      throw new WorkerError("TOOL_INPUT_INVALID", "MCP server name or transport is invalid.");
    }
    if (transport === "stdio" && (!command || command.length > 1_024)) {
      throw new WorkerError("TOOL_INPUT_INVALID", "A valid MCP executable is required.");
    }
    if (transport === "streamable-http") {
      validateHttpUrl(url);
    }
    if (command.includes("\0") || args.length > 256 || args.some((arg) => arg.includes("\0") || arg.length > 8_192)) {
      throw new WorkerError("TOOL_INPUT_INVALID", "MCP server arguments exceed safety limits.");
    }
    const now = new Date().toISOString();
    const serverId = `mcp_${randomUUID().replaceAll("-", "")}`;
    this.db.prepare(`
      INSERT INTO local_mcp_servers (
        server_id, name, transport, command, args_json, url,
        local_project_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      serverId,
      name,
      transport,
      command,
      JSON.stringify(args),
      transport === "streamable-http" ? url : null,
      input.localProjectId ?? null,
      now,
      now
    );
    return this.get(serverId)!;
  }

  get(serverId: string): McpServerConfig | null {
    const row = this.db.prepare(
      "SELECT * FROM local_mcp_servers WHERE server_id = ? LIMIT 1"
    ).get(serverId) as McpServerRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(): McpServerConfig[] {
    return (this.db.prepare(
      "SELECT * FROM local_mcp_servers ORDER BY updated_at DESC"
    ).all() as McpServerRow[]).map(mapRow);
  }

  setEnabled(serverId: string, enabled: boolean): McpServerConfig {
    const result = this.db.prepare(`
      UPDATE local_mcp_servers SET enabled = ?, updated_at = ? WHERE server_id = ?
    `).run(enabled ? 1 : 0, new Date().toISOString(), serverId);
    if (result.changes === 0) throw new WorkerError("MCP_SERVER_NOT_FOUND", "MCP server was not found.");
    return this.get(serverId)!;
  }

  remove(serverId: string): void {
    const result = this.db.prepare(
      "DELETE FROM local_mcp_servers WHERE server_id = ?"
    ).run(serverId);
    if (result.changes === 0) throw new WorkerError("MCP_SERVER_NOT_FOUND", "MCP server was not found.");
  }

  close(): void {
    this.db.close();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function mapRow(row: McpServerRow): McpServerConfig {
  return {
    serverId: row.server_id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    url: row.url,
    localProjectId: row.local_project_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkerError("TOOL_INPUT_INVALID", "Streamable HTTP MCP URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new WorkerError("TOOL_INPUT_INVALID", "Streamable HTTP MCP requires an HTTP(S) URL without credentials.");
  }
  if (value.length > 4_096 || parsed.hash || parsed.search) {
    throw new WorkerError("TOOL_INPUT_INVALID", "Streamable HTTP MCP URL contains unsupported components.");
  }
}
