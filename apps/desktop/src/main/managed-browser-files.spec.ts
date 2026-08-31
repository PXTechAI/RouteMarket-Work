import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allocateDownloadPath,
  prepareProjectDownloadDirectory,
  resolveProjectUploadFiles,
  sanitizeDownloadFileName,
} from "./managed-browser-files";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("managed Browser project files", () => {
  it("creates a project download directory and avoids overwriting existing files", async () => {
    const root = await fixture();
    const directory = await prepareProjectDownloadDirectory(root);
    await writeFile(join(directory, "report.pdf"), "existing");

    expect(allocateDownloadPath(directory, "report.pdf")).toMatchObject({
      fileName: "report (2).pdf",
      absolutePath: join(directory, "report (2).pdf"),
    });
  });

  it("reserves names for simultaneous downloads before either file exists", async () => {
    const root = await fixture();
    const directory = await prepareProjectDownloadDirectory(root);

    expect(allocateDownloadPath(directory, "report.pdf", new Set(["REPORT.pdf"]))).toMatchObject({
      fileName: "report (2).pdf",
      absolutePath: join(directory, "report (2).pdf"),
    });
  });

  it("sanitizes unsafe and Windows-reserved download names", () => {
    expect(sanitizeDownloadFileName("../bad:name?.txt")).toBe("bad_name_.txt");
    expect(sanitizeDownloadFileName("CON.txt")).toMatch(/^download-\d+$/);
  });

  it("resolves only existing project files for upload", async () => {
    const root = await fixture();
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "photo.png"), "image");
    const photoPath = await realpath(join(root, "assets", "photo.png"));

    await expect(resolveProjectUploadFiles(root, ["assets/photo.png"])).resolves.toEqual({
      absolutePaths: [photoPath],
      relativePaths: ["assets/photo.png"],
    });
    await expect(resolveProjectUploadFiles(root, ["../outside.txt"])).rejects.toThrow("project-relative");
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "routemarket-browser-files-"));
  fixtures.push(root);
  return root;
}
