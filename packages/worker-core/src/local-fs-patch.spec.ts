import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { applyLocalProjectPatch } from "./local-fs-patch";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture(text = "alpha\nbeta\nalpha\n") {
  const root = await mkdtemp(join(tmpdir(), "routemarket-patch-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "file.txt"), text, "utf8");
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return {
    registry,
    project,
    filePath: join(projectRoot, "file.txt"),
    sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    text
  };
}

describe("local file Patch", () => {
  it("applies contextual operations and writes through optimistic locking", async () => {
    const value = await fixture();
    const result = await applyLocalProjectPatch(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "file.txt",
      originalText: value.text,
      expectedSha256: value.sha256,
      operations: [{ oldText: "alpha\nbeta", newText: "first\nsecond" }]
    });
    expect(result.replacementsApplied).toBe(1);
    await expect(readFile(value.filePath, "utf8")).resolves.toBe("first\nsecond\nalpha\n");
  });

  it("rejects ambiguous or missing context without touching the file", async () => {
    const value = await fixture();
    await expect(applyLocalProjectPatch(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "file.txt",
      originalText: value.text,
      expectedSha256: value.sha256,
      operations: [{ oldText: "alpha", newText: "changed" }]
    })).rejects.toMatchObject({ code: "PATCH_CONTEXT_AMBIGUOUS" });
    await expect(readFile(value.filePath, "utf8")).resolves.toBe(value.text);
  });
});
