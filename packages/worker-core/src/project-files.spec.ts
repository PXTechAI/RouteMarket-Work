import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProjectFiles } from "./project-files";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()?.();
  }
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-work-files-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await mkdir(join(projectRoot, "node_modules", "ignored"), { recursive: true });
  await writeFile(join(projectRoot, "README.md"), "# Project\n", "utf8");
  await writeFile(join(projectRoot, "src", "index.ts"), "export {};\n", "utf8");
  await writeFile(join(projectRoot, "node_modules", "ignored", "index.js"), "", "utf8");

  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return { root, projectRoot, registry, project };
}

describe("project files", () => {
  it("returns a sorted tree without excluded or linked directories", async () => {
    const fixture = await createFixture();
    const outsideDirectory = join(fixture.root, "outside");
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "secret.txt"), "secret", "utf8");
    await symlink(
      outsideDirectory,
      join(fixture.projectRoot, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(
      listProjectFiles(fixture.registry, fixture.project.localProjectId)
    ).resolves.toEqual({
      entries: [
        {
          name: "src",
          relativePath: "src",
          kind: "directory",
          children: [
            {
              name: "index.ts",
              relativePath: "src/index.ts",
              kind: "file"
            }
          ]
        },
        {
          name: "README.md",
          relativePath: "README.md",
          kind: "file"
        }
      ],
      totalEntries: 3,
      truncated: false
    });
  });

  it("caps the number of entries returned", async () => {
    const fixture = await createFixture();
    const result = await listProjectFiles(
      fixture.registry,
      fixture.project.localProjectId,
      { maxEntries: 2 }
    );

    expect(result.totalEntries).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("rejects an unknown project", async () => {
    const fixture = await createFixture();
    await expect(
      listProjectFiles(fixture.registry, "project_missing")
    ).rejects.toMatchObject({
      code: "PROJECT_NOT_BOUND"
    });
  });
});
