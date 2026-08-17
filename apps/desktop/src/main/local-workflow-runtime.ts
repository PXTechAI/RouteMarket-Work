import { randomUUID } from "node:crypto";
import type {
  DesktopWorkflowDraft,
  DesktopWorkflowDraftNode,
  DesktopWorkflowRun,
  DesktopWorkflowRunEvent
} from "../shared/desktop-api";
import type { WorkflowDraftStore } from "./workflow-draft-store";
import type { WorkflowRunStore } from "./workflow-run-store";

type WorkflowDraftReader = Pick<WorkflowDraftStore, "get">;
type WorkflowRunRepository = Pick<WorkflowRunStore, "get" | "list" | "save">;

export type LocalWorkflowNodeExecutor = (
  node: DesktopWorkflowDraftNode,
  input: Record<string, unknown>,
  signal: AbortSignal
) => Promise<unknown>;

type ActiveRun = {
  run: DesktopWorkflowRun;
  controller: AbortController;
  completion: Promise<void>;
};

export class LocalWorkflowRuntime {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly drafts: WorkflowDraftReader,
    private readonly runs: WorkflowRunRepository,
    private readonly executeNode: LocalWorkflowNodeExecutor,
    private readonly onEvent?: (event: DesktopWorkflowRunEvent) => void
  ) {}

  run(
    localProjectId: string,
    workflowId: string,
    input: Record<string, unknown> = {}
  ): DesktopWorkflowRun {
    const draft = this.requireDraft(localProjectId, workflowId, "workflow");
    const order = topologicalOrder(draft);
    const run = createRun(draft, input);
    this.persist(run);
    const controller = new AbortController();
    const active: ActiveRun = {
      run,
      controller,
      completion: Promise.resolve()
    };
    active.completion = this.executeRun(active, draft, order)
      .catch(() => undefined)
      .finally(() => this.activeRuns.delete(run.runId));
    this.activeRuns.set(run.runId, active);
    return structuredClone(run);
  }

  get(runId: string): DesktopWorkflowRun | null {
    return this.runs.get(runId);
  }

  list(localProjectId: string, workflowId?: string): DesktopWorkflowRun[] {
    return this.runs.list(localProjectId, workflowId);
  }

  cancel(runId: string): DesktopWorkflowRun {
    const active = this.activeRuns.get(runId);
    const run = active?.run ?? this.runs.get(runId);
    if (!run) throw new Error("Workflow run not found.");
    if (isTerminal(run.status)) return structuredClone(run);

    active?.controller.abort();
    const now = new Date().toISOString();
    run.status = "canceled";
    run.error = "Workflow run was canceled.";
    run.finishedAt = now;
    for (const nodeRun of run.nodeRuns) {
      if (
        nodeRun.status === "pending" ||
        nodeRun.status === "running" ||
        nodeRun.status === "waiting_for_user"
      ) {
        nodeRun.status = "canceled";
        nodeRun.error = "Workflow run was canceled.";
        nodeRun.finishedAt = now;
      }
    }
    return this.persist(run);
  }

  retry(runId: string): DesktopWorkflowRun {
    const previous = this.runs.get(runId);
    if (!previous) throw new Error("Workflow run not found.");
    if (!isTerminal(previous.status)) {
      throw new Error("A running Workflow cannot be retried.");
    }
    return this.run(previous.localProjectId, previous.workflowId, previous.input);
  }

  resume(runId: string): DesktopWorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Workflow run not found.");
    if (run.status !== "waiting_for_user") {
      throw new Error("Only a Workflow waiting for user action can be resumed.");
    }
    const draft = this.requireDraft(run.localProjectId, run.workflowId, "workflow");
    const order = topologicalOrder(draft);
    const waitingIndex = order.findIndex((node) =>
      run.nodeRuns.some(
        (nodeRun) =>
          nodeRun.nodeId === node.nodeId &&
          nodeRun.status === "waiting_for_user"
      )
    );
    if (waitingIndex < 0) {
      throw new Error("Workflow waiting node was not found.");
    }
    const outputs = new Map<string, unknown>();
    for (const nodeRun of run.nodeRuns) {
      if (nodeRun.status === "succeeded") {
        outputs.set(nodeRun.nodeId, nodeRun.output);
      } else if (nodeRun.status === "waiting_for_user") {
        nodeRun.attempt += 1;
      }
    }
    const controller = new AbortController();
    const active: ActiveRun = {
      run,
      controller,
      completion: Promise.resolve()
    };
    run.error = null;
    run.finishedAt = null;
    active.completion = this.executeRun(
      active,
      draft,
      order.slice(waitingIndex),
      outputs
    )
      .catch(() => undefined)
      .finally(() => this.activeRuns.delete(run.runId));
    this.activeRuns.set(run.runId, active);
    return this.persist(run);
  }

  async waitForRun(runId: string): Promise<DesktopWorkflowRun | null> {
    await this.activeRuns.get(runId)?.completion;
    return this.runs.get(runId);
  }

  cancelAll(): void {
    for (const runId of [...this.activeRuns.keys()]) {
      this.cancel(runId);
    }
  }

  private async executeRun(
    active: ActiveRun,
    draft: DesktopWorkflowDraft,
    order: DesktopWorkflowDraftNode[],
    outputs = new Map<string, unknown>()
  ): Promise<void> {
    const { run, controller } = active;
    const startedAt = new Date().toISOString();
    run.status = "running";
    run.startedAt = startedAt;
    this.persist(run);

    try {
      const output = await this.executeDraft(
        draft,
        run.input,
        controller.signal,
        new Set([draft.workflowId]),
        order,
        run,
        outputs
      );
      if (controller.signal.aborted) return;
      run.status = "succeeded";
      run.output = output;
      run.finishedAt = new Date().toISOString();
      this.persist(run);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (requiresUserAction(error)) {
        run.status = "waiting_for_user";
        run.error = error instanceof Error
          ? error.message
          : "Workflow is waiting for user action.";
        run.finishedAt = null;
        this.persist(run);
        return;
      }
      const now = new Date().toISOString();
      run.status = "failed";
      run.error = error instanceof Error ? error.message : "Unknown Workflow error";
      run.finishedAt = now;
      for (const nodeRun of run.nodeRuns) {
        if (nodeRun.status === "pending") {
          nodeRun.status = "skipped";
          nodeRun.error = "Skipped because a previous node failed.";
          nodeRun.finishedAt = now;
        }
      }
      this.persist(run);
    }
  }

  private async executeDraft(
    draft: DesktopWorkflowDraft,
    workflowInput: Record<string, unknown>,
    signal: AbortSignal,
    actionStack: Set<string>,
    order = topologicalOrder(draft),
    run?: DesktopWorkflowRun,
    outputs = new Map<string, unknown>()
  ): Promise<unknown> {
    for (const node of order) {
      throwIfAborted(signal);
      const nodeInput = buildNodeInput(draft, node, workflowInput, outputs);
      const nodeRun = run?.nodeRuns.find((candidate) => candidate.nodeId === node.nodeId);
      if (nodeRun) {
        nodeRun.status = "running";
        nodeRun.input = nodeInput;
        nodeRun.startedAt = new Date().toISOString();
        this.persist(run!);
      }

      try {
        const actionId = localActionId(node.executorKey);
        const output = actionId
          ? await this.executeLocalAction(
              draft.localProjectId,
              actionId,
              nodeInput,
              signal,
              actionStack
            )
          : await this.executeNode(node, nodeInput, signal);
        throwIfAborted(signal);
        outputs.set(node.nodeId, output);
        if (nodeRun) {
          nodeRun.status = "succeeded";
          nodeRun.output = output;
          nodeRun.finishedAt = new Date().toISOString();
          this.persist(run!);
        }
      } catch (error) {
        if (nodeRun && nodeRun.status !== "canceled") {
          nodeRun.status = signal.aborted
            ? "canceled"
            : requiresUserAction(error)
              ? "waiting_for_user"
              : "failed";
          nodeRun.error = error instanceof Error ? error.message : "Unknown node error";
          nodeRun.finishedAt = requiresUserAction(error)
            ? null
            : new Date().toISOString();
          this.persist(run!);
        }
        throw error;
      }
    }
    return collectWorkflowOutput(draft, workflowInput, outputs);
  }

  private async executeLocalAction(
    localProjectId: string,
    workflowId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    actionStack: Set<string>
  ): Promise<unknown> {
    if (actionStack.has(workflowId)) {
      throw new Error("Reusable local action recursion was detected.");
    }
    const draft = this.requireDraft(localProjectId, workflowId, "local_action");
    const nextStack = new Set(actionStack);
    nextStack.add(workflowId);
    return this.executeDraft(draft, input, signal, nextStack);
  }

  private requireDraft(
    localProjectId: string,
    workflowId: string,
    kind: DesktopWorkflowDraft["kind"]
  ): DesktopWorkflowDraft {
    const draft = this.drafts.get(localProjectId, workflowId);
    if (!draft) throw new Error("Workflow draft not found.");
    if (draft.kind !== kind) {
      throw new Error(
        kind === "workflow"
          ? "Only a saved Workflow can be run directly."
          : "Referenced local action is invalid."
      );
    }
    return draft;
  }

  private persist(run: DesktopWorkflowRun): DesktopWorkflowRun {
    const saved = this.runs.save(run);
    this.onEvent?.({ type: "updated", run: saved });
    return saved;
  }
}

export function topologicalOrder(
  draft: DesktopWorkflowDraft
): DesktopWorkflowDraftNode[] {
  const nodes = new Map(draft.nodes.map((node) => [node.nodeId, node]));
  const indegree = new Map(draft.nodes.map((node) => [node.nodeId, 0]));
  const outgoing = new Map(draft.nodes.map((node) => [node.nodeId, [] as string[]]));
  for (const edge of draft.edges) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) {
      throw new Error("Workflow contains an edge with an unknown node.");
    }
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }
  const ready = draft.nodes
    .filter((node) => indegree.get(node.nodeId) === 0)
    .sort(compareNodes);
  const result: DesktopWorkflowDraftNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    result.push(node);
    for (const targetId of outgoing.get(node.nodeId)!.sort()) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        ready.push(nodes.get(targetId)!);
        ready.sort(compareNodes);
      }
    }
  }
  if (result.length !== draft.nodes.length) {
    throw new Error("Workflow graph contains a cycle.");
  }
  return result;
}

function createRun(
  draft: DesktopWorkflowDraft,
  input: Record<string, unknown>
): DesktopWorkflowRun {
  const now = new Date().toISOString();
  return {
    runId: makeId("run"),
    workflowId: draft.workflowId,
    workflowName: draft.name,
    localProjectId: draft.localProjectId,
    ...(draft.sourceSkill
      ? { sourceSkill: structuredClone(draft.sourceSkill) }
      : {}),
    status: "queued",
    input: structuredClone(input),
    output: null,
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    nodeRuns: draft.nodes.map((node) => ({
      nodeRunId: makeId("node_run"),
      nodeId: node.nodeId,
      executorKey: node.executorKey,
      title: node.title,
      status: "pending",
      input: null,
      output: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      attempt: 1
    }))
  };
}

function buildNodeInput(
  draft: DesktopWorkflowDraft,
  node: DesktopWorkflowDraftNode,
  workflowInput: Record<string, unknown>,
  outputs: Map<string, unknown>
): Record<string, unknown> {
  const incomingEdges = draft.edges
    .filter((edge) => edge.targetNodeId === node.nodeId)
    .sort((left, right) =>
      left.sourceNodeId.localeCompare(right.sourceNodeId) ||
      left.edgeId.localeCompare(right.edgeId));
  const predecessorIds = incomingEdges.map((edge) => edge.sourceNodeId);
  const upstream = Object.fromEntries(
    predecessorIds.map((nodeId) => [nodeId, outputs.get(nodeId)])
  );
  const portInputs = incomingEdges.reduce<Record<string, unknown>>(
    (values, edge) => {
      if (!edge.targetPortId) return values;
      const output = readPortOutput(outputs.get(edge.sourceNodeId), edge.sourcePortId);
      if (!(edge.targetPortId in values)) {
        values[edge.targetPortId] = output;
      } else {
        const current = values[edge.targetPortId];
        values[edge.targetPortId] = Array.isArray(current)
          ? [...current, output]
          : [current, output];
      }
      return values;
    },
    {}
  );
  const singleOutput = predecessorIds.length === 1
    ? outputs.get(predecessorIds[0]!)
    : null;
  return {
    ...workflowInput,
    ...(isRecord(singleOutput) ? singleOutput : {}),
    ...portInputs,
    ...node.config,
    $localProjectId: draft.localProjectId,
    $workflow: workflowInput,
    $upstream: upstream
  };
}

function readPortOutput(output: unknown, sourcePortId: string | undefined): unknown {
  return sourcePortId && isRecord(output) && sourcePortId in output
    ? output[sourcePortId]
    : output;
}

function collectWorkflowOutput(
  draft: DesktopWorkflowDraft,
  workflowInput: Record<string, unknown>,
  outputs: Map<string, unknown>
): unknown {
  if (!draft.nodes.length) return workflowInput;
  const sourceIds = new Set(draft.edges.map((edge) => edge.sourceNodeId));
  const sinkIds = draft.nodes
    .filter((node) => !sourceIds.has(node.nodeId))
    .map((node) => node.nodeId)
    .sort();
  if (sinkIds.length === 1) return outputs.get(sinkIds[0]!);
  return {
    outputs: Object.fromEntries(sinkIds.map((nodeId) => [nodeId, outputs.get(nodeId)]))
  };
}

function compareNodes(left: DesktopWorkflowDraftNode, right: DesktopWorkflowDraftNode): number {
  return left.y - right.y || left.x - right.x || left.nodeId.localeCompare(right.nodeId);
}

function localActionId(executorKey: string): string | null {
  const prefix = "subworkflow.local.";
  return executorKey.startsWith(prefix) ? executorKey.slice(prefix.length) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTerminal(status: DesktopWorkflowRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function requiresUserAction(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "WORKFLOW_USER_ACTION_REQUIRED"
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw Object.assign(new Error("Workflow run was canceled."), {
    name: "AbortError",
    code: "WORKFLOW_CANCELED"
  });
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
