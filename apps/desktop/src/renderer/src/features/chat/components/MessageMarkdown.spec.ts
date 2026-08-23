import { describe, expect, it } from "vitest";
import { normalizeMessageMarkdown, parseProjectFileUri } from "./MessageMarkdown";

describe("project file markdown", () => {
  it("repairs a wrapped project link emitted by a model", () => {
    expect(normalizeMessageMarkdown("[下载 PDF]\n(project://project_123/%E6%B5%8B%E8%AF%95.pdf)")).toBe(
      "[下载 PDF](project://project_123/%E6%B5%8B%E8%AF%95.pdf)",
    );
  });

  it("parses a safe project URI into the current-project relative path", () => {
    expect(parseProjectFileUri("project://project_123/%E6%B5%8B%E8%AF%95.pdf")).toEqual({
      projectId: "project_123",
      relativePath: "测试.pdf",
    });
  });

  it("rejects traversal and encoded path separators", () => {
    expect(parseProjectFileUri("project://project_123/../secret.txt")).toBeNull();
    expect(parseProjectFileUri("project://project_123/folder%2Fsecret.txt")).toBeNull();
  });
});
