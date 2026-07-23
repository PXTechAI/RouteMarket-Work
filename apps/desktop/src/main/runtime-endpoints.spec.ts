import { describe, expect, it } from "vitest";
import { resolveRuntimeEndpoint } from "./runtime-endpoints";

describe("runtime endpoints", () => {
  it("allows local development overrides", () => {
    expect(resolveRuntimeEndpoint({
      defaultUrl: "http://127.0.0.1:3001",
      overrideUrl: "http://localhost:4000/",
      buildEnvironment: "development",
      name: "Work API"
    })).toBe("http://localhost:4000");
  });

  it("rejects local and insecure overrides outside development", () => {
    for (const overrideUrl of [
      "http://localhost:3001",
      "http://api.example.com",
      "https://127.0.0.1"
    ]) {
      expect(() => resolveRuntimeEndpoint({
        defaultUrl: "https://console.routemarket.ai",
        overrideUrl,
        buildEnvironment: "production",
        name: "Work API"
      })).toThrow("remote HTTPS");
    }
  });

  it("accepts remote HTTPS test and production endpoints", () => {
    expect(resolveRuntimeEndpoint({
      defaultUrl: "https://console.routemarket.ai",
      overrideUrl: "https://api.example.com/",
      buildEnvironment: "test",
      name: "Work API"
    })).toBe("https://api.example.com");
  });
});
