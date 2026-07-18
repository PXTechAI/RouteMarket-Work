import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalProjectFile } from "./local-fs-create";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-create-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return { root, projectRoot, registry, project };
}

describe("local file creation", () => {
  it("creates a new file without exposing an absolute path", async () => {
    const value = await fixture();
    const result = await createLocalProjectFile(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "src/new.ts",
      text: "export const created = true;\n"
    });
    expect(result).toMatchObject({ created: true, bytesRead: 29 });
    expect(result.uri).toBe(`project://${value.project.localProjectId}/src/new.ts`);
    await expect(readFile(join(value.projectRoot, "src", "new.ts"), "utf8"))
      .resolves.toBe("export const created = true;\n");
  });

  it("never overwrites an existing file", async () => {
    const value = await fixture();
    await writeFile(join(value.projectRoot, "src", "existing.ts"), "original", "utf8");
    await expect(createLocalProjectFile(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "src/existing.ts",
      text: "replacement"
    })).rejects.toMatchObject({ code: "PROJECT_FILE_EXISTS" });
    await expect(readFile(join(value.projectRoot, "src", "existing.ts"), "utf8"))
      .resolves.toBe("original");
  });

  it("rejects a linked parent that escapes the project", async () => {
    const value = await fixture();
    const outside = join(value.root, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      join(value.projectRoot, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(createLocalProjectFile(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "linked-outside/secret.txt",
      text: "secret"
    })).rejects.toMatchObject({ code: "PROJECT_PATH_ESCAPE" });
  });
});
