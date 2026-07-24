import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopWorkflowDraft,
  DesktopWorkflowDraftNode
} from "../shared/desktop-api";
import { createLocalWorkflowNodeExecutor } from "./local-workflow-node-executor";
import { LocalWorkflowRuntime } from "./local-workflow-runtime";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import type { NativeAppConnectorManager } from "./native-app-connector-manager";
import { LocalToolBroker } from "./tool-broker";
import type { WorkerClient } from "./worker-client";
import { WorkflowRunStore } from "./workflow-run-store";

let temporaryDirectory: string | null = null;
let runStore: WorkflowRunStore | null = null;

afterEach(async () => {
  runStore?.close();
  runStore = null;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = null;
});

describe("Amazon price Workflow", () => {
  it("navigates, recognizes one product, and exports a local CSV", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-amazon-flow-"));
    runStore = new WorkflowRunStore(join(temporaryDirectory, "work.db"));
    const navigate = vi.fn(async () => ({ activePageId: "page_amazon" }));
    const extract = vi.fn(async (
      _localProjectId: string,
      selector: string
    ) => {
      if (selector === "#productTitle") return "Workflow Demo Product";
      if (selector === ".priceToPay .a-offscreen") return "$88.50";
      throw new Error("Browser element not found");
    });
    const browser = { navigate, extract } as unknown as ManagedBrowserManager;
    const draft = amazonDraft(temporaryDirectory);
    const executor = createLocalWorkflowNodeExecutor({
      cloudWorkflowClient: {
        executeNode: vi.fn(async () => {
          throw new Error("Cloud execution is not expected.");
        })
      },
      workerClient: {} as WorkerClient,
      toolBroker: new LocalToolBroker(vi.fn(async () => true)),
      getBrowser: () => browser,
      nativeAppConnectors: {} as NativeAppConnectorManager
    });
    const runtime = new LocalWorkflowRuntime(
      { get: () => draft },
      runStore,
      executor
    );

    const queued = runtime.run("project_1", draft.workflowId);
    const finished = await runtime.waitForRun(queued.runId);

    expect(finished?.status).toBe("succeeded");
    expect(finished?.nodeRuns.map((nodeRun) => nodeRun.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded"
    ]);
    expect(navigate).toHaveBeenCalledWith(
      "project_1",
      "https://www.amazon.com/dp/test",
      undefined,
      { source: "workflow" }
    );
    const output = finished?.output as { savedPath: string; rowCount: number };
    expect(output.rowCount).toBe(1);
    const csv = await readFile(output.savedPath, "utf8");
    expect(csv).toContain("Workflow Demo Product");
    expect(csv).toContain("$88.50");
  });
});

function amazonDraft(outputDirectory: string): DesktopWorkflowDraft {
  const nodes: DesktopWorkflowDraftNode[] = [
    workflowNode("navigate", "local.browser.navigate", {
      url: "https://www.amazon.com/dp/test"
    }),
    workflowNode("extract", "local.browser.product_extract", {
      sourceUrl: "https://www.amazon.com/dp/test"
    }),
    workflowNode("export", "local.data.csv_export", {
      outputDirectory,
      fileName: "amazon-price.csv"
    })
  ];
  return {
    workflowId: "workflow_amazon_test",
    localProjectId: "project_1",
    kind: "workflow",
    name: "Amazon 单品价格采集",
    nodes,
    edges: [
      {
        edgeId: "edge_navigate_extract",
        sourceNodeId: "navigate",
        targetNodeId: "extract"
      },
      {
        edgeId: "edge_extract_export",
        sourceNodeId: "extract",
        targetNodeId: "export"
      }
    ],
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z"
  };
}

function workflowNode(
  nodeId: string,
  executorKey: string,
  config: Record<string, unknown>
): DesktopWorkflowDraftNode {
  return {
    nodeId,
    executorKey,
    title: executorKey,
    executionTarget: "desktop",
    x: 0,
    y: 0,
    config,
    definitionSnapshot: {
      executorKey,
      definitionVersion: 1,
      source: "desktop_builtin",
      executionTarget: "desktop",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [executorKey],
      portability: "device_bound",
      definitionHash: `sha256:${"a".repeat(64)}`,
      title: executorKey,
      description: executorKey,
      available: true,
      blockedReason: null
    }
  };
}
