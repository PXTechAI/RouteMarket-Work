import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("ProjectRegistry project lifecycle", () => {
  it("creates a project without a folder and can attach one later", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-project-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, "content");
    await mkdir(folder);
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(() => registry.close());

    const project = registry.create("Campaign plan");
    expect(project).toMatchObject({ displayName: "Campaign plan", hasFolder: false });
    expect(registry.get(project.localProjectId)).toBeNull();

    const linked = await registry.attachFolder(project.localProjectId, folder);
    expect(linked.hasFolder).toBe(true);
    expect(registry.get(project.localProjectId)?.realRootPath).toBe(linked.realRootPath);
  });

  it("renames a project without changing its folder binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-project-rename-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(() => registry.close());
    const project = registry.create("Old name");

    expect(registry.rename(project.localProjectId, "New name")).toMatchObject({
      localProjectId: project.localProjectId,
      displayName: "New name",
      hasFolder: false
    });
  });

  it("keeps multiple local folders and promotes the next folder when the primary one is removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-project-folders-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const firstFolder = join(root, "first");
    const secondFolder = join(root, "second");
    await mkdir(firstFolder);
    await mkdir(secondFolder);
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(() => registry.close());
    const project = registry.create("Multiple folders");

    const firstLinked = await registry.attachFolder(project.localProjectId, firstFolder);
    const secondLinked = await registry.attachFolder(project.localProjectId, secondFolder);

    expect(secondLinked.folders.map((folder) => folder.name)).toEqual(["first", "second"]);
    expect(secondLinked.folders[0]?.primary).toBe(true);

    const updated = registry.removeFolder(project.localProjectId, firstLinked.folders[0]!.folderId);
    expect(updated.folders).toHaveLength(1);
    expect(updated.folders[0]).toMatchObject({ name: "second", primary: true });
    expect(updated.realRootPath).toBe(secondLinked.folders[1]?.realRootPath);
  });

  it("deletes only the project record and leaves folder contents untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-project-delete-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, "content");
    await mkdir(folder);
    const file = join(folder, "keep.txt");
    await writeFile(file, "keep me", "utf8");
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(() => registry.close());
    const project = await registry.bindFolder(folder);

    expect(registry.delete(project.localProjectId)).toBe(true);
    expect(registry.list()).toHaveLength(0);
    await expect(access(file)).resolves.toBeUndefined();
  });

  it("reports a linked folder that was moved or deleted without losing the project binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-project-missing-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, "content");
    await mkdir(folder);
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(() => registry.close());
    const project = await registry.bindFolder(folder);

    expect(project.folderStatus).toBe("available");
    await rm(folder, { recursive: true });

    expect(registry.list()).toContainEqual(expect.objectContaining({
      localProjectId: project.localProjectId,
      hasFolder: true,
      folderStatus: "missing"
    }));
    expect(registry.get(project.localProjectId)).toBeNull();
  });
});
