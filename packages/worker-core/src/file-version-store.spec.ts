import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileVersionStore } from "./file-version-store";

describe("FileVersionStore", () => {
  let directory: string;
  let store: FileVersionStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "routemarket-version-"));
    store = new FileVersionStore(join(directory, "work.db"));
  });

  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("records and reads scoped file versions", () => {
    const baseline = store.record({
      localProjectId: "project_test",
      relativePath: "README.md",
      sha256: `sha256:${"a".repeat(64)}`,
      text: "before",
      source: "baseline"
    });
    store.record({
      localProjectId: "project_test",
      relativePath: "README.md",
      sha256: `sha256:${"b".repeat(64)}`,
      text: "after",
      source: "saved"
    });
    expect(store.list("project_test", "README.md").map((item) => item.source)).toEqual(["saved", "baseline"]);
    expect(store.get("project_test", "README.md", baseline.versionId).text).toBe("before");
    expect(() => store.get("project_other", "README.md", baseline.versionId)).toThrow("not found");
  });

  it("deduplicates adjacent snapshots with identical content", () => {
    const input = {
      localProjectId: "project_test",
      relativePath: "src/app.ts",
      sha256: `sha256:${"c".repeat(64)}`,
      text: "same",
      source: "saved" as const
    };
    expect(store.record(input).versionId).toBe(store.record(input).versionId);
    expect(store.list(input.localProjectId, input.relativePath)).toHaveLength(1);
  });
});
