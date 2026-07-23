import { randomUUID } from "node:crypto";
import type {
  DesktopWorkflowCloudRuntime,
  DesktopWorkflowDraftNode
} from "../shared/desktop-api";
import type { RouteMarketApiClient } from "./routemarket-api-client";

type CloudWorkflowClientOptions = {
  apiClient: RouteMarketApiClient;
  pollIntervalMs?: number;
};

type AsyncTaskResponse = {
  id?: unknown;
  task_id?: unknown;
  status?: unknown;
  output?: unknown;
  error?: unknown;
};

const ACTIVE_STATUSES = new Set(["queued", "retrying", "processing"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "canceled", "timeout"]);

export class CloudWorkflowClient {
  private readonly pollIntervalMs: number;

  constructor(private readonly options: CloudWorkflowClientOptions) {
    this.pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1_000);
  }

  async executeNode(
    node: DesktopWorkflowDraftNode,
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<unknown> {
    throwIfAborted(signal);
    const runtime = node.definitionSnapshot.cloudRuntime;
    if (!runtime) {
      throw new Error(
        `Cloud node ${node.executorKey} is missing its RouteMarket runtime definition. Refresh the cloud node catalog and add the node again.`
      );
    }

    const requestId = `work_workflow_${randomUUID().replaceAll("-", "")}`;
    let taskId: string | null = null;
    let cancellation: Promise<void> | null = null;
    const cancelOnce = () => {
      if (!taskId) return Promise.resolve();
      cancellation ??= this.cancelTask(taskId);
      return cancellation;
    };

    try {
      const submitted = await this.request<AsyncTaskResponse>(
        "/api/app/v1/workflows/execute",
        {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId
          },
          body: JSON.stringify(buildWorkflowRequest(node, input, runtime, requestId))
        }
      );
      taskId = readTaskId(submitted);

      while (true) {
        throwIfAborted(signal);
        const task = await this.request<AsyncTaskResponse>(
          `/api/app/v1/workflows/executions/${encodeURIComponent(taskId)}`,
          { signal }
        );
        const status = typeof task.status === "string" ? task.status.toLowerCase() : "";
        if (status === "succeeded") return readWorkflowOutput(task.output);
        if (status === "failed" || status === "timeout") {
          throw new Error(readTaskError(task.error, status));
        }
        if (status === "cancelled" || status === "canceled") {
          throw canceledError();
        }
        if (!ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) {
          throw new Error(
            `RouteMarket returned an unknown Workflow task status: ${status || "missing"}.`
          );
        }
        await waitForPoll(this.pollIntervalMs, signal);
      }
    } catch (error) {
      if (signal.aborted) {
        await cancelOnce().catch(() => undefined);
        throw canceledError();
      }
      throw error;
    } finally {
      if (signal.aborted) {
        await cancelOnce().catch(() => undefined);
      }
    }
  }

  private async cancelTask(taskId: string): Promise<void> {
    await this.request(
      `/api/app/v1/workflows/executions/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" }
    );
  }

  private async request<TResult>(
    path: string,
    init: RequestInit = {}
  ): Promise<TResult> {
    const response = await this.options.apiClient.request(path, init, "required");
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("RouteMarket cloud access requires you to sign in again.");
      }
      throw new Error(readResponseError(payload, response.status));
    }
    return payload as TResult;
  }
}

function buildWorkflowRequest(
  node: DesktopWorkflowDraftNode,
  input: Record<string, unknown>,
  runtime: DesktopWorkflowCloudRuntime,
  requestId: string
) {
  return {
    request_id: requestId,
    nodes: [{
      id: node.nodeId,
      data: {
        title: node.title,
        nodeType: runtime.nodeType,
        kind: runtime.kind,
        executionMode: runtime.executionMode,
        joinStrategy: runtime.joinStrategy,
        config: withoutRuntimeFields(input),
        runtime: {
          executorKey: node.executorKey,
          executionTarget: "cloud"
        },
        inputPorts: runtime.inputPorts,
        outputPorts: runtime.outputPorts
      }
    }],
    edges: [],
    settings: {}
  };
}

function readTaskId(payload: AsyncTaskResponse): string {
  const value = payload.id ?? payload.task_id;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("RouteMarket did not return a Workflow task ID.");
  }
  return value;
}

function readWorkflowOutput(output: unknown): unknown {
  if (!isRecord(output)) return output;
  const report = isRecord(output.report) ? output.report : null;
  const finalOutputs = report?.finalOutputs;
  if (!Array.isArray(finalOutputs)) return output;
  if (finalOutputs.length === 0) return null;
  const values = finalOutputs.map(readFinalPayload);
  return values.length === 1 ? values[0] : values;
}

function readFinalPayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const type = typeof value.type === "string" ? value.type : "";
  const text = typeof value.text === "string" ? value.text : "";
  const metadata = isRecord(value.metadata) ? value.metadata : null;

  if (type === "text") return text || metadata || value;
  if (type === "structured") {
    if (metadata) {
      for (const key of ["value", "data", "output", "result"]) {
        if (key in metadata) return metadata[key];
      }
      return metadata;
    }
    return text || value;
  }
  if (type === "image" || type === "video" || type === "audio") {
    return metadata?.output_url ?? metadata?.url ?? value;
  }
  return text || metadata || value;
}

function readTaskError(error: unknown, status: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return status === "timeout"
    ? "RouteMarket cloud Workflow execution timed out."
    : "RouteMarket cloud Workflow execution failed.";
}

function readResponseError(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message) && message.length) return String(message[0]);
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }
  return `RouteMarket Workflow request failed (${status}).`;
}

function withoutRuntimeFields(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !key.startsWith("$"))
  );
}

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(canceledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw canceledError();
}

function canceledError(): Error {
  return Object.assign(new Error("Workflow run was canceled."), {
    name: "AbortError",
    code: "WORKFLOW_CANCELED"
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
