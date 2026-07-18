import { describe, expect, it, vi } from "vitest";
import type {
  DesktopWorkflowDraft,
  DesktopWorkflowDraftNode,
  DesktopWorkflowRun
} from "../shared/desktop-api";
import { LocalWorkflowRuntime, topologicalOrder } from "./local-workflow-runtime";

describe("LocalWorkflowRuntime", () => {
  it("executes a graph in topological order and passes upstream output", async () => {
    const draft = createDraft();
    const runs = memoryRuns();
    const calls: Array<{ key: string; input: Record<string, unknown> }> = [];
    const runtime = new LocalWorkflowRuntime(
      draftReader([draft]),
      runs,
      async (node, input) => {
        calls.push({ key: node.executorKey, input });
        return node.executorKey === "local.fs.read"
          ? { text: "hello" }
          : { result: input.text };
      }
    );

    const queued = runtime.run("project_test", "workflow_test", { path: "README.md" });
    const completed = await runtime.waitForRun(queued.runId);

    expect(calls.map((call) => call.key)).toEqual(["local.fs.read", "local.fs.search"]);
    expect(calls[1]!.input).toMatchObject({
      path: "README.md",
      text: "hello",
      query: "hello"
    });
    expect(completed).toMatchObject({
      status: "succeeded",
      output: { result: "hello" }
    });
    expect(completed?.nodeRuns.map((node) => node.status)).toEqual([
      "succeeded",
      "succeeded"
    ]);
  });

  it("rejects graph cycles before creating a run", () => {
    const draft = createDraft();
    draft.edges.push({
      edgeId: "edge_cycle1",
      sourceNodeId: "node_search1",
      targetNodeId: "node_read1"
    });
    expect(() => topologicalOrder(draft)).toThrow("cycle");
  });

  it("marks the failed node and skips remaining nodes", async () => {
    const draft = createDraft();
    const runs = memoryRuns();
    const runtime = new LocalWorkflowRuntime(
      draftReader([draft]),
      runs,
      async (node) => {
        if (node.nodeId === "node_read1") throw new Error("read failed");
        return {};
      }
    );

    const queued = runtime.run("project_test", "workflow_test");
    const completed = await runtime.waitForRun(queued.runId);

    expect(completed?.status).toBe("failed");
    expect(completed?.error).toBe("read failed");
    expect(completed?.nodeRuns.map((node) => node.status)).toEqual([
      "failed",
      "skipped"
    ]);
  });

  it("cancels an active run without allowing late output to overwrite it", async () => {
    const draft = createDraft();
    const runs = memoryRuns();
    let release: (() => void) | undefined;
    const runtime = new LocalWorkflowRuntime(
      draftReader([draft]),
      runs,
      () => new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    const queued = runtime.run("project_test", "workflow_test");
    await vi.waitFor(() => expect(runtime.get(queued.runId)?.status).toBe("running"));
    const canceled = runtime.cancel(queued.runId);
    release?.();
    await runtime.waitForRun(queued.runId);

    expect(canceled.status).toBe("canceled");
    expect(runtime.get(queued.runId)?.status).toBe("canceled");
  });

  it("cancels every active run before runtime shutdown", async () => {
    const draft = createDraft();
    const secondDraft = {
      ...createDraft(),
      workflowId: "workflow_second"
    };
    const runs = memoryRuns();
    const runtime = new LocalWorkflowRuntime(
      draftReader([draft, secondDraft]),
      runs,
      () => new Promise<void>(() => undefined)
    );

    const first = runtime.run("project_test", draft.workflowId);
    const second = runtime.run("project_test", secondDraft.workflowId);
    await vi.waitFor(() => {
      expect(runtime.get(first.runId)?.status).toBe("running");
      expect(runtime.get(second.runId)?.status).toBe("running");
    });

    runtime.cancelAll();

    expect(runtime.get(first.runId)?.status).toBe("canceled");
    expect(runtime.get(second.runId)?.status).toBe("canceled");
  });

  it("runs a reusable local action inside the parent graph", async () => {
    const action = {
      ...createDraft(),
      workflowId: "action_local1",
      kind: "local_action" as const,
      name: "Reusable action",
      nodes: [node("node_action1", "local.fs.search", { query: "nested" })],
      edges: []
    };
    const workflow = {
      ...createDraft(),
      nodes: [node("node_parent1", "subworkflow.local.action_local1")],
      edges: []
    };
    const runtime = new LocalWorkflowRuntime(
      draftReader([workflow, action]),
      memoryRuns(),
      async (_node, input) => ({ received: input.query })
    );

    const queued = runtime.run("project_test", workflow.workflowId);
    const completed = await runtime.waitForRun(queued.runId);

    expect(completed).toMatchObject({
      status: "succeeded",
      output: { received: "nested" }
    });
  });
});

function createDraft(): DesktopWorkflowDraft {
  return {
    workflowId: "workflow_test",
    localProjectId: "project_test",
    kind: "workflow",
    name: "Local workflow",
    nodes: [
      node("node_read1", "local.fs.read"),
      node("node_search1", "local.fs.search", { query: "hello" })
    ],
    edges: [{
      edgeId: "edge_read_search",
      sourceNodeId: "node_read1",
      targetNodeId: "node_search1"
    }],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

function node(
  nodeId: string,
  executorKey: string,
  config: Record<string, unknown> = {}
): DesktopWorkflowDraftNode {
  return {
    nodeId,
    executorKey,
    title: executorKey,
    executionTarget: "desktop",
    x: 10,
    y: executorKey.includes("search") ? 100 : 10,
    config,
    definitionSnapshot: {
      executorKey,
      definitionVersion: 1,
      source: "desktop_builtin",
      executionTarget: "desktop",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [executorKey],
      portability: "portable",
      definitionHash: `sha256:${"a".repeat(64)}`,
      title: executorKey,
      description: executorKey,
      available: true,
      blockedReason: null
    }
  };
}

function draftReader(drafts: DesktopWorkflowDraft[]) {
  return {
    get(localProjectId: string, workflowId?: string) {
      return drafts.find(
        (draft) =>
          draft.localProjectId === localProjectId &&
          (!workflowId || draft.workflowId === workflowId)
      ) ?? null;
    }
  };
}

function memoryRuns() {
  const values = new Map<string, DesktopWorkflowRun>();
  return {
    save(run: DesktopWorkflowRun) {
      const saved = structuredClone(run);
      values.set(run.runId, saved);
      return saved;
    },
    get(runId: string) {
      const run = values.get(runId);
      return run ? structuredClone(run) : null;
    },
    list(localProjectId: string, workflowId?: string) {
      return [...values.values()]
        .filter(
          (run) =>
            run.localProjectId === localProjectId &&
            (!workflowId || run.workflowId === workflowId)
        )
        .map((run) => structuredClone(run));
    }
  };
}
