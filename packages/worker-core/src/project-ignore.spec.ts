import { describe, expect, it } from "vitest";
import { createProjectIgnoreMatcher } from "./project-ignore";

describe("createProjectIgnoreMatcher", () => {
  it("supports rooted, directory, globstar and basename patterns", () => {
    const ignored = createProjectIgnoreMatcher([
      "generated/**",
      "/private/",
      "*.secret",
      "docs/draft?.md"
    ]);
    expect(ignored("generated")).toBe(true);
    expect(ignored("generated/nested/file.ts")).toBe(true);
    expect(ignored("private/token.txt")).toBe(true);
    expect(ignored("nested/private/token.txt")).toBe(false);
    expect(ignored("src/key.secret")).toBe(true);
    expect(ignored("docs/draft1.md")).toBe(true);
    expect(ignored("docs/draft10.md")).toBe(false);
    expect(ignored("src/index.ts")).toBe(false);
  });
});
