import { isAbsolute } from "node:path";
import type { DesktopWorkflowRun } from "../shared/desktop-api";

export function workflowArtifactPath(
  run: Pick<DesktopWorkflowRun, "status" | "nodeRuns">
): string | null {
  if (run.status !== "succeeded") return null;
  const exportNode = [...run.nodeRuns].reverse().find(
    (nodeRun) =>
      nodeRun.executorKey === "local.data.csv_export" &&
      nodeRun.status === "succeeded"
  );
  const output = exportNode?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const savedPath = (output as { savedPath?: unknown }).savedPath;
  return typeof savedPath === "string" &&
    savedPath.length <= 32_768 &&
    isAbsolute(savedPath)
    ? savedPath
    : null;
}
