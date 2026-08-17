import { createHash, randomUUID } from "node:crypto";
import { link, open, rm, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import JSZip from "jszip";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";
import { resolveNewProjectFile } from "./project-uri";

const MAX_ROWS = 2_000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 50_000;
const MAX_CELL_CHARS = 10_000;

export type SpreadsheetCellValue = string | number | boolean | null;
export type SpreadsheetCreateInput = {
  localProjectId: string;
  relativePath: string;
  sheetName?: string;
  title?: string;
  rows: SpreadsheetCellValue[][];
  freezePane?: string;
  columnWidths?: number[];
};

export type SpreadsheetCreateResult = {
  uri: string;
  relativePath: string;
  filename: string;
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  bytes: number;
  sha256: string;
  sheetName: string;
  rowCount: number;
  columnCount: number;
};

export async function createProjectSpreadsheet(
  registry: ProjectRegistry,
  input: SpreadsheetCreateInput
): Promise<SpreadsheetCreateResult> {
  const project = registry.get(input.localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  const relativePath = normalizeRelativePath(input.relativePath);
  const rows = normalizeRows(input.rows);
  const sheetName = normalizeSheetName(input.sheetName ?? "Sheet1");
  const target = await resolveNewProjectFile(project, relativePath);
  const bytes = await buildWorkbook({
    rows,
    sheetName,
    title: normalizeOptionalText(input.title, 256),
    freezePane: normalizeFreezePane(input.freezePane),
    columnWidths: normalizeColumnWidths(input.columnWidths, maximumColumns(rows))
  });
  const temporaryPath = join(dirname(target), `.routemarket-${randomUUID()}.xlsx.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new WorkerError("PROJECT_FILE_EXISTS", "The spreadsheet already exists.");
      throw error;
    });
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  const fileStat = await stat(target);
  return {
    uri: `project://${input.localProjectId}/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
    relativePath,
    filename: relativePath.split("/").at(-1)!,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: fileStat.size,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    sheetName,
    rowCount: rows.length + (input.title ? 2 : 0),
    columnCount: maximumColumns(rows)
  };
}

async function buildWorkbook(input: {
  rows: SpreadsheetCellValue[][];
  sheetName: string;
  title: string | null;
  freezePane: string | null;
  columnWidths: number[];
}): Promise<Buffer> {
  const zip = new JSZip();
  const columnCount = maximumColumns(input.rows);
  const titleOffset = input.title ? 2 : 0;
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", rootRelationshipsXml());
  zip.file("docProps/app.xml", appPropertiesXml(input.sheetName));
  zip.file("docProps/core.xml", corePropertiesXml());
  zip.file("xl/workbook.xml", workbookXml(input.sheetName));
  zip.file("xl/_rels/workbook.xml.rels", workbookRelationshipsXml());
  zip.file("xl/styles.xml", stylesXml());
  zip.file("xl/worksheets/sheet1.xml", worksheetXml({ ...input, columnCount, titleOffset }));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function worksheetXml(input: {
  rows: SpreadsheetCellValue[][];
  title: string | null;
  freezePane: string | null;
  columnWidths: number[];
  columnCount: number;
  titleOffset: number;
}) {
  const rows: string[] = [];
  if (input.title) {
    rows.push(`<row r="1" ht="28" customHeight="1"><c r="A1" t="inlineStr" s="2"><is><t>${xml(input.title)}</t></is></c></row>`);
  }
  input.rows.forEach((values, index) => {
    const rowNumber = index + 1 + input.titleOffset;
    const cells = values.map((value, column) => cellXml(value, rowNumber, column + 1, index === 0 ? 1 : 0)).join("");
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  });
  const columns = input.columnWidths.length
    ? `<cols>${input.columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const pane = input.freezePane
    ? `<sheetViews><sheetView workbookViewId="0"><pane topLeftCell="${input.freezePane}" state="frozen"${freezePaneAttributes(input.freezePane)}/><selection pane="bottomRight" activeCell="${input.freezePane}" sqref="${input.freezePane}"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const merge = input.title && input.columnCount > 1 ? `<mergeCells count="1"><mergeCell ref="A1:${columnName(input.columnCount)}1"/></mergeCells>` : "";
  const lastRow = Math.max(1, input.rows.length + input.titleOffset);
  const lastColumn = columnName(Math.max(1, input.columnCount));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/>${pane}<sheetFormatPr defaultRowHeight="18"/>${columns}<sheetData>${rows.join("")}</sheetData>${merge}</worksheet>`;
}

function cellXml(value: SpreadsheetCellValue, row: number, column: number, style: number) {
  const ref = `${columnName(column)}${row}`;
  if (value === null) return "";
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" t="b" s="${style}"><v>${value ? 1 : 0}</v></c>`;
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t${preserve}>${xml(value)}</t></is></c>`;
}

function normalizeRows(value: unknown): SpreadsheetCellValue[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) throw new WorkerError("TOOL_INPUT_INVALID", `rows must contain 1-${MAX_ROWS} rows.`);
  let cells = 0;
  return value.map((rawRow, rowIndex) => {
    if (!Array.isArray(rawRow) || rawRow.length > MAX_COLUMNS) throw new WorkerError("TOOL_INPUT_INVALID", `Row ${rowIndex + 1} exceeds ${MAX_COLUMNS} columns.`);
    cells += rawRow.length;
    if (cells > MAX_CELLS) throw new WorkerError("TOOL_INPUT_INVALID", `Spreadsheet exceeds ${MAX_CELLS} cells.`);
    return rawRow.map((cell) => {
      if (cell === null || typeof cell === "boolean") return cell;
      if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
      if (typeof cell === "string") return cell.slice(0, MAX_CELL_CHARS);
      throw new WorkerError("TOOL_INPUT_INVALID", "Spreadsheet cells must be strings, numbers, booleans, or null.");
    });
  });
}

function normalizeRelativePath(value: string) {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || extname(path).toLowerCase() !== ".xlsx") throw new WorkerError("TOOL_INPUT_INVALID", "Spreadsheet path must end with .xlsx.");
  return path;
}
function normalizeSheetName(value: string) { const result = value.trim().replace(/[\\/*?:[\]]/g, " ").slice(0, 31); return result || "Sheet1"; }
function normalizeOptionalText(value: unknown, max: number) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
function normalizeFreezePane(value: unknown) { return typeof value === "string" && /^[A-Z]{1,3}[1-9]\d{0,5}$/i.test(value.trim()) ? value.trim().toUpperCase() : null; }
function normalizeColumnWidths(value: unknown, count: number) { return Array.isArray(value) ? value.slice(0, count).map((item) => typeof item === "number" && Number.isFinite(item) ? Math.min(80, Math.max(4, item)) : 12) : Array.from({ length: count }, () => 12); }
function maximumColumns(rows: SpreadsheetCellValue[][]) { return Math.max(0, ...rows.map((row) => row.length)); }
function columnName(index: number) { let result = ""; for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result; return result; }
function freezePaneAttributes(cell: string) { const match = cell.match(/^([A-Z]+)(\d+)$/)!; const column = match[1] === "A" ? 0 : columnIndex(match[1]); const row = Number(match[2]) - 1; return `${column ? ` xSplit="${column}"` : ""}${row ? ` ySplit="${row}"` : ""}`; }
function columnIndex(value: string) { return [...value].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1; }
function xml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function contentTypesXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`; }
function rootRelationshipsXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`; }
function workbookXml(name: string) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`; }
function workbookRelationshipsXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`; }
function stylesXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FF1F2937"/><sz val="16"/><name val="Aptos Display"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4162FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF2FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFD8DEEA"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`; }
function corePropertiesXml() { const now = new Date().toISOString(); return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>RouteMarket Work</dc:creator><cp:lastModifiedBy>RouteMarket Work</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`; }
function appPropertiesXml(sheetName: string) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>RouteMarket Work</Application><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${xml(sheetName)}</vt:lpstr></vt:vector></TitlesOfParts></Properties>`; }
