import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "./approval-store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "routemarket-approvals-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "work.db");
  return { databasePath, store: new ApprovalStore(databasePath) };
}

describe("ApprovalStore", () => {
  it("persists decisions and only stores a parameter hash", async () => {
    const value = await fixture();
    let store = value.store;
    const secretParameter = "--token super-secret-value";
    store.request({
      invocationId: "tool_approval_1",
      capability: "local.process.start",
      risk: "R2",
      title: "Start tool",
      detail: secretParameter,
      auditDetail: "node",
      approvalKey: secretParameter,
      projectId: "project_1"
    });
    const resolved = store.resolve("tool_approval_1", "approved");
    expect(resolved).toMatchObject({
      status: "approved",
      detail: "node",
      projectId: "project_1"
    });
    expect(JSON.stringify(resolved)).not.toContain("super-secret-value");
    expect(resolved?.parametersHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    store.close();
    store = new ApprovalStore(value.databasePath);
    expect(store.get("tool_approval_1")?.status).toBe("approved");
    store.close();
  });

  it("keeps a denied result immutable after resolution", async () => {
    const { store } = await fixture();
    store.request({
      invocationId: "tool_approval_2",
      capability: "local.fs.write",
      risk: "R1",
      title: "Write",
      detail: "README.md"
    });
    store.resolve("tool_approval_2", "denied");
    store.resolve("tool_approval_2", "approved");
    expect(store.get("tool_approval_2")?.status).toBe("denied");
    store.close();
  });

  it("persists and matches project-scoped policies without crossing projects", async () => {
    const value = await fixture();
    let store = value.store;
    const policy = store.setPolicy({
      capability: "local.fs.write",
      projectId: "project_1",
      effect: "allow"
    });

    expect(store.matchPolicy({
      capability: "local.fs.write",
      projectId: "project_1"
    })).toEqual(policy);
    expect(store.matchPolicy({
      capability: "local.fs.write",
      projectId: "project_2"
    })).toBeNull();
    expect(store.matchPolicy({
      capability: "local.fs.write"
    })).toBeNull();

    store.close();
    store = new ApprovalStore(value.databasePath);
    expect(store.listPolicies("project_1")).toEqual([policy]);
    store.close();
  });

  it("replaces a policy decision while preserving its identity and supports revocation", async () => {
    const { store } = await fixture();
    const allowed = store.setPolicy({
      capability: "local.process.start",
      projectId: "project_1",
      effect: "allow"
    });
    const denied = store.setPolicy({
      capability: "local.process.start",
      projectId: "project_1",
      effect: "deny"
    });

    expect(denied).toMatchObject({
      policyId: allowed.policyId,
      capability: "local.process.start",
      projectId: "project_1",
      effect: "deny",
      createdAt: allowed.createdAt
    });
    expect(store.listPolicies()).toHaveLength(1);
    expect(store.removePolicy(denied.policyId)).toBe(true);
    expect(store.removePolicy(denied.policyId)).toBe(false);
    expect(store.listPolicies()).toEqual([]);
    store.close();
  });
});
