import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerError } from "./errors";
import { LocalSkillInstaller } from "./local-skill-installer";
import { ProjectRegistry } from "./project-registry";

const temporaryDirectories: string[] = [];
const closeFixtures: Array<() => void> = [];

afterEach(async () => {
  for (const close of closeFixtures.splice(0)) close();
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("LocalSkillInstaller", () => {
  it("installs a bounded ZIP atomically and records a digest receipt", async () => {
    const fixture = await createFixture();
    const archivePath = await writeArchive(fixture.root, {
      "review/SKILL.md": skillMarkdown("review", "1.2.3"),
      "review/references/checklist.md": "# Checklist"
    });

    const receipt = await fixture.installer.installArchive(
      fixture.project.localProjectId,
      archivePath
    );

    expect(receipt).toMatchObject({
      skillId: "review",
      version: "1.2.3",
      source: "local_archive",
      sourceLabel: "skill.zip",
      status: "ready",
      managed: true,
      permissions: ["project.read"],
      operations: ["invoke"]
    });
    expect(receipt.packageDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await fixture.installer.list(fixture.project.localProjectId)).toEqual([
      expect.objectContaining({
        skillId: "review",
        packageDigest: receipt.packageDigest,
        currentPackageDigest: receipt.packageDigest
      })
    ]);
  }, 15_000);

  it("imports a standalone SKILL.md and a complete Skill directory", async () => {
    const fixture = await createFixture();
    const markdownPath = join(fixture.root, "SKILL.md");
    await writeFile(markdownPath, skillMarkdown("single-file", "1.0.0"));

    const markdownReceipt = await fixture.installer.installSource(
      fixture.project.localProjectId,
      markdownPath,
      "markdown"
    );
    expect(markdownReceipt).toMatchObject({
      skillId: "single-file",
      source: "local_directory",
      sourceLabel: "SKILL.md",
      status: "ready",
      managed: true
    });

    const directoryPath = join(fixture.root, "folder-skill");
    await mkdir(join(directoryPath, "references"), { recursive: true });
    await writeFile(join(directoryPath, "SKILL.md"), skillMarkdown("folder-skill", "2.1.0"));
    await writeFile(join(directoryPath, "references", "guide.md"), "# Guide");

    const directoryReceipt = await fixture.installer.installSource(
      fixture.project.localProjectId,
      directoryPath,
      "directory"
    );
    expect(directoryReceipt).toMatchObject({
      skillId: "folder-skill",
      version: "2.1.0",
      source: "local_directory",
      sourceLabel: "folder-skill",
      status: "ready",
      managed: true
    });
  }, 15_000);

  it("refuses to delete a managed Skill after local edits", async () => {
    const fixture = await createFixture();
    const archivePath = await writeArchive(fixture.root, {
      "review/SKILL.md": skillMarkdown("review", "1.0.0")
    });
    await fixture.installer.installArchive(fixture.project.localProjectId, archivePath);
    await writeFile(
      join(fixture.project.realRootPath, ".routemarket", "skills", "review", "notes.md"),
      "local edit"
    );

    expect((await fixture.installer.list(fixture.project.localProjectId))[0])
      .toMatchObject({ status: "modified" });
    await expect(
      fixture.installer.remove(fixture.project.localProjectId, "review")
    ).rejects.toMatchObject({ code: "SKILL_PACKAGE_MODIFIED" });
  }, 15_000);

  it("rejects path traversal and packages without explicit identity metadata", async () => {
    const fixture = await createFixture();
    const unsafe = await writeArchive(fixture.root, {
      "../SKILL.md": skillMarkdown("review", "1.0.0")
    }, "unsafe.zip");
    await expect(
      fixture.installer.installArchive(fixture.project.localProjectId, unsafe)
    ).rejects.toBeInstanceOf(WorkerError);

    const missingIdentity = await writeArchive(fixture.root, {
      "SKILL.md": "---\nname: Review\n---\nInstructions"
    }, "missing.zip");
    await expect(
      fixture.installer.installArchive(fixture.project.localProjectId, missingIdentity)
    ).rejects.toMatchObject({ code: "SKILL_PACKAGE_INVALID" });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-skill-install-"));
  temporaryDirectories.push(root);
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  const databasePath = join(root, "work.db");
  const registry = new ProjectRegistry(databasePath);
  const project = await registry.bindFolder(projectRoot);
  const installer = new LocalSkillInstaller(registry, databasePath);
  closeFixtures.push(() => {
    installer.close();
    registry.close();
  });
  return {
    root,
    project,
    installer
  };
}

async function writeArchive(
  root: string,
  files: Record<string, string>,
  fileName = "skill.zip"
): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const archivePath = join(root, fileName);
  await writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));
  return archivePath;
}

function skillMarkdown(id: string, version: string): string {
  return [
    "---",
    `id: ${id}`,
    `version: ${version}`,
    `name: ${id === "review" ? "Review" : id}`,
    "description: Review this project",
    "---",
    "Follow the project review checklist."
  ].join("\n");
}
