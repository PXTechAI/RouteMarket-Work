import { describe, expect, it } from "vitest";
import { isIgnorableBrowserRuntimeError } from "./RuntimeErrorBoundary";

describe("RuntimeErrorBoundary browser warning classification", () => {
  it.each([
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
  ])("ignores the non-fatal browser ResizeObserver warning: %s", (message) => {
    expect(isIgnorableBrowserRuntimeError(message)).toBe(true);
    expect(isIgnorableBrowserRuntimeError(new Error(message))).toBe(true);
  });

  it("keeps real renderer errors visible", () => {
    expect(isIgnorableBrowserRuntimeError("Workflow execution failed")).toBe(false);
    expect(isIgnorableBrowserRuntimeError(new Error("Network request failed"))).toBe(false);
    expect(isIgnorableBrowserRuntimeError(null)).toBe(false);
  });
});
