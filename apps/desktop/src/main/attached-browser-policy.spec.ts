import { describe, expect, it } from "vitest";
import { assertLocalDevToolsWebSocket, normalizeDevToolsEndpoint } from "./attached-browser-policy";

describe("Attached Browser policy", () => {
  it("accepts explicit localhost DevTools endpoints", () => {
    expect(normalizeDevToolsEndpoint("http://127.0.0.1:9222/")).toBe("http://127.0.0.1:9222");
    expect(assertLocalDevToolsWebSocket("ws://localhost:9222/devtools/page/1"))
      .toBe("ws://localhost:9222/devtools/page/1");
  });

  it("rejects remote, credential-bearing and query endpoints", () => {
    expect(() => normalizeDevToolsEndpoint("https://127.0.0.1:9222")).toThrow("localhost");
    expect(() => normalizeDevToolsEndpoint("http://example.com:9222")).toThrow("localhost");
    expect(() => normalizeDevToolsEndpoint("http://user:pass@127.0.0.1:9222")).toThrow("localhost");
    expect(() => normalizeDevToolsEndpoint("http://127.0.0.1:9222?token=x")).toThrow("localhost");
    expect(() => assertLocalDevToolsWebSocket("ws://example.com/devtools/page/1")).toThrow("localhost");
  });
});
