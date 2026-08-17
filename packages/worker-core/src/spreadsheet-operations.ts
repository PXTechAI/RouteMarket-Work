import { createHash, randomUUID } from "node:crypto";
import { link, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import JSZip from "jszip";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";
import { resolveNewProjectFile, resolveProjectFile } from "./project-uri";
import type { SpreadsheetCellValue } from "./spreadsheet-create";
import { readXlsxPreview } from "./xlsx-preview";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const MAX_RANGE_ROWS = 500;
const MAX_RANGE_COLUMNS = 100;
const MAX_WRITE_CELLS = 20_000;

export type SpreadsheetInspectResult = {
  uri: string;
  relativePath: string;
  filename: string;
  mimeType: typeof XLSX_MIME;
  bytes: number;
  sha256: string;
  sheets: Array<{ id: string; name: string }>;
  activeSheetId: string;
  activeSheetName: string;
  usedRange: string;
  rowCount: number;
  columnCount: number;
  truncated: boolean;
};

export type SpreadsheetRangeResult = SpreadsheetInspectResult & {
  range: string;
  rows: string[][];
};

export type SpreadsheetWriteRangeResult = {
  uri: string;
  relativePath: string;
  filename: string;
  mimeType: typeof XLSX_MIME;
  bytes: number;
  sha256: string;
  previousSha256: string;
  changed: boolean;
  sheetName: string;
  range: string;
  rowCount: number;
  columnCount: number;
};

export type SpreadsheetExportCsvResult = {
  uri: string;
  relativePath: string;
  filename: string;
  mimeType: "text/csv";
  bytes: number;
  sha256: string;
  sheetName: string;
  range: string;
  rowCount: number;
  columnCount: number;
};

export async function inspectProjectSpreadsheet(
  registry: ProjectRegistry,
  input: { localProjectId: string; relativePath: string; sheetName?: string }
): Promise<SpreadsheetInspectResult> {
  const resolved = await resolveWorkbook(registry, input.localProjectId, input.relativePath);
  const before = await readFile(resolved.filePath);
  const initial = await readXlsxPreview(resolved.filePath);
  const selected = selectSheet(initial.sheets, input.sheetName) ?? initial.sheets[0]!;
  const workbook = selected.id === initial.activeSheetId
    ? initial
    : await readXlsxPreview(resolved.filePath, selected.id);
  const bytes = await readFile(resolved.filePath);
  if (hash(before) !== hash(bytes)) {
    throw new WorkerError("PROJECT_FILE_CONFLICT", "The workbook changed while it was being inspected. Retry the operation.");
  }
  return {
    ...resolved.metadata,
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    sheets: workbook.sheets,
    activeSheetId: workbook.activeSheetId,
    activeSheetName: selected.name,
    usedRange: usedRange(workbook.rowCount, workbook.columnCount),
    rowCount: workbook.rowCount,
    columnCount: workbook.columnCount,
    truncated: workbook.truncated
  };
}

export async function readProjectSpreadsheetRange(
  registry: ProjectRegistry,
  input: { localProjectId: string; relativePath: string; sheetName?: string; range: string }
): Promise<SpreadsheetRangeResult> {
  const inspected = await inspectProjectSpreadsheet(registry, input);
  const parsed = parseRange(input.range);
  const selected = inspected.sheets.find((sheet) => sheet.id === inspected.activeSheetId)!;
  const project = registry.get(input.localProjectId)!;
  const filePath = await resolveProjectFile(project, inspected.relativePath);
  const workbook = await readXlsxPreview(filePath, selected.id);
  if (hash(await readFile(filePath)) !== inspected.sha256) {
    throw new WorkerError("PROJECT_FILE_CONFLICT", "The workbook changed while its range was being read. Retry the operation.");
  }
  const rows = Array.from({ length: parsed.endRow - parsed.startRow + 1 }, (_, rowOffset) =>
    Array.from({ length: parsed.endColumn - parsed.startColumn + 1 }, (_, columnOffset) =>
      workbook.rows[parsed.startRow - 1 + rowOffset]?.[parsed.startColumn - 1 + columnOffset] ?? ""
    )
  );
  return { ...inspected, range: formatRange(parsed), rows };
}

export async function writeProjectSpreadsheetRange(
  registry: ProjectRegistry,
  input: {
    localProjectId: string;
    relativePath: string;
    sheetName?: string;
    range: string;
    rows: SpreadsheetCellValue[][];
    expectedSha256: string;
  }
): Promise<SpreadsheetWriteRangeResult> {
  const resolved = await resolveWorkbook(registry, input.localProjectId, input.relativePath);
  const currentBytes = await readFile(resolved.filePath);
  const previousSha256 = hash(currentBytes);
  if (previousSha256 !== input.expectedSha256) {
    throw new WorkerError("PROJECT_FILE_CONFLICT", "The workbook changed on disk. Inspect it again before saving edits.");
  }
  const rows = normalizeWriteRows(input.rows);
  const range = rangeForRows(parseRange(input.range, true), rows);
  const preview = await readXlsxPreview(resolved.filePath);
  const selected = selectSheet(preview.sheets, input.sheetName) ?? preview.sheets[0]!;
  const zip = await JSZip.loadAsync(currentBytes, { checkCRC32: true, createFolders: false });
  const worksheetPartPath = await worksheetPath(zip, selected.id);
  const worksheet = zip.file(worksheetPartPath);
  if (!worksheet) throw new WorkerError("XLSX_PREVIEW_INVALID", "The selected worksheet part is missing.");
  const originalXml = await worksheet.async("string");
  const updatedXml = updateWorksheet(originalXml, range, rows);
  if (updatedXml === originalXml) {
    return {
      ...resolved.metadata,
      bytes: currentBytes.byteLength,
      sha256: previousSha256,
      previousSha256,
      changed: false,
      sheetName: selected.name,
      range: formatRange(range),
      rowCount: rows.length,
      columnCount: maximumColumns(rows)
    };
  }
  zip.file(worksheetPartPath, updatedXml);
  const updatedBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await atomicReplace(resolved.filePath, updatedBytes, previousSha256);
  return {
    ...resolved.metadata,
    bytes: updatedBytes.byteLength,
    sha256: hash(updatedBytes),
    previousSha256,
    changed: true,
    sheetName: selected.name,
    range: formatRange(range),
    rowCount: rows.length,
    columnCount: maximumColumns(rows)
  };
}

export async function exportProjectSpreadsheetCsv(
  registry: ProjectRegistry,
  input: {
    localProjectId: string;
    relativePath: string;
    outputPath: string;
    sheetName?: string;
    range?: string;
  }
): Promise<SpreadsheetExportCsvResult> {
  const inspected = await inspectProjectSpreadsheet(registry, input);
  const requestedRange = input.range ?? inspected.usedRange;
  const result = await readProjectSpreadsheetRange(registry, { ...input, range: requestedRange });
  const outputPath = normalizeCsvPath(input.outputPath);
  const project = registry.get(input.localProjectId)!;
  const target = await resolveNewProjectFile(project, outputPath);
  const csv = `\uFEFF${result.rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const bytes = Buffer.from(csv, "utf8");
  await atomicCreate(target, bytes, "The CSV file already exists.");
  return {
    uri: projectUri(input.localProjectId, outputPath),
    relativePath: outputPath,
    filename: outputPath.split("/").at(-1)!,
    mimeType: "text/csv",
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    sheetName: result.activeSheetName,
    range: result.range,
    rowCount: result.rows.length,
    columnCount: maximumColumns(result.rows)
  };
}

type ParsedRange = { startRow: number; startColumn: number; endRow: number; endColumn: number };

function parseRange(value: string, allowSingleCell = false): ParsedRange {
  const normalized = value.trim().replaceAll("$", "").toUpperCase();
  const match = normalized.match(/^([A-Z]{1,3})([1-9]\d{0,5})(?::([A-Z]{1,3})([1-9]\d{0,5}))?$/);
  if (!match) throw new WorkerError("TOOL_INPUT_INVALID", "range must use A1 notation, for example A1:C10.");
  const startColumn = columnIndex(match[1]!);
  const startRow = Number(match[2]);
  const endColumn = match[3] ? columnIndex(match[3]) : startColumn;
  const endRow = match[4] ? Number(match[4]) : startRow;
  if (!allowSingleCell && !match[3]) throw new WorkerError("TOOL_INPUT_INVALID", "range must include both corners, for example A1:C10.");
  if (endColumn < startColumn || endRow < startRow) throw new WorkerError("TOOL_INPUT_INVALID", "range end must not precede its start.");
  if (endRow - startRow + 1 > MAX_RANGE_ROWS || endColumn - startColumn + 1 > MAX_RANGE_COLUMNS) {
    throw new WorkerError("TOOL_INPUT_INVALID", `range exceeds ${MAX_RANGE_ROWS} rows or ${MAX_RANGE_COLUMNS} columns.`);
  }
  if (!allowSingleCell && (endRow > MAX_RANGE_ROWS || endColumn > MAX_RANGE_COLUMNS)) {
    throw new WorkerError("TOOL_INPUT_INVALID", `read range must stay within row ${MAX_RANGE_ROWS} and column ${columnName(MAX_RANGE_COLUMNS)}.`);
  }
  return { startRow, startColumn, endRow, endColumn };
}

function rangeForRows(range: ParsedRange, rows: SpreadsheetCellValue[][]): ParsedRange {
  const columns = maximumColumns(rows);
  const inferred = range.startRow === range.endRow && range.startColumn === range.endColumn;
  const result = inferred
    ? { ...range, endRow: range.startRow + rows.length - 1, endColumn: range.startColumn + columns - 1 }
    : range;
  if (result.endRow - result.startRow + 1 !== rows.length || result.endColumn - result.startColumn + 1 !== columns) {
    throw new WorkerError("TOOL_INPUT_INVALID", "rows dimensions must match the requested write range.");
  }
  if (rows.length * columns > MAX_WRITE_CELLS) throw new WorkerError("TOOL_INPUT_INVALID", `write_range exceeds ${MAX_WRITE_CELLS} cells.`);
  return result;
}

function normalizeWriteRows(value: unknown): SpreadsheetCellValue[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RANGE_ROWS) {
    throw new WorkerError("TOOL_INPUT_INVALID", `rows must contain 1-${MAX_RANGE_ROWS} rows.`);
  }
  return value.map((rawRow) => {
    if (!Array.isArray(rawRow) || rawRow.length === 0 || rawRow.length > MAX_RANGE_COLUMNS) {
      throw new WorkerError("TOOL_INPUT_INVALID", `Each row must contain 1-${MAX_RANGE_COLUMNS} cells.`);
    }
    return rawRow.map((cell) => {
      if (cell === null || typeof cell === "boolean") return cell;
      if (typeof cell === "number" && Number.isFinite(cell)) return cell;
      if (typeof cell === "string" && cell.length <= 10_000 && !cell.includes("\0")) return cell;
      throw new WorkerError("TOOL_INPUT_INVALID", "Spreadsheet cells must be strings, finite numbers, booleans, or null.");
    });
  });
}

function updateWorksheet(xml: string, range: ParsedRange, values: SpreadsheetCellValue[][]): string {
  const sheetDataMatch = xml.match(/<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/i);
  if (!sheetDataMatch || sheetDataMatch.index === undefined) throw new WorkerError("XLSX_PREVIEW_INVALID", "Worksheet contains no sheetData element.");
  const rowMap = new Map<number, { attributes: string; cells: Map<number, string> }>();
  for (const match of sheetDataMatch[1]!.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    const rowNumber = Number(attribute(match[1] ?? "", "r"));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    const cells = new Map<number, string>();
    for (const cell of (match[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi)) {
      const reference = attribute(cell[1] ?? "", "r");
      if (reference) cells.set(columnIndex(reference.replace(/\d+$/, "")), cell[0]);
    }
    rowMap.set(rowNumber, { attributes: match[1] ?? ` r="${rowNumber}"`, cells });
  }
  values.forEach((row, rowOffset) => {
    const rowNumber = range.startRow + rowOffset;
    const entry = rowMap.get(rowNumber) ?? { attributes: ` r="${rowNumber}"`, cells: new Map<number, string>() };
    row.forEach((value, columnOffset) => {
      const column = range.startColumn + columnOffset;
      const previous = entry.cells.get(column);
      if (value === null) entry.cells.delete(column);
      else entry.cells.set(column, writeCellXml(value, `${columnName(column)}${rowNumber}`, previous));
    });
    rowMap.set(rowNumber, entry);
  });
  const rows = [...rowMap.entries()]
    .filter(([, row]) => row.cells.size > 0)
    .sort(([left], [right]) => left - right)
    .map(([rowNumber, row]) => {
      const attributes = replaceAttribute(row.attributes, "r", String(rowNumber));
      const cells = [...row.cells.entries()].sort(([left], [right]) => left - right).map(([, cell]) => cell).join("");
      return `<row${attributes}>${cells}</row>`;
    })
    .join("");
  const replaced = xml.replace(sheetDataMatch[0], sheetDataMatch[0].replace(sheetDataMatch[1]!, rows));
  const bounds = worksheetBounds(rowMap);
  const dimension = bounds ? `A1:${columnName(bounds.column)}${bounds.row}` : "A1";
  return /<(?:\w+:)?dimension\b[^>]*\/>/i.test(replaced)
    ? replaced.replace(/<(?:\w+:)?dimension\b[^>]*\/>/i, `<dimension ref="${dimension}"/>`)
    : replaced;
}

function writeCellXml(value: Exclude<SpreadsheetCellValue, null>, reference: string, previous?: string): string {
  const style = previous ? attribute(previous.match(/^<(?:\w+:)?c\b([^>]*)/i)?.[1] ?? "", "s") : null;
  const styleAttribute = style ? ` s="${xml(style)}"` : "";
  if (typeof value === "number") return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"${styleAttribute}><v>${value ? 1 : 0}</v></c>`;
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t${preserve}>${xml(value)}</t></is></c>`;
}

async function worksheetPath(zip: JSZip, sheetId: string): Promise<string> {
  const workbook = await requiredXml(zip, "xl/workbook.xml");
  const relationships = await requiredXml(zip, "xl/_rels/workbook.xml.rels");
  const sheetTag = [...workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?\s*>/gi)]
    .find((match) => attribute(match[1] ?? "", "r:id") === sheetId);
  const relationId = sheetTag ? attribute(sheetTag[1] ?? "", "r:id") : null;
  const relationship = [...relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi)]
    .find((match) => attribute(match[1] ?? "", "Id") === relationId);
  const target = relationship ? attribute(relationship[1] ?? "", "Target") : null;
  if (!target || target.includes("\\") || target.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    throw new WorkerError("XLSX_PREVIEW_UNSAFE", "Workbook contains an unsafe worksheet target.");
  }
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

async function resolveWorkbook(registry: ProjectRegistry, localProjectId: string, rawPath: string) {
  const project = registry.get(localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  const relativePath = normalizeXlsxPath(rawPath);
  const filePath = await resolveProjectFile(project, relativePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new WorkerError("PROJECT_FILE_NOT_FOUND", "Requested workbook is not a file.");
  return {
    filePath,
    metadata: {
      uri: projectUri(localProjectId, relativePath),
      relativePath,
      filename: relativePath.split("/").at(-1)!,
      mimeType: XLSX_MIME
    }
  };
}

async function atomicReplace(target: string, bytes: Buffer, expectedSha256: string): Promise<void> {
  const temporary = join(dirname(target), `.routemarket-${randomUUID()}.xlsx.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (hash(await readFile(target)) !== expectedSha256) {
      throw new WorkerError("PROJECT_FILE_CONFLICT", "The workbook changed on disk while saving. Reload it before retrying.");
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function atomicCreate(target: string, bytes: Buffer, existsMessage: string): Promise<void> {
  const temporary = join(dirname(target), `.routemarket-${randomUUID()}.csv.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new WorkerError("PROJECT_FILE_EXISTS", existsMessage);
      throw error;
    });
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function selectSheet(sheets: Array<{ id: string; name: string }>, name?: string) {
  if (!name) return undefined;
  const selected = sheets.find((sheet) => sheet.name === name);
  if (!selected) throw new WorkerError("XLSX_SHEET_NOT_FOUND", `Worksheet not found: ${name}`);
  return selected;
}
function normalizeXlsxPath(value: string) { const path = value.trim().replaceAll("\\", "/"); if (!path || extname(path).toLowerCase() !== ".xlsx") throw new WorkerError("TOOL_INPUT_INVALID", "Spreadsheet path must end with .xlsx."); return path; }
function normalizeCsvPath(value: string) { const path = value.trim().replaceAll("\\", "/"); if (!path || extname(path).toLowerCase() !== ".csv") throw new WorkerError("TOOL_INPUT_INVALID", "output_path must end with .csv."); return path; }
function maximumColumns(rows: Array<Array<unknown>>) { return Math.max(0, ...rows.map((row) => row.length)); }
function usedRange(rows: number, columns: number) { return rows && columns ? `A1:${columnName(columns)}${rows}` : "A1"; }
function formatRange(range: ParsedRange) { return `${columnName(range.startColumn)}${range.startRow}:${columnName(range.endColumn)}${range.endRow}`; }
function columnName(index: number) { let result = ""; for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result; return result; }
function columnIndex(value: string) { return [...value.toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0); }
function hash(bytes: Buffer) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function projectUri(projectId: string, path: string) { return `project://${projectId}/${path.split("/").map(encodeURIComponent).join("/")}`; }
function xml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function attribute(attributes: string, name: string): string | null { const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return attributes.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] ?? null; }
function replaceAttribute(attributes: string, name: string, value: string) { const expression = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[\\s\\S]*?\\2`, "i"); return expression.test(attributes) ? attributes.replace(expression, `$1"${value}"`) : `${attributes} ${name}="${value}"`; }
function worksheetBounds(rows: Map<number, { cells: Map<number, string> }>) { let row = 0; let column = 0; for (const [rowNumber, value] of rows) { if (!value.cells.size) continue; row = Math.max(row, rowNumber); column = Math.max(column, ...value.cells.keys()); } return row && column ? { row, column } : null; }
function csvCell(value: string) { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; }
async function requiredXml(zip: JSZip, path: string) { const entry = zip.file(path); if (!entry) throw new WorkerError("XLSX_PREVIEW_INVALID", `Workbook package is missing ${path}.`); return entry.async("string"); }
