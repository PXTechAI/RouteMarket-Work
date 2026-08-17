import { trMain } from "./i18n";
import type { ApprovalPolicy } from "../shared/desktop-api";
import type { ToolAuthorizationRequest } from "./tool-broker";

export type ApprovalDialogChoice =
  | "deny_once"
  | "allow_once"
  | "allow_project"
  | "deny_project";

export function resolveStoredApprovalPolicy(
  request: ToolAuthorizationRequest,
  policy: ApprovalPolicy | null
): "allow" | "deny" | null {
  if (
    !policy ||
    !request.projectId ||
    policy.projectId !== request.projectId ||
    policy.capability !== request.capability
  ) {
    return null;
  }
  if (policy.effect === "deny") return "deny";
  return request.risk === "R3" ? null : "allow";
}

export function approvalDialogChoices(
  request: ToolAuthorizationRequest
): ApprovalDialogChoice[] {
  const choices: ApprovalDialogChoice[] = ["deny_once", "allow_once"];
  if (!request.projectId) return choices;
  if (request.risk !== "R3") choices.push("allow_project");
  choices.push("deny_project");
  return choices;
}

export function approvalDialogLabel(choice: ApprovalDialogChoice): string {
  if (choice === "allow_once") return trMain("ui.0273f6d38de4");
  if (choice === "allow_project") return trMain("ui.d773b7c38355");
  if (choice === "deny_project") return trMain("ui.a5b922a59964");
  return trMain("ui.85791ec841d3");
}
