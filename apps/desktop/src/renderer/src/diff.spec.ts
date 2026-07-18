import { describe, expect, it } from "vitest";
import { createDiffPreview } from "./diff";

describe("Diff preview", () => {
  it("shows added and removed lines with their source line numbers", () => {
    const diff = createDiffPreview("one\ntwo\nthree", "one\nupdated\nthree");
    expect(diff).toEqual([
      { kind: "context", text: "one", beforeLine: 1, afterLine: 1 },
      { kind: "removed", text: "two", beforeLine: 2, afterLine: null },
      { kind: "added", text: "updated", beforeLine: null, afterLine: 2 },
      { kind: "context", text: "three", beforeLine: 3, afterLine: 3 }
    ]);
  });

  it("limits unchanged context around a large edit", () => {
    const before = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
    const after = before.replace("line 7", "changed");
    const diff = createDiffPreview(before, after);
    expect(diff.filter((line) => line.kind === "context")).toHaveLength(6);
    expect(diff.filter((line) => line.kind === "separator")).toHaveLength(2);
  });
});
