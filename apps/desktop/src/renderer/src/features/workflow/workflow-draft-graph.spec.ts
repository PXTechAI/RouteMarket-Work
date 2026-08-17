import { describe, expect, it } from "vitest";
import type { DesktopWorkflowDraft } from "../../../../shared/desktop-api";
import {
  canConnectWorkflowDraftPorts,
  connectWorkflowDraftNodes,
  duplicateWorkflowDraftNodes,
  layoutWorkflowDraft,
  moveWorkflowDraftNode,
  moveWorkflowDraftNodes,
  removeWorkflowDraftEdges,
  removeWorkflowDraftNodes,
  validateWorkflowDraftGraph
} from "./workflow-draft-graph";

describe("workflow draft graph helpers", () => {
  it("moves an existing node and bounds persisted coordinates", () => {
    const draft = createDraft();
    const moved = moveWorkflowDraftNode(draft, "node_a", 12.7, 20_001);

    expect(moved.nodes[0]).toMatchObject({ x: 13, y: 10_000 });
    expect(moveWorkflowDraftNode(moved, "missing", 1, 2)).toBe(moved);
  });

  it("moves a selected node group in one graph update", () => {
    const moved = moveWorkflowDraftNodes(createDraft(), [
      { nodeId: "node_a", x: 30, y: 40 },
      { nodeId: "node_b", x: 300, y: 80 }
    ]);

    expect(moved.nodes.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 30, y: 40 },
      { x: 300, y: 80 }
    ]);
  });

  it("connects valid nodes once and rejects self or duplicate edges", () => {
    const draft = createDraft();
    const connected = connectWorkflowDraftNodes(
      draft,
      "node_a",
      "node_b",
      "edge_ab"
    );

    expect(connected.edges).toEqual([{
      edgeId: "edge_ab",
      sourceNodeId: "node_a",
      targetNodeId: "node_b",
      sourcePortId: "output",
      targetPortId: "input"
    }]);
    expect(
      connectWorkflowDraftNodes(connected, "node_a", "node_b", "edge_duplicate")
    ).toBe(connected);
    expect(
      connectWorkflowDraftNodes(connected, "node_a", "node_a", "edge_self")
    ).toBe(connected);
  });

  it("validates typed ports and preserves distinct port-level edges", () => {
    const draft = createTypedDraft();

    expect(
      canConnectWorkflowDraftPorts(draft, "node_a", "node_b", "text", "image")
    ).toBe(false);
    expect(
      canConnectWorkflowDraftPorts(draft, "node_a", "node_b", "text", "prompt")
    ).toBe(true);

    const textConnected = connectWorkflowDraftNodes(
      draft,
      "node_a",
      "node_b",
      "edge_text",
      "text",
      "prompt"
    );
    const fullyConnected = connectWorkflowDraftNodes(
      textConnected,
      "node_a",
      "node_b",
      "edge_data",
      "data",
      "payload"
    );

    expect(fullyConnected.edges).toHaveLength(2);
    expect(fullyConnected.edges[1]).toMatchObject({
      sourcePortId: "data",
      targetPortId: "payload"
    });
  });

  it("rejects a connection that would create a dependency cycle", () => {
    const connected = connectWorkflowDraftNodes(
      createDraft(),
      "node_a",
      "node_b",
      "edge_ab"
    );

    expect(
      canConnectWorkflowDraftPorts(connected, "node_b", "node_a")
    ).toBe(false);
    expect(
      connectWorkflowDraftNodes(connected, "node_b", "node_a", "edge_ba")
    ).toBe(connected);
  });

  it("reports unavailable nodes and unconnected required inputs", () => {
    const draft = createTypedDraft();
    draft.nodes[0]!.definitionSnapshot.available = false;
    draft.nodes[0]!.definitionSnapshot.blockedReason = "Missing connector";
    draft.nodes[1]!.definitionSnapshot.cloudRuntime!.inputPorts[0]!.required = true;

    expect(validateWorkflowDraftGraph(draft)).toEqual([
      expect.objectContaining({ code: "node_unavailable", nodeId: "node_a" }),
      expect.objectContaining({ code: "required_input", nodeId: "node_b" })
    ]);
  });

  it("removes only selected edges", () => {
    const connected = connectWorkflowDraftNodes(
      createDraft(),
      "node_a",
      "node_b",
      "edge_ab"
    );
    const removed = removeWorkflowDraftEdges(connected, ["edge_ab"]);

    expect(removed.edges).toEqual([]);
    expect(removeWorkflowDraftEdges(removed, ["missing"])).toBe(removed);
  });

  it("removes selected nodes and all attached edges in one graph update", () => {
    const connected = connectWorkflowDraftNodes(
      createDraft(),
      "node_a",
      "node_b",
      "edge_ab"
    );
    const removed = removeWorkflowDraftNodes(connected, ["node_a"]);

    expect(removed.nodes.map((node) => node.nodeId)).toEqual(["node_b"]);
    expect(removed.edges).toEqual([]);
    expect(removeWorkflowDraftNodes(removed, ["missing"])).toBe(removed);
  });

  it("duplicates selected nodes with their internal edges and offset positions", () => {
    const connected = connectWorkflowDraftNodes(
      createDraft(),
      "node_a",
      "node_b",
      "edge_ab"
    );
    const duplicated = duplicateWorkflowDraftNodes(
      connected,
      ["node_a", "node_b"],
      (kind, originalId) => `${kind}_copy_${originalId}`
    );

    expect(duplicated.nodeIds).toEqual([
      "node_copy_node_a",
      "node_copy_node_b"
    ]);
    expect(duplicated.draft.nodes).toHaveLength(4);
    expect(duplicated.draft.nodes[2]).toMatchObject({
      nodeId: "node_copy_node_a",
      x: 40,
      y: 40
    });
    expect(duplicated.draft.edges[1]).toMatchObject({
      edgeId: "edge_copy_edge_ab",
      sourceNodeId: "node_copy_node_a",
      targetNodeId: "node_copy_node_b"
    });
  });

  it("lays out a graph from left to right by dependency rank", () => {
    const connected = connectWorkflowDraftNodes(
      createDraft(),
      "node_a",
      "node_b",
      "edge_ab"
    );
    const laidOut = layoutWorkflowDraft(connected);

    expect(laidOut.nodes.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 64, y: 64 },
      { x: 344, y: 64 }
    ]);
  });

  it("lays out an unconnected workflow as a compact three-column grid", () => {
    const draft = createDraft();
    const third = {
      ...draft.nodes[0]!,
      nodeId: "node_c",
      x: 900,
      y: 900
    };
    const fourth = {
      ...draft.nodes[1]!,
      nodeId: "node_d",
      x: 1_000,
      y: 1_000
    };
    draft.nodes.push(third, fourth);

    expect(layoutWorkflowDraft(draft).nodes.map(({ x, y }) => ({ x, y })))
      .toEqual([
        { x: 64, y: 64 },
        { x: 344, y: 64 },
        { x: 624, y: 64 },
        { x: 64, y: 254 }
      ]);
  });
});

function createDraft(): DesktopWorkflowDraft {
  const definition = {
    executorKey: "local.fs.read",
    definitionVersion: 1,
    source: "desktop_builtin" as const,
    executionTarget: "desktop" as const,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    requiredCapabilities: ["local.fs.read"],
    portability: "portable" as const,
    definitionHash: `sha256:${"a".repeat(64)}`,
    title: "Read file",
    description: "Read a project file.",
    available: true,
    blockedReason: null
  };
  return {
    workflowId: "workflow_test",
    localProjectId: "project_test",
    kind: "workflow",
    name: "Test",
    nodes: [
      {
        nodeId: "node_a",
        executorKey: definition.executorKey,
        title: "A",
        executionTarget: "desktop",
        x: 0,
        y: 0,
        config: {},
        definitionSnapshot: definition
      },
      {
        nodeId: "node_b",
        executorKey: definition.executorKey,
        title: "B",
        executionTarget: "desktop",
        x: 240,
        y: 0,
        config: {},
        definitionSnapshot: definition
      }
    ],
    edges: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  };
}

function createTypedDraft(): DesktopWorkflowDraft {
  const draft = createDraft();
  draft.nodes[0]!.definitionSnapshot = {
    ...draft.nodes[0]!.definitionSnapshot,
    source: "cloud",
    executionTarget: "cloud",
    cloudRuntime: {
      nodeType: "fixture.source",
      kind: "fixture",
      executionMode: "source",
      joinStrategy: "passthrough",
      inputPorts: [],
      outputPorts: [
        { id: "text", label: "文本", produces: ["text"] },
        { id: "data", label: "数据", produces: ["structured"] }
      ]
    }
  };
  draft.nodes[0]!.executionTarget = "cloud";
  draft.nodes[1]!.definitionSnapshot = {
    ...draft.nodes[1]!.definitionSnapshot,
    source: "cloud",
    executionTarget: "cloud",
    cloudRuntime: {
      nodeType: "fixture.target",
      kind: "fixture",
      executionMode: "sink",
      joinStrategy: "passthrough",
      inputPorts: [
        { id: "prompt", label: "提示词", accepts: ["text"] },
        { id: "payload", label: "数据", accepts: ["structured"] },
        { id: "image", label: "图片", accepts: ["image"] }
      ],
      outputPorts: []
    }
  };
  draft.nodes[1]!.executionTarget = "cloud";
  return draft;
}
