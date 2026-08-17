import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canPreviewProjectArtifact,
  parseDelimitedText,
  previewProjectArtifact
} from "./artifact-preview";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("artifact preview", () => {
  it("parses quoted CSV without evaluating cell content", () => {
    expect(parseDelimitedText('\ufeffname,notes,formula\r\nAlice,"hello, world",=1+1\r\nBob,"two\nlines",42', ","))
      .toEqual({
        rows: [
          ["name", "notes", "formula"],
          ["Alice", "hello, world", "=1+1"],
          ["Bob", "two\nlines", "42"]
        ],
        columnCount: 3,
        truncated: false
      });
  });

  it("routes CSV to the bounded table provider and legacy XLS to the planned plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-artifact-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const projectRoot = join(root, "project");
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, "data.csv"), "city,value\nShanghai,12\n", "utf8");
    await writeFile(join(projectRoot, "report.pdf"), "%PDF-1.7\n", "utf8");
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(async () => registry.close());
    const project = await registry.bindFolder(projectRoot);

    await expect(previewProjectArtifact(registry, project.localProjectId, "data.csv"))
      .resolves.toMatchObject({
        kind: "table",
        providerId: "core.delimited-table",
        rows: [["city", "value"], ["Shanghai", "12"]],
        truncated: false
      });
    await expect(previewProjectArtifact(registry, project.localProjectId, "data.xls"))
      .resolves.toMatchObject({
        kind: "unavailable",
        providerId: "ai.routemarket.spreadsheet",
        viewerId: "spreadsheet.viewer"
      });
    await expect(previewProjectArtifact(
      registry,
      project.localProjectId,
      "report.pdf",
      undefined,
      2,
      async () => ({
        dataUrl: "data:image/png;base64,cG5n",
        bytesRead: 128,
        pageCount: 3,
        pageNumber: 2,
        width: 800,
        height: 1_100
      })
    )).resolves.toMatchObject({
      kind: "pdf",
      providerId: "ai.routemarket.pdf",
      viewerId: "pdf.viewer",
      pageNumber: 2,
      isolated: true
    });
    expect(canPreviewProjectArtifact("table.TSV")).toBe(true);
    expect(canPreviewProjectArtifact("notes.txt")).toBe(false);
  });
});
