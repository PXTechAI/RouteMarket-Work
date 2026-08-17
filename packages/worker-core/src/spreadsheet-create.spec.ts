import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project-registry";
import { createProjectSpreadsheet } from "./spreadsheet-create";
import { readXlsxPreview } from "./xlsx-preview";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("native spreadsheet creation", () => {
  it("creates a previewable XLSX inside the bound project", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-spreadsheet-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, "project");
    await mkdir(folder);
    const registry = new ProjectRegistry(join(root, "work.db"));
    cleanups.push(() => registry.close());
    const project = await registry.bindFolder(folder);

    const result = await createProjectSpreadsheet(registry, {
      localProjectId: project.localProjectId,
      relativePath: "乘法口诀表.xlsx",
      sheetName: "口诀表",
      title: "九九乘法口诀表",
      freezePane: "A3",
      rows: [["乘数", "算式"], [1, "1 × 1 = 1"], [2, "1 × 2 = 2"]]
    });

    expect(result).toMatchObject({
      relativePath: "乘法口诀表.xlsx",
      filename: "乘法口诀表.xlsx",
      rowCount: 5,
      columnCount: 2,
      sheetName: "口诀表"
    });
    await expect(readXlsxPreview(join(folder, "乘法口诀表.xlsx"))).resolves.toMatchObject({
      rows: [["九九乘法口诀表", ""], ["", ""], ["乘数", "算式"], ["1", "1 × 1 = 1"], ["2", "1 × 2 = 2"]]
    });
    await expect(createProjectSpreadsheet(registry, {
      localProjectId: project.localProjectId,
      relativePath: "乘法口诀表.xlsx",
      rows: [["duplicate"]]
    })).rejects.toBeTruthy();
  });
});
