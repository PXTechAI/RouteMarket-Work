import { describe, expect, it } from "vitest";
import type { ApprovalPolicy } from "../shared/desktop-api";
import type { ToolAuthorizationRequest } from "./tool-broker";
import {
  approvalDialogChoices,
  resolveStoredApprovalPolicy
} from "./approval-policy";

function request(
  risk: ToolAuthorizationRequest["risk"],
  projectId: string | undefined = "project_1"
): ToolAuthorizationRequest {
  return {
    invocationId: "tool_1",
    capability: "local.process.start",
    risk,
    title: "Start process",
    detail: "pnpm dev",
    projectId
  };
}

function policy(effect: ApprovalPolicy["effect"]): ApprovalPolicy {
  return {
    policyId: "policy_1",
    capability: "local.process.start",
    projectId: "project_1",
    effect,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

describe("approval policy", () => {
  it("offers project allow and deny choices for scoped R1 and R2 requests", () => {
    expect(approvalDialogChoices(request("R2"))).toEqual([
      "deny_once",
      "allow_once",
      "allow_project",
      "deny_project"
    ]);
  });

  it("never offers or applies a persistent allow policy to R3 requests", () => {
    expect(approvalDialogChoices(request("R3"))).toEqual([
      "deny_once",
      "allow_once",
      "deny_project"
    ]);
    expect(resolveStoredApprovalPolicy(request("R3"), policy("allow"))).toBeNull();
    expect(resolveStoredApprovalPolicy(request("R3"), policy("deny"))).toBe("deny");
  });

  it("keeps unscoped requests one-time only and rejects mismatched policies", () => {
    expect(approvalDialogChoices({
      ...request("R2"),
      projectId: undefined
    })).toEqual([
      "deny_once",
      "allow_once"
    ]);
    expect(resolveStoredApprovalPolicy(request("R2", "project_2"), policy("allow"))).toBeNull();
  });
});
