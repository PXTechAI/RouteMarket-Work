import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project-registry";
import { createProjectSpreadsheet } from "./spreadsheet-create";
import {
  exportProjectSpreadsheetCsv,
  inspectProjectSpreadsheet,
  readProjectSpreadsheetRange,
  writeProjectSpreadsheetRange
} from "./spreadsheet-operations";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("spreadsheet operations", () => {
  it("inspects, reads and updates a bounded range without rebuilding the package", async () => {
    const { registry, projectId, folder } = await createProject();
    await createProjectSpreadsheet(registry, {
      localProjectId: projectId,
      relativePath: "table.xlsx",
      sheetName: "Data",
      title: "Report",
      rows: [["Name", "Value"], ["Alpha", 1], ["Beta", 2]]
    });
    const beforeBytes = await readFile(join(folder, "table.xlsx"));
    const beforeZip = await JSZip.loadAsync(beforeBytes);
    const beforeStyles = await beforeZip.file("xl/styles.xml")!.async("string");

    const inspected = await inspectProjectSpreadsheet(registry, {
      localProjectId: projectId,
      relativePath: "table.xlsx",
      sheetName: "Data"
    });
    expect(inspected).toMatchObject({
      activeSheetName: "Data",
      usedRange: "A1:B5",
      rowCount: 5,
      columnCount: 2,
      truncated: false
    });

    await expect(readProjectSpreadsheetRange(registry, {
      localProjectId: projectId,
      relativePath: "table.xlsx",
      sheetName: "Data",
      range: "A3:B5"
    })).resolves.toMatchObject({
      rows: [["Name", "Value"], ["Alpha", "1"], ["Beta", "2"]]
    });

    const written = await writeProjectSpreadsheetRange(registry, {
      localProjectId: projectId,
      relativePath: "table.xlsx",
      sheetName: "Data",
      range: "B4",
      rows: [[10], [20]],
      expectedSha256: inspected.sha256
    });
    expect(written).toMatchObject({ changed: true, range: "B4:B5", previousSha256: inspected.sha256 });
    await expect(readProjectSpreadsheetRange(registry, {
      localProjectId: projectId,
      relativePath: "table.xlsx",
      range: "A3:B5"
    })).resolves.toMatchObject({
      rows: [["Name", "Value"], ["Alpha", "10"], ["Beta", "20"]]
    });

    const afterZip = await JSZip.loadAsync(await readFile(join(folder, "table.xlsx")));
    await expect(afterZip.file("xl/styles.xml")!.async("string")).resolves.toBe(beforeStyles);
    await expect(writeProjectSpreadsheetRange(registry, {
      localProjectId: projectId,
      relativePath: "table.xlsx",
      range: "A1",
      rows: [["stale"]],
      expectedSha256: inspected.sha256
    })).rejects.toMatchObject({ code: "PROJECT_FILE_CONFLICT" });
  });

  it("exports a selected range as an Excel-friendly CSV without overwriting files", async () => {
    const { registry, projectId, folder } = await createProject();
    await createProjectSpreadsheet(registry, {
      localProjectId: projectId,
      relativePath: "source.xlsx",
      sheetName: "Data",
      rows: [["Name", "Value"], ["Formula", "=1+1"], ["Quoted", "a,b"]]
    });

    const exported = await exportProjectSpreadsheetCsv(registry, {
      localProjectId: projectId,
      relativePath: "source.xlsx",
      outputPath: "export.csv",
      sheetName: "Data",
      range: "A1:B3"
    });
    expect(exported).toMatchObject({
      relativePath: "export.csv",
      mimeType: "text/csv",
      sheetName: "Data",
      range: "A1:B3",
      rowCount: 3,
      columnCount: 2
    });
    expect(await readFile(join(folder, "export.csv"), "utf8")).toBe(
      "\uFEFFName,Value\r\nFormula,'=1+1\r\nQuoted,\"a,b\"\r\n"
    );
    await expect(exportProjectSpreadsheetCsv(registry, {
      localProjectId: projectId,
      relativePath: "source.xlsx",
      outputPath: "export.csv"
    })).rejects.toMatchObject({ code: "PROJECT_FILE_EXISTS" });
  });
});

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-spreadsheet-operations-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "project");
  await mkdir(folder);
  const registry = new ProjectRegistry(join(root, "work.db"));
  cleanups.push(() => registry.close());
  const project = await registry.bindFolder(folder);
  return { registry, projectId: project.localProjectId, folder };
}
