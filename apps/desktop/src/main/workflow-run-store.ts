import { DatabaseSync } from "node:sqlite";
import type { DesktopWorkflowRun } from "../shared/desktop-api";

type RunRow = {
  run_id: string;
  workflow_id: string;
  local_project_id: string;
  status: DesktopWorkflowRun["status"];
  document_json: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_RUN_BYTES = 8 * 1024 * 1024;

export class WorkflowRunStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        local_project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS workflow_runs_project_idx
        ON workflow_runs(local_project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx
        ON workflow_runs(local_project_id, workflow_id, created_at DESC);
    `);
  }

  save(run: DesktopWorkflowRun): DesktopWorkflowRun {
    validateRun(run);
    const documentJson = JSON.stringify(run);
    if (Buffer.byteLength(documentJson, "utf8") > MAX_RUN_BYTES) {
      throw new Error("Workflow run exceeds the 8 MiB local limit.");
    }
    this.db.prepare(`
      INSERT INTO workflow_runs (
        run_id, workflow_id, local_project_id, status, document_json,
        created_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status,
        document_json = excluded.document_json,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `).run(
      run.runId,
      run.workflowId,
      run.localProjectId,
      run.status,
      documentJson,
      run.createdAt,
      run.startedAt,
      run.finishedAt
    );
    return cloneRun(run);
  }

  get(runId: string): DesktopWorkflowRun | null {
    const row = this.db.prepare(
      "SELECT * FROM workflow_runs WHERE run_id = ?"
    ).get(runId) as RunRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(localProjectId: string, workflowId?: string, limit = 100): DesktopWorkflowRun[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = (workflowId
      ? this.db.prepare(`
          SELECT * FROM workflow_runs
          WHERE local_project_id = ? AND workflow_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        `).all(localProjectId, workflowId, safeLimit)
      : this.db.prepare(`
          SELECT * FROM workflow_runs
          WHERE local_project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        `).all(localProjectId, safeLimit)) as RunRow[];
    return rows.map(mapRow);
  }

  close(): void {
    this.db.close();
  }
}

function validateRun(run: DesktopWorkflowRun): void {
  if (
    !ID_PATTERN.test(run.runId) ||
    !ID_PATTERN.test(run.workflowId) ||
    !ID_PATTERN.test(run.localProjectId)
  ) {
    throw new Error("Workflow run identifiers are invalid.");
  }
  if (!run.workflowName.trim() || run.workflowName.length > 120) {
    throw new Error("Workflow run name is invalid.");
  }
  const nodeRunIds = new Set<string>();
  for (const nodeRun of run.nodeRuns) {
    if (!ID_PATTERN.test(nodeRun.nodeRunId) || nodeRunIds.has(nodeRun.nodeRunId)) {
      throw new Error("Workflow node run identifiers must be unique and valid.");
    }
    nodeRunIds.add(nodeRun.nodeRunId);
  }
}

function mapRow(row: RunRow): DesktopWorkflowRun {
  const run = JSON.parse(row.document_json) as DesktopWorkflowRun;
  if (
    run.runId !== row.run_id ||
    run.workflowId !== row.workflow_id ||
    run.localProjectId !== row.local_project_id ||
    run.status !== row.status
  ) {
    throw new Error("Stored Workflow run metadata is inconsistent.");
  }
  return run;
}

function cloneRun(run: DesktopWorkflowRun): DesktopWorkflowRun {
  return structuredClone(run);
}
