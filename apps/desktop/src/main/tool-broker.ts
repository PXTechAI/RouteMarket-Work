import { randomUUID } from "node:crypto";

export type ToolRisk = "R0" | "R1" | "R2" | "R3";
export type ToolApprovalMode = "always_ask" | "risky_only" | "never_ask";
export type StoredToolApprovalDecision = "allow" | "deny" | null;
export type ToolApprovalGate = "allow" | "deny" | "prompt";

export type ToolAuthorizationRequest = {
  invocationId: string;
  capability: string;
  risk: ToolRisk;
  title: string;
  detail: string;
  auditDetail?: string;
  approvalKey?: string;
  projectId?: string;
  approvalMode?: ToolApprovalMode;
};

export type ToolAuthorizationDecision = "requested" | "approved" | "denied";

export type ToolAuthorizationDecisionListener = (
  request: ToolAuthorizationRequest,
  decision: ToolAuthorizationDecision
) => void | Promise<void>;

export class ToolApprovalDeniedError extends Error {
  readonly code = "TOOL_APPROVAL_DENIED";

  constructor() {
    super("The local Tool operation was not approved.");
    this.name = "ToolApprovalDeniedError";
  }
}

export function resolveToolApprovalGate(
  approvalMode: ToolApprovalMode | undefined,
  storedDecision: StoredToolApprovalDecision
): ToolApprovalGate {
  if (storedDecision === "deny") return "deny";
  if (storedDecision === "allow" && approvalMode !== "always_ask") return "allow";
  if (approvalMode === "never_ask") return "deny";
  return "prompt";
}

export class LocalToolBroker {
  constructor(
    private readonly confirm: (request: ToolAuthorizationRequest) => Promise<boolean>,
    private readonly onDecision?: ToolAuthorizationDecisionListener
  ) {}

  async run<TResult>(
    input: Omit<ToolAuthorizationRequest, "invocationId">,
    operation: () => Promise<TResult>,
    onDecision?: ToolAuthorizationDecisionListener
  ): Promise<TResult> {
    const request: ToolAuthorizationRequest = {
      ...input,
      invocationId: `tool_${randomUUID().replaceAll("-", "")}`
    };
    if (request.risk !== "R0" || request.approvalMode === "always_ask") {
      await this.notifyDecision(request, "requested", onDecision);
      const approved = await this.confirm(request);
      await this.notifyDecision(request, approved ? "approved" : "denied", onDecision);
      if (!approved) throw new ToolApprovalDeniedError();
    }
    return operation();
  }

  private async notifyDecision(
    request: ToolAuthorizationRequest,
    decision: ToolAuthorizationDecision,
    listener?: ToolAuthorizationDecisionListener
  ): Promise<void> {
    await this.onDecision?.(request, decision);
    await listener?.(request, decision);
  }
}
