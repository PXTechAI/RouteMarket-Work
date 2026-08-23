import { describe, expect, it } from "vitest";
import type { DesktopWorkflowRun } from "../../../../shared/desktop-api";
import {
  shouldAutoOpenWorkflowRunPanel,
  shouldRevealWorkflowBrowser,
  workflowRunBrowserResumeUrl,
  workflowRunNeedsBrowserTakeover,
} from "./workflow-run-visibility";

describe("workflow run visibility", () => {
  it("auto-opens the run panel and browser while a browser workflow is active", () => {
    const run = workflowRun("running", "running");

    expect(shouldAutoOpenWorkflowRunPanel(run)).toBe(true);
    expect(shouldRevealWorkflowBrowser(run)).toBe(true);
    expect(workflowRunNeedsBrowserTakeover(run)).toBe(false);
  });

  it("focuses the workflow browser when its browser node needs takeover", () => {
    const run = workflowRun("waiting_for_user", "waiting_for_user");
    run.nodeRuns[0]!.input = { sourceUrl: "https://www.amazon.com/dp/B000TEST" };

    expect(shouldAutoOpenWorkflowRunPanel(run)).toBe(true);
    expect(shouldRevealWorkflowBrowser(run)).toBe(true);
    expect(workflowRunNeedsBrowserTakeover(run)).toBe(true);
    expect(workflowRunBrowserResumeUrl(run)).toBe("https://www.amazon.com/dp/B000TEST");
  });

  it("restores the QQ Mail login page for a mail takeover", () => {
    const run = workflowRun("waiting_for_user", "waiting_for_user");
    run.nodeRuns[0]!.executorKey = "local.browser.qq_mail_send";

    expect(workflowRunBrowserResumeUrl(run)).toBe("https://mail.qq.com/");
  });

  it("does not reopen a browser for a completed run", () => {
    const run = workflowRun("succeeded", "succeeded");

    expect(shouldAutoOpenWorkflowRunPanel(run)).toBe(false);
    expect(shouldRevealWorkflowBrowser(run)).toBe(false);
    expect(workflowRunNeedsBrowserTakeover(run)).toBe(false);
    expect(workflowRunBrowserResumeUrl(run)).toBeNull();
  });
});

function workflowRun(
  status: DesktopWorkflowRun["status"],
  nodeStatus: DesktopWorkflowRun["nodeRuns"][number]["status"],
): DesktopWorkflowRun {
  return {
    runId: "run_1",
    workflowId: "workflow_1",
    workflowName: "Browser workflow",
    localProjectId: "project_1",
    status,
    input: {},
    output: null,
    error: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    startedAt: "2026-08-19T00:00:01.000Z",
    finishedAt: status === "succeeded" ? "2026-08-19T00:00:02.000Z" : null,
    nodeRuns: [
      {
        nodeRunId: "node_run_1",
        nodeId: "node_1",
        title: "Open page",
        executorKey: "local.browser.navigate",
        status: nodeStatus,
        input: {},
        output: null,
        error: null,
        startedAt: "2026-08-19T00:00:01.000Z",
        finishedAt: nodeStatus === "succeeded" ? "2026-08-19T00:00:02.000Z" : null,
        attempt: 1,
      },
    ],
  };
}
