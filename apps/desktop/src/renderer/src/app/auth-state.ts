import type { WorkState } from "../../../shared/desktop-api";

export function signedOutWorkState(state: WorkState): WorkState {
  const { account: _account, ...withoutAccount } = state;
  return {
    ...withoutAccount,
    cloudStatus: "disabled",
    runtimeId: null,
    cloudError: null,
    authStatus: "signed_out",
    authError: null,
    projects: [],
    activities: [],
    approvals: [],
    approvalPolicies: []
  };
}
