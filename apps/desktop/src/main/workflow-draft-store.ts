import { DatabaseSync } from "node:sqlite";
import type { DesktopWorkflowDraft, DesktopWorkflowDraftSummary } from "../shared/desktop-api";

type DraftRow = {
  workflow_id: string;
  local_project_id: string;
  kind: DesktopWorkflowDraft["kind"];
  name: string;
  document_json: string;
  created_at: string;
  updated_at: string;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const EXECUTOR_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;

export class WorkflowDraftStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_drafts_v2 (
        workflow_id TEXT PRIMARY KEY,
        local_project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workflow_drafts_v2_project_idx
        ON workflow_drafts_v2(local_project_id, updated_at DESC);
    `);
    const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workflow_drafts'").get();
    if (legacy) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        INSERT OR IGNORE INTO workflow_drafts_v2 (
          workflow_id, local_project_id, kind, name, document_json, created_at, updated_at
        )
        SELECT workflow_id, local_project_id, 'workflow', name, document_json, created_at, updated_at
        FROM workflow_drafts;
        DROP TABLE workflow_drafts;
        COMMIT;
      `);
    }
  }

  list(localProjectId: string): DesktopWorkflowDraftSummary[] {
    const rows = this.db.prepare("SELECT * FROM workflow_drafts_v2 WHERE local_project_id = ? ORDER BY updated_at DESC, rowid DESC")
      .all(localProjectId) as DraftRow[];
    return rows.map((row) => {
      const draft = mapRow(row);
      return {
        workflowId: draft.workflowId,
        localProjectId: draft.localProjectId,
        kind: draft.kind,
        name: draft.name,
        nodeCount: draft.nodes.length,
        edgeCount: draft.edges.length,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt
      };
    });
  }

  get(localProjectId: string, workflowId?: string): DesktopWorkflowDraft | null {
    const row = (workflowId
      ? this.db.prepare("SELECT * FROM workflow_drafts_v2 WHERE local_project_id = ? AND workflow_id = ?").get(localProjectId, workflowId)
      : this.db.prepare("SELECT * FROM workflow_drafts_v2 WHERE local_project_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(localProjectId)) as DraftRow | undefined;
    return row ? mapRow(row) : null;
  }

  save(draft: DesktopWorkflowDraft): DesktopWorkflowDraft {
    validateDraft(draft);
    this.assertNoLocalActionCycles(draft);
    const existing = this.get(draft.localProjectId, draft.workflowId);
    const now = new Date().toISOString();
    const next: DesktopWorkflowDraft = {
      ...draft,
      name: draft.name.trim(),
      createdAt: existing?.createdAt ?? draft.createdAt ?? now,
      updatedAt: now
    };
    const documentJson = JSON.stringify({
      ...(next.sourceSkill ? { sourceSkill: next.sourceSkill } : {}),
      nodes: next.nodes,
      edges: next.edges
    });
    if (Buffer.byteLength(documentJson, "utf8") > 512 * 1024) {
      throw new Error("Workflow draft exceeds the 512 KiB local limit.");
    }
    this.db.prepare(`
      INSERT INTO workflow_drafts_v2 (
        workflow_id, local_project_id, kind, name, document_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        document_json = excluded.document_json,
        updated_at = excluded.updated_at
    `).run(next.workflowId, next.localProjectId, next.kind, next.name, documentJson, next.createdAt, next.updatedAt);
    return this.get(next.localProjectId, next.workflowId)!;
  }

  delete(localProjectId: string, workflowId: string): void {
    const executorKey = `subworkflow.local.${workflowId}`;
    const referencedBy = this.list(localProjectId)
      .map((summary) => this.get(localProjectId, summary.workflowId)!)
      .find((draft) => draft.workflowId !== workflowId && draft.nodes.some((node) => node.executorKey === executorKey));
    if (referencedBy) {
      throw new Error(`Local action is still referenced by ${referencedBy.name}.`);
    }
    this.db.prepare("DELETE FROM workflow_drafts_v2 WHERE local_project_id = ? AND workflow_id = ?").run(localProjectId, workflowId);
  }

  close(): void { this.db.close(); }

  private assertNoLocalActionCycles(candidate: DesktopWorkflowDraft): void {
    const actions = new Map<string, DesktopWorkflowDraft>();
    for (const summary of this.list(candidate.localProjectId)) {
      if (summary.kind !== "local_action" || summary.workflowId === candidate.workflowId) continue;
      const draft = this.get(candidate.localProjectId, summary.workflowId);
      if (draft) actions.set(draft.workflowId, draft);
    }
    if (candidate.kind === "local_action") actions.set(candidate.workflowId, candidate);

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (workflowId: string): void => {
      if (visiting.has(workflowId)) throw new Error("Reusable local actions cannot contain dependency cycles.");
      if (visited.has(workflowId)) return;
      visiting.add(workflowId);
      const draft = actions.get(workflowId);
      for (const node of draft?.nodes ?? []) {
        const dependencyId = localActionId(node.executorKey);
        if (dependencyId && actions.has(dependencyId)) visit(dependencyId);
      }
      visiting.delete(workflowId);
      visited.add(workflowId);
    };
    for (const workflowId of actions.keys()) visit(workflowId);
  }
}

function validateDraft(draft: DesktopWorkflowDraft): void {
  if (!ID_PATTERN.test(draft.workflowId) || !ID_PATTERN.test(draft.localProjectId)) throw new Error("Workflow or project id is invalid.");
  if (draft.kind !== "workflow" && draft.kind !== "local_action") throw new Error("Workflow draft kind is invalid.");
  if (!draft.name.trim() || draft.name.trim().length > 120) throw new Error("Workflow name must be 1-120 characters.");
  if (
    draft.sourceSkill &&
    (
      !/^[A-Za-z0-9_.-]{3,256}$/.test(draft.sourceSkill.id) ||
      !Number.isSafeInteger(draft.sourceSkill.version) ||
      draft.sourceSkill.version < 1
    )
  ) {
    throw new Error("Workflow source Skill is invalid.");
  }
  if (draft.nodes.length > 200 || draft.edges.length > 400) throw new Error("Workflow draft exceeds node or edge limits.");
  const nodeIds = new Set<string>();
  for (const node of draft.nodes) {
    if (!ID_PATTERN.test(node.nodeId) || nodeIds.has(node.nodeId)) throw new Error("Workflow node ids must be unique and valid.");
    nodeIds.add(node.nodeId);
    if (!EXECUTOR_PATTERN.test(node.executorKey)) throw new Error("Workflow executor key is invalid.");
    if (!node.title.trim() || node.title.length > 160) throw new Error("Workflow node title is invalid.");
    if (!["cloud", "desktop", "auto"].includes(node.executionTarget)) throw new Error("Workflow execution target is invalid.");
    if (![node.x, node.y].every((value) => Number.isFinite(value) && value >= -10_000 && value <= 10_000)) throw new Error("Workflow node position is invalid.");
    if (node.definitionSnapshot.executorKey !== node.executorKey) throw new Error("Workflow definition snapshot does not match the executor.");
    validateCloudRuntime(node.definitionSnapshot.cloudRuntime);
  }
  const edgeIds = new Set<string>();
  for (const edge of draft.edges) {
    if (!ID_PATTERN.test(edge.edgeId) || edgeIds.has(edge.edgeId)) throw new Error("Workflow edge ids must be unique and valid.");
    edgeIds.add(edge.edgeId);
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId) || edge.sourceNodeId === edge.targetNodeId) {
      throw new Error("Workflow edge endpoints are invalid.");
    }
  }
}

function validateCloudRuntime(runtime: unknown): void {
  if (runtime === undefined) return;
  if (!isRecord(runtime)) {
    throw new Error("Workflow cloud runtime definition is invalid.");
  }
  const fields = [
    runtime.nodeType,
    runtime.kind,
    runtime.executionMode,
    runtime.joinStrategy
  ];
  if (
    fields.some(
      (value) =>
        typeof value !== "string" || !value.trim() || value.length > 160
    )
  ) {
    throw new Error("Workflow cloud runtime definition is invalid.");
  }
  for (const ports of [runtime.inputPorts, runtime.outputPorts]) {
    if (!Array.isArray(ports) || ports.length > 64) {
      throw new Error("Workflow cloud runtime ports are invalid.");
    }
    const portIds = new Set<string>();
    for (const port of ports) {
      if (
        !isRecord(port) ||
        typeof port.id !== "string" ||
        !port.id.trim() ||
        port.id.length > 160 ||
        portIds.has(port.id) ||
        !validPortTypes(port.accepts) ||
        !validPortTypes(port.produces)
      ) {
        throw new Error("Workflow cloud runtime ports are invalid.");
      }
      portIds.add(port.id);
    }
  }
}

function validPortTypes(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 32 &&
      value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 64))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapRow(row: DraftRow): DesktopWorkflowDraft {
  const document = JSON.parse(row.document_json) as Pick<
    DesktopWorkflowDraft,
    "nodes" | "edges" | "sourceSkill"
  >;
  return {
    workflowId: row.workflow_id,
    localProjectId: row.local_project_id,
    kind: row.kind,
    name: row.name,
    ...(document.sourceSkill
      ? { sourceSkill: document.sourceSkill }
      : {}),
    nodes: document.nodes,
    edges: document.edges,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function localActionId(executorKey: string): string | null {
  const prefix = "subworkflow.local.";
  return executorKey.startsWith(prefix) ? executorKey.slice(prefix.length) : null;
}
