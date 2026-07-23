import { describe, expect, it, vi } from "vitest";
import { LocalToolBroker, resolveToolApprovalGate } from "./tool-broker";

describe("LocalToolBroker", () => {
  it("never lets a synced Agent silently lower the device approval boundary", () => {
    expect(resolveToolApprovalGate("never_ask", null)).toBe("deny");
    expect(resolveToolApprovalGate("never_ask", "allow")).toBe("allow");
    expect(resolveToolApprovalGate("always_ask", "allow")).toBe("prompt");
    expect(resolveToolApprovalGate("always_ask", "deny")).toBe("deny");
    expect(resolveToolApprovalGate("risky_only", null)).toBe("prompt");
  });

  it("runs R0 reads without prompting", async () => {
    const confirm = vi.fn(async () => false);
    const broker = new LocalToolBroker(confirm);
    await expect(broker.run({
      capability: "local.fs.read",
      risk: "R0",
      title: "Read file",
      detail: "README.md"
    }, async () => "content")).resolves.toBe("content");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("lets an Agent raise R0 reads to explicit approval", async () => {
    const confirm = vi.fn(async () => true);
    const broker = new LocalToolBroker(confirm);
    await expect(broker.run({
      capability: "local.fs.read",
      risk: "R0",
      title: "Read file",
      detail: "README.md",
      approvalMode: "always_ask"
    }, async () => "content")).resolves.toBe("content");
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      approvalMode: "always_ask",
      risk: "R0"
    }));
  });

  it("requires a positive one-time decision before an R1 side effect", async () => {
    const operation = vi.fn(async () => "saved");
    const decisions: string[] = [];
    const broker = new LocalToolBroker(
      async (request) => request.detail === "safe.txt",
      (_request, decision) => {
        decisions.push(decision);
      }
    );
    await expect(broker.run({
      capability: "local.fs.write",
      risk: "R1",
      title: "Save file",
      detail: "safe.txt"
    }, operation)).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledOnce();
    expect(decisions).toEqual(["requested", "approved"]);
  });

  it("never invokes a denied operation", async () => {
    const operation = vi.fn(async () => "saved");
    const broker = new LocalToolBroker(async () => false);
    await expect(broker.run({
      capability: "local.fs.write",
      risk: "R1",
      title: "Save file",
      detail: "blocked.txt"
    }, operation)).rejects.toMatchObject({ code: "TOOL_APPROVAL_DENIED" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("awaits invocation-specific decision listeners in event order", async () => {
    const order: string[] = [];
    const broker = new LocalToolBroker(
      async () => {
        order.push("confirm");
        return true;
      },
      async (_request, decision) => {
        await Promise.resolve();
        order.push(`global:${decision}`);
      }
    );

    await expect(broker.run({
      capability: "local.browser.navigate",
      risk: "R1",
      title: "Open page",
      detail: "https://example.invalid"
    }, async () => {
      order.push("operation");
      return "done";
    }, async (_request, decision) => {
      await Promise.resolve();
      order.push(`job:${decision}`);
    })).resolves.toBe("done");

    expect(order).toEqual([
      "global:requested",
      "job:requested",
      "confirm",
      "global:approved",
      "job:approved",
      "operation"
    ]);
  });
});
