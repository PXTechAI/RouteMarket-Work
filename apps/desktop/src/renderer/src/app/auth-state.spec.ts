import { describe, expect, it } from "vitest";
import type { WorkState } from "../../../shared/desktop-api";
import { signedOutWorkState } from "./auth-state";

describe("signedOutWorkState", () => {
  it("removes authenticated and account-scoped state before showing the login page", () => {
    const state = {
      workerStatus: "online",
      cloudStatus: "online",
      runtimeId: "runtime_1",
      cloudError: "stale cloud error",
      authStatus: "signed_in",
      account: { id: "account_1", displayName: "User", email: "user@example.test" },
      authError: "stale auth error",
      projects: [{
        localProjectId: "project_1",
        displayName: "Private project",
        hasFolder: true,
        rootFingerprint: "sha256:test",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z"
      }],
      activities: [{
        id: "activity_1",
        kind: "cloud.connected",
        title: "Connected",
        detail: "runtime_1",
        occurredAt: "2026-08-15T00:00:00.000Z"
      }],
      approvals: [],
      approvalPolicies: []
    } satisfies WorkState;

    expect(signedOutWorkState(state)).toEqual(expect.objectContaining({
      workerStatus: "online",
      cloudStatus: "disabled",
      runtimeId: null,
      cloudError: null,
      authStatus: "signed_out",
      authError: null,
      projects: [],
      activities: [],
      approvals: [],
      approvalPolicies: []
    }));
    expect(signedOutWorkState(state)).not.toHaveProperty("account");
  });
});
