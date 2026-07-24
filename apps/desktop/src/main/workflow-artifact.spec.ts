import { describe, expect, it } from "vitest";
import type {
  DesktopWorkflowNodeRun,
  DesktopWorkflowRun
} from "../shared/desktop-api";
import { workflowArtifactPath } from "./workflow-artifact";

describe("workflow artifact", () => {
  it("only exposes an absolute path produced by a successful CSV export node", () => {
    const run = createRun([
      nodeRun("local.browser.product_extract", { savedPath: "C:\\unsafe.csv" }),
      nodeRun("local.data.csv_export", { savedPath: "C:\\Exports\\price.csv" })
    ]);

    expect(workflowArtifactPath(run)).toBe("C:\\Exports\\price.csv");
    expect(
      workflowArtifactPath(
        createRun([
          nodeRun("local.data.csv_export", { savedPath: "..\\price.csv" })
        ])
      )
    ).toBeNull();
  });
});

function createRun(nodeRuns: DesktopWorkflowNodeRun[]): DesktopWorkflowRun {
  return {
    runId: "run_artifact",
    workflowId: "workflow_artifact",
    workflowName: "Artifact",
    localProjectId: "project_artifact",
    status: "succeeded",
    input: {},
    output: null,
    error: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    startedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: "2026-07-24T00:00:01.000Z",
    nodeRuns
  };
}

function nodeRun(
  executorKey: string,
  output: unknown
): DesktopWorkflowNodeRun {
  return {
    nodeRunId: `node_run_${executorKey.replaceAll(".", "_")}`,
    nodeId: `node_${executorKey.replaceAll(".", "_")}`,
    executorKey,
    title: executorKey,
    status: "succeeded",
    input: {},
    output,
    error: null,
    startedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: "2026-07-24T00:00:01.000Z",
    attempt: 1
  };
}
