import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DesktopWorkflowDraft } from "../shared/desktop-api";
import { WorkflowDraftStore } from "./workflow-draft-store";

describe("WorkflowDraftStore", () => {
  let directory: string;
  let store: WorkflowDraftStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "routemarket-workflow-"));
    store = new WorkflowDraftStore(join(directory, "work.db"));
  });

  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists a validated workflow draft and definition snapshot", () => {
    const saved = store.save(createDraft());
    expect(saved.nodes[0]?.definitionSnapshot.executorKey).toBe("local.fs.read");
    expect(store.get("project_test", saved.workflowId)).toEqual(saved);
  });

  it("preserves the canonical cloud runtime definition", () => {
    const draft = createDraft();
    const node = draft.nodes[0]!;
    node.executionTarget = "cloud";
    node.definitionSnapshot.source = "cloud";
    node.definitionSnapshot.executionTarget = "cloud";
    node.definitionSnapshot.cloudRuntime = {
      nodeType: "llm.prompt",
      kind: "llm",
      executionMode: "transform",
      joinStrategy: "passthrough",
      inputPorts: [{ id: "prompt", accepts: ["text"], required: false }],
      outputPorts: [{ id: "text", produces: ["text"], required: false }]
    };

    const saved = store.save(draft);

    expect(store.get("project_test", saved.workflowId)?.nodes[0]?.definitionSnapshot.cloudRuntime)
      .toEqual(node.definitionSnapshot.cloudRuntime);
  });

  it("rejects edges that reference unknown nodes", () => {
    const draft = createDraft();
    draft.edges.push({ edgeId: "edge_invalid", sourceNodeId: "node_read1", targetNodeId: "node_missing" });
    expect(() => store.save(draft)).toThrow("endpoints");
  });

  it("deletes the project draft", () => {
    store.save(createDraft());
    store.delete("project_test", "workflow_test");
    expect(store.get("project_test")).toBeNull();
  });

  it("supports multiple workflows and reusable local actions per project", () => {
    const workflow = store.save(createDraft());
    const action = store.save({ ...createDraft(), workflowId: "action_test1", kind: "local_action", name: "Reusable action" });
    expect(store.list("project_test").map((item) => item.workflowId)).toEqual([action.workflowId, workflow.workflowId]);
  });

  it("rejects local action dependency cycles and referenced deletion", () => {
    const first = store.save({ ...createDraft(), workflowId: "action_first", kind: "local_action", name: "First", nodes: [] });
    const second = store.save({
      ...createDraft(),
      workflowId: "action_second",
      kind: "local_action",
      name: "Second",
      nodes: [actionNode(first.workflowId)]
    });
    expect(() => store.save({ ...first, nodes: [actionNode(second.workflowId)] })).toThrow("cycles");
    expect(() => store.delete("project_test", first.workflowId)).toThrow("referenced");
  });

  it("migrates the legacy single-draft table exactly once", () => {
    const legacyPath = join(directory, "legacy.db");
    const database = new DatabaseSync(legacyPath);
    database.exec(`CREATE TABLE workflow_drafts (
      workflow_id TEXT PRIMARY KEY, local_project_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, document_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    database.prepare("INSERT INTO workflow_drafts VALUES (?, ?, ?, ?, ?, ?)").run(
      "workflow_legacy",
      "project_test",
      "Legacy",
      JSON.stringify({ nodes: [], edges: [] }),
      "2026-07-18T00:00:00.000Z",
      "2026-07-18T00:00:00.000Z"
    );
    database.close();

    const migrated = new WorkflowDraftStore(legacyPath);
    expect(migrated.list("project_test")).toHaveLength(1);
    migrated.delete("project_test", "workflow_legacy");
    migrated.close();
    const reopened = new WorkflowDraftStore(legacyPath);
    expect(reopened.list("project_test")).toHaveLength(0);
    reopened.close();
  });

  it("persists a valid Workflow Skill source snapshot", () => {
    const draft = createDraft();
    draft.sourceSkill = {
      id: "builtin.amazon-price-monitor",
      version: 1
    };

    const saved = store.save(draft);

    expect(saved.sourceSkill).toEqual(draft.sourceSkill);
    expect(store.get(draft.localProjectId, draft.workflowId)?.sourceSkill).toEqual(
      draft.sourceSkill
    );
  });
});

function createDraft(): DesktopWorkflowDraft {
  return {
    workflowId: "workflow_test",
    localProjectId: "project_test",
    kind: "workflow",
    name: "Local workflow",
    nodes: [{
      nodeId: "node_read1",
      executorKey: "local.fs.read",
      title: "Read file",
      executionTarget: "desktop",
      x: 40,
      y: 80,
      config: {},
      definitionSnapshot: {
        executorKey: "local.fs.read",
        definitionVersion: 1,
        source: "desktop_builtin",
        executionTarget: "desktop",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        requiredCapabilities: ["local.fs.read"],
        portability: "portable",
        definitionHash: `sha256:${"a".repeat(64)}`,
        title: "Read file",
        description: "Read a file",
        available: true,
        blockedReason: null
      }
    }],
    edges: [],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

function actionNode(workflowId: string): DesktopWorkflowDraft["nodes"][number] {
  const executorKey = `subworkflow.local.${workflowId}`;
  return {
    nodeId: `node_${workflowId}`,
    executorKey,
    title: "Local action",
    executionTarget: "auto",
    x: 10,
    y: 10,
    config: {},
    definitionSnapshot: {
      executorKey,
      definitionVersion: 1,
      source: "local_extension",
      executionTarget: "auto",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: ["workflow.local_action.compose"],
      portability: "device_bound",
      definitionHash: `sha256:${"d".repeat(64)}`,
      title: "Local action",
      description: "Reusable",
      available: true,
      blockedReason: null
    }
  };
}
