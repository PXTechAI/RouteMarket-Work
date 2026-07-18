import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DesktopWorkflowRun } from "../shared/desktop-api";
import { WorkflowRunStore } from "./workflow-run-store";

describe("WorkflowRunStore", () => {
  let directory: string;
  let store: WorkflowRunStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "routemarket-workflow-run-"));
    store = new WorkflowRunStore(join(directory, "work.db"));
  });

  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists run and node timeline updates", () => {
    const run = createRun();
    store.save(run);
    run.status = "running";
    run.startedAt = "2026-07-18T01:00:01.000Z";
    run.nodeRuns[0]!.status = "running";
    store.save(run);

    expect(store.get(run.runId)).toEqual(run);
  });

  it("lists runs by project and workflow newest first", () => {
    store.save(createRun("run_first1", "workflow_first", "2026-07-18T01:00:00.000Z"));
    store.save(createRun("run_second", "workflow_second", "2026-07-18T02:00:00.000Z"));

    expect(store.list("project_test").map((run) => run.runId)).toEqual([
      "run_second",
      "run_first1"
    ]);
    expect(store.list("project_test", "workflow_first").map((run) => run.runId)).toEqual([
      "run_first1"
    ]);
  });
});

function createRun(
  runId = "run_example1",
  workflowId = "workflow_test",
  createdAt = "2026-07-18T01:00:00.000Z"
): DesktopWorkflowRun {
  return {
    runId,
    workflowId,
    workflowName: "Local workflow",
    localProjectId: "project_test",
    status: "queued",
    input: { path: "README.md" },
    output: null,
    error: null,
    createdAt,
    startedAt: null,
    finishedAt: null,
    nodeRuns: [{
      nodeRunId: "node_run_read1",
      nodeId: "node_read1",
      executorKey: "local.fs.read",
      title: "Read file",
      status: "pending",
      input: null,
      output: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      attempt: 1
    }]
  };
}
