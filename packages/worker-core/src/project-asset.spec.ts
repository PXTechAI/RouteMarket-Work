import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canPreviewProjectAsset, readProjectAsset } from "./project-asset";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("readProjectAsset", () => {
  it("returns bounded project assets as typed data URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-asset-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const projectRoot = join(root, "project");
    await mkdir(projectRoot);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(projectRoot, "preview.png"), bytes);
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(async () => registry.close());
    const project = await registry.bindFolder(projectRoot);

    await expect(readProjectAsset(registry, project.localProjectId, "preview.png")).resolves.toEqual({
      uri: `project://${project.localProjectId}/preview.png`,
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      bytesRead: 4
    });
    expect(canPreviewProjectAsset("movie.MP4")).toBe(true);
    await expect(readProjectAsset(registry, project.localProjectId, "source.ts")).rejects.toMatchObject({
      code: "ASSET_PREVIEW_UNSUPPORTED"
    });
  });
});
