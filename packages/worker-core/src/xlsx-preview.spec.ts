import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseWorksheet, readXlsxPreview } from "./xlsx-preview";

describe("XLSX preview", () => {
  it("renders cached formulas as formula text without evaluating them", () => {
    expect(parseWorksheet(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c>' +
      '<c r="B1"><f>1+1</f><v>2</v></c><c r="C1" t="b"><v>1</v></c></row></sheetData></worksheet>',
      []
    )).toEqual({
      rows: [["Name", "=1+1", "TRUE"]],
      columnCount: 3,
      truncated: false
    });
  });

  it("reads shared strings and switches between bounded worksheets", async () => {
    const directory = await createTestDirectory();
    const workbookPath = join(directory, "sample.xlsx");
    await writeFile(workbookPath, await createWorkbook());

    await expect(readXlsxPreview(workbookPath)).resolves.toMatchObject({
      sheets: [{ id: "rId1", name: "Summary" }, { id: "rId2", name: "Data & Notes" }],
      activeSheetId: "rId1",
      rows: [["City", "Value"], ["Shanghai", "12"]]
    });
    await expect(readXlsxPreview(workbookPath, "rId2")).resolves.toMatchObject({
      activeSheetId: "rId2",
      rows: [["=SUM(A2:A3)"], ["5"]]
    });
    await expect(readXlsxPreview(workbookPath, "missing")).rejects.toMatchObject({
      code: "XLSX_SHEET_NOT_FOUND"
    });
  });

  it("rejects external worksheet relationships", async () => {
    const directory = await createTestDirectory();
    const workbookPath = join(directory, "external.xlsx");
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="Remote" r:id="rId1"/></sheets></workbook>');
    zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://example.com/sheet.xml" TargetMode="External"/></Relationships>');
    await writeFile(workbookPath, await zip.generateAsync({ type: "nodebuffer" }));
    await expect(readXlsxPreview(workbookPath)).rejects.toMatchObject({ code: "XLSX_PREVIEW_UNSAFE" });
  });

  it("accepts absolute package-part worksheet targets emitted by openpyxl", async () => {
    const directory = await createTestDirectory();
    const workbookPath = join(directory, "absolute-part.xlsx");
    await writeFile(workbookPath, await createWorkbook("/xl/worksheets/sheet1.xml"));

    await expect(readXlsxPreview(workbookPath)).resolves.toMatchObject({
      activeSheetId: "rId1",
      rows: [["City", "Value"], ["Shanghai", "12"]]
    });
  });
});

async function createTestDirectory(): Promise<string> {
  const root = join(process.cwd(), "node_modules", ".cache", "routemarket-tests", "xlsx-preview");
  await mkdir(root, { recursive: true });
  return root;
}

async function createWorkbook(firstSheetTarget = "worksheets/sheet1.xml"): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", [
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
    '<sheet name="Summary" sheetId="1" r:id="rId1"/>',
    '<sheet name="Data &amp; Notes" sheetId="2" r:id="rId2"/>',
    "</sheets></workbook>"
  ].join(""));
  zip.file("xl/_rels/workbook.xml.rels", [
    "<Relationships>",
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${firstSheetTarget}"/>`,
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>',
    "</Relationships>"
  ].join(""));
  zip.file("xl/sharedStrings.xml", [
    "<sst>",
    "<si><t>City</t></si><si><t>Value</t></si><si><t>Shanghai</t></si>",
    "</sst>"
  ].join(""));
  zip.file("xl/worksheets/sheet1.xml", [
    "<worksheet><sheetData>",
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row>',
    "</sheetData></worksheet>"
  ].join(""));
  zip.file("xl/worksheets/sheet2.xml", [
    "<worksheet><sheetData>",
    '<row r="1"><c r="A1"><f>SUM(A2:A3)</f><v>10</v></c></row>',
    '<row r="2"><c r="A2"><v>5</v></c></row>',
    "</sheetData></worksheet>"
  ].join(""));
  return zip.generateAsync({ type: "nodebuffer" });
}
