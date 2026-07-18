import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ApprovalRecord } from "../shared/desktop-api";
import type { ToolAuthorizationRequest } from "./tool-broker";

type ApprovalRow = {
  invocation_id: string;
  capability: string;
  risk: ApprovalRecord["risk"];
  title: string;
  detail: string;
  project_id: string | null;
  parameters_hash: string;
  status: ApprovalRecord["status"];
  requested_at: string;
  resolved_at: string | null;
};

export class ApprovalStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_approvals (
        invocation_id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        risk TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        project_id TEXT,
        parameters_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tool_approvals_requested_at
      ON tool_approvals(requested_at DESC);
    `);
  }

  request(input: ToolAuthorizationRequest): ApprovalRecord {
    const requestedAt = new Date().toISOString();
    const parametersHash = `sha256:${createHash("sha256")
      .update(input.approvalKey ?? `${input.capability}:${input.detail}`)
      .digest("hex")}`;
    this.db.prepare(`
      INSERT INTO tool_approvals (
        invocation_id, capability, risk, title, detail, project_id,
        parameters_hash, status, requested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?)
    `).run(
      input.invocationId,
      input.capability,
      input.risk,
      input.title,
      input.auditDetail ?? input.capability,
      input.projectId ?? null,
      parametersHash,
      requestedAt
    );
    return this.get(input.invocationId)!;
  }

  resolve(invocationId: string, decision: "approved" | "denied"): ApprovalRecord | null {
    this.db.prepare(`
      UPDATE tool_approvals SET status = ?, resolved_at = ?
      WHERE invocation_id = ? AND status = 'requested'
    `).run(decision, new Date().toISOString(), invocationId);
    return this.get(invocationId);
  }

  list(limit = 100): ApprovalRecord[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM tool_approvals ORDER BY requested_at DESC LIMIT ?
    `).all(safeLimit) as ApprovalRow[];
    return rows.map(mapRow);
  }

  get(invocationId: string): ApprovalRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM tool_approvals WHERE invocation_id = ? LIMIT 1"
    ).get(invocationId) as ApprovalRow | undefined;
    return row ? mapRow(row) : null;
  }

  close(): void {
    this.db.close();
  }
}

function mapRow(row: ApprovalRow): ApprovalRecord {
  return {
    invocationId: row.invocation_id,
    capability: row.capability,
    risk: row.risk,
    title: row.title,
    detail: row.detail,
    projectId: row.project_id,
    parametersHash: row.parameters_hash,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at
  };
}
