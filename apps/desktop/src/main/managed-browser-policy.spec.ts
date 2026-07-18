import { describe, expect, it } from "vitest";
import { assertSafeBrowserText, assertSafeSelector, normalizeBrowserUrl } from "./managed-browser-policy";

describe("Managed Browser policy", () => {
  it("normalizes web addresses and preserves local development URLs", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserUrl("http://localhost:3000/app")).toBe("http://localhost:3000/app");
  });

  it("blocks dangerous schemes and credential-bearing URLs", () => {
    expect(() => normalizeBrowserUrl("file:///C:/secret.txt")).toThrow("HTTP");
    expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow("HTTP");
    expect(() => normalizeBrowserUrl("https://user:password@example.com")).toThrow("credentials");
  });

  it("validates automation selectors and text limits", () => {
    expect(assertSafeSelector("#submit")).toBe("#submit");
    expect(() => assertSafeSelector(" ")).toThrow("selector");
    expect(() => assertSafeBrowserText("x".repeat(100_001))).toThrow("limits");
  });
});
