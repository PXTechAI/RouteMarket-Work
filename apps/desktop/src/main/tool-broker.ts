import { randomUUID } from "node:crypto";

export type ToolRisk = "R0" | "R1" | "R2" | "R3";

export type ToolAuthorizationRequest = {
  invocationId: string;
  capability: string;
  risk: ToolRisk;
  title: string;
  detail: string;
  auditDetail?: string;
  approvalKey?: string;
  projectId?: string;
};

export class ToolApprovalDeniedError extends Error {
  readonly code = "TOOL_APPROVAL_DENIED";

  constructor() {
    super("The local Tool operation was not approved.");
    this.name = "ToolApprovalDeniedError";
  }
}

export class LocalToolBroker {
  constructor(
    private readonly confirm: (request: ToolAuthorizationRequest) => Promise<boolean>,
    private readonly onDecision?: (
      request: ToolAuthorizationRequest,
      decision: "requested" | "approved" | "denied"
    ) => void
  ) {}

  async run<TResult>(
    input: Omit<ToolAuthorizationRequest, "invocationId">,
    operation: () => Promise<TResult>
  ): Promise<TResult> {
    const request: ToolAuthorizationRequest = {
      ...input,
      invocationId: `tool_${randomUUID().replaceAll("-", "")}`
    };
    if (request.risk !== "R0") {
      this.onDecision?.(request, "requested");
      const approved = await this.confirm(request);
      this.onDecision?.(request, approved ? "approved" : "denied");
      if (!approved) throw new ToolApprovalDeniedError();
    }
    return operation();
  }
}
