import { describe, expect, it } from "vitest";
import { resolveBuildEnvironment } from "./build-environment";

describe("resolveBuildEnvironment", () => {
  it("marks the daily development build", () => {
    expect(resolveBuildEnvironment("development", true)).toEqual({
      label: "开发版",
      kind: "development"
    });
  });

  it("marks a packaged build connected to local services", () => {
    expect(resolveBuildEnvironment("desktop-local", false)).toEqual({
      label: "本地测试包",
      kind: "local-package"
    });
  });

  it("does not add a badge to production releases", () => {
    expect(resolveBuildEnvironment("production", false)).toBeNull();
  });
});
