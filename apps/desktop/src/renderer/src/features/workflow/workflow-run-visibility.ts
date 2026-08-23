import type { DesktopWorkflowRun } from "../../../../shared/desktop-api";

const ACTIVE_RUN_STATUSES = new Set<DesktopWorkflowRun["status"]>([
  "queued",
  "running",
  "waiting_for_user",
]);

export function shouldAutoOpenWorkflowRunPanel(run: DesktopWorkflowRun | null): boolean {
  return Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
}

export function shouldRevealWorkflowBrowser(run: DesktopWorkflowRun | null): boolean {
  return Boolean(
    shouldAutoOpenWorkflowRunPanel(run) &&
      run?.nodeRuns.some((node) => node.executorKey.startsWith("local.browser.")),
  );
}

export function workflowRunNeedsBrowserTakeover(run: DesktopWorkflowRun): boolean {
  return (
    run.status === "waiting_for_user" &&
    run.nodeRuns.some(
      (node) =>
        node.status === "waiting_for_user" && node.executorKey.startsWith("local.browser."),
    )
  );
}

export function workflowRunBrowserResumeUrl(run: DesktopWorkflowRun | null): string | null {
  if (!run || run.status !== "waiting_for_user") return null;
  const waitingNode = run.nodeRuns.find(
    (node) =>
      node.status === "waiting_for_user" && node.executorKey.startsWith("local.browser."),
  );
  if (!waitingNode) return null;

  const directUrl = urlFromValue(waitingNode.input);
  if (directUrl) return directUrl;
  if (waitingNode.executorKey === "local.browser.qq_mail_send") {
    return "https://mail.qq.com/";
  }

  for (const node of [...run.nodeRuns].reverse()) {
    if (node.executorKey !== "local.browser.navigate" || node.status !== "succeeded") continue;
    const url = urlFromValue(node.output) ?? urlFromValue(node.input);
    if (url) return url;
  }
  return null;
}

function urlFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["url", "sourceUrl", "pageUrl", "loginUrl"]) {
    const candidate = record[key];
    if (typeof candidate !== "string") continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
    } catch {
      // Ignore values that are not absolute browser URLs.
    }
  }
  return null;
}
