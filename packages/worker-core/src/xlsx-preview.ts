import { readFile, stat } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";
import { WorkerError } from "./errors";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;
const MAX_CELL_CHARACTERS = 10_000;

export type XlsxSheet = { id: string; name: string };

export type XlsxPreview = {
  sheets: XlsxSheet[];
  activeSheetId: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  truncated: boolean;
};

export async function readXlsxPreview(
  filePath: string,
  selectedSheetId?: string
): Promise<XlsxPreview> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new WorkerError("PROJECT_FILE_NOT_FOUND", "Requested workbook is not a file.");
  if (fileStat.size > MAX_ARCHIVE_BYTES) {
    throw new WorkerError("XLSX_PREVIEW_TOO_LARGE", "Workbook exceeds the 20 MiB preview limit.");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readFile(filePath), { checkCRC32: true, createFolders: false });
  } catch {
    throw new WorkerError("XLSX_PREVIEW_INVALID", "Workbook is not a valid XLSX package.");
  }
  assertBoundedArchive(zip);
  const workbookXml = await readXml(zip, "xl/workbook.xml", true);
  const relationshipsXml = await readXml(zip, "xl/_rels/workbook.xml.rels", true);
  const relationships = parseWorkbookRelationships(relationshipsXml);
  const sheets = parseWorkbookSheets(workbookXml, relationships);
  if (sheets.length === 0) throw new WorkerError("XLSX_PREVIEW_INVALID", "Workbook contains no readable worksheets.");
  const active = selectedSheetId
    ? sheets.find((sheet) => sheet.id === selectedSheetId)
    : sheets[0];
  if (!active) throw new WorkerError("XLSX_SHEET_NOT_FOUND", "The selected worksheet no longer exists.");
  const sharedStringsXml = await readXml(zip, "xl/sharedStrings.xml", false);
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const worksheetXml = await readXml(zip, active.path, true);
  const parsed = parseWorksheet(worksheetXml, sharedStrings);
  return {
    sheets: sheets.map(({ id, name }) => ({ id, name })),
    activeSheetId: active.id,
    rows: parsed.rows,
    rowCount: parsed.rows.length,
    columnCount: parsed.columnCount,
    truncated: parsed.truncated
  };
}

function assertBoundedArchive(zip: JSZip): void {
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new WorkerError("XLSX_PREVIEW_TOO_LARGE", "Workbook contains too many package entries.");
  }
  let total = 0;
  for (const entry of entries) {
    const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (originalName.includes("\\") || originalName.startsWith("/") || originalName.split("/").includes("..")) {
      throw new WorkerError("XLSX_PREVIEW_UNSAFE", "Workbook contains an unsafe package path.");
    }
    const size = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!entry.dir && typeof size !== "number") {
      throw new WorkerError("XLSX_PREVIEW_INVALID", "Workbook package has an entry with an unknown expanded size.");
    }
    if (typeof size === "number") total += size;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new WorkerError("XLSX_PREVIEW_TOO_LARGE", "Workbook expands beyond the 64 MiB preview limit.");
    }
  }
}

async function readXml(zip: JSZip, path: string, required: boolean): Promise<string> {
  const entry = zip.file(path);
  if (!entry) {
    if (required) throw new WorkerError("XLSX_PREVIEW_INVALID", `Workbook package is missing ${path}.`);
    return "";
  }
  const declaredSize = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declaredSize === "number" && declaredSize > MAX_XML_BYTES) {
    throw new WorkerError("XLSX_PREVIEW_TOO_LARGE", `Workbook XML part ${path} exceeds the preview limit.`);
  }
  const xml = await entry.async("string");
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) {
    throw new WorkerError("XLSX_PREVIEW_TOO_LARGE", `Workbook XML part ${path} exceeds the preview limit.`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new WorkerError("XLSX_PREVIEW_UNSAFE", "Workbook XML contains a prohibited document type or entity.");
  }
  return xml;
}

function parseWorkbookRelationships(xml: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const attributes of matchStartTags(xml, "Relationship")) {
    const id = attribute(attributes, "Id");
    const type = attribute(attributes, "Type");
    const target = attribute(attributes, "Target");
    const targetMode = attribute(attributes, "TargetMode");
    if (targetMode?.toLocaleLowerCase() === "external") {
      throw new WorkerError("XLSX_PREVIEW_UNSAFE", "Workbook contains an external relationship.");
    }
    if (!id || !target || !type?.endsWith("/worksheet")) continue;
    const path = normalizeWorkbookTarget(target);
    result.set(id, path);
  }
  return result;
}

function parseWorkbookSheets(
  xml: string,
  relationships: Map<string, string>
): Array<XlsxSheet & { path: string }> {
  const sheets: Array<XlsxSheet & { path: string }> = [];
  for (const attributes of matchStartTags(xml, "sheet")) {
    const id = attribute(attributes, "r:id");
    const name = attribute(attributes, "name");
    const path = id ? relationships.get(id) : undefined;
    if (id && name && path) sheets.push({ id, name: decodeXml(name), path });
  }
  return sheets;
}

function parseSharedStrings(xml: string): string[] {
  return matchElements(xml, "si").map((item) =>
    matchElements(item, "t")
      .map((text) => decodeXml(stripTags(text)))
      .join("")
      .slice(0, MAX_CELL_CHARACTERS)
  );
}

export function parseWorksheet(
  xml: string,
  sharedStrings: string[]
): { rows: string[][]; columnCount: number; truncated: boolean } {
  const rows: string[][] = [];
  let maximumColumn = -1;
  let truncated = false;
  for (const cellMatch of xml.matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi)) {
    const reference = attribute(cellMatch[1] ?? "", "r");
    const column = reference ? columnIndex(reference) : maximumColumn + 1;
    const rowNumber = reference ? Number(reference.match(/\d+$/)?.[0]) : rows.length + 1;
    if (!Number.isInteger(column) || column < 0 || !Number.isInteger(rowNumber) || rowNumber < 1) continue;
    if (rowNumber > MAX_ROWS || column >= MAX_COLUMNS) {
      truncated = true;
      continue;
    }
    const body = cellMatch[2] ?? "";
    const type = attribute(cellMatch[1] ?? "", "t") ?? "n";
    const formula = firstElement(body, "f");
    const rawValue = firstElement(body, "v");
    const inlineValue = matchElements(body, "t").map((item) => decodeXml(stripTags(item))).join("");
    const value = formula !== null
      ? `=${decodeXml(stripTags(formula))}`
      : cellValue(type, rawValue, inlineValue, sharedStrings);
    const row = rows[rowNumber - 1] ?? [];
    while (rows.length < rowNumber) rows.push([]);
    if (value.length > MAX_CELL_CHARACTERS) truncated = true;
    row[column] = value.slice(0, MAX_CELL_CHARACTERS);
    rows[rowNumber - 1] = row;
    maximumColumn = Math.max(maximumColumn, column);
  }
  const columnCount = maximumColumn + 1;
  for (const row of rows) {
    while (row.length < columnCount) row.push("");
  }
  return { rows, columnCount, truncated };
}

function cellValue(type: string, raw: string | null, inline: string, sharedStrings: string[]): string {
  if (type === "inlineStr") return inline;
  const value = raw === null ? "" : decodeXml(stripTags(raw));
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value;
}

function normalizeWorkbookTarget(target: string): string {
  const decoded = decodeXml(target);
  if (decoded.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    throw new WorkerError("XLSX_PREVIEW_UNSAFE", "Workbook contains an unsafe worksheet target.");
  }
  // OPC relationships may use an absolute package-part name such as
  // `/xl/worksheets/sheet1.xml` (the form emitted by openpyxl). It is still
  // internal to the ZIP package; resolve it from the package root instead of
  // treating the leading slash as an external filesystem path.
  const normalized = posix.normalize(decoded.startsWith("/")
    ? decoded.slice(1)
    : posix.join("xl", decoded));
  if (!normalized.startsWith("xl/") || normalized.includes("../")) {
    throw new WorkerError("XLSX_PREVIEW_UNSAFE", "Workbook worksheet target escapes the package root.");
  }
  return normalized;
}

function matchStartTags(xml: string, localName: string): string[] {
  const expression = new RegExp(`<(?:\\w+:)?${localName}\\b([^>]*)\\/?\\s*>`, "gi");
  return [...xml.matchAll(expression)].map((match) => match[1] ?? "");
}

function matchElements(xml: string, localName: string): string[] {
  const expression = new RegExp(`<(?:\\w+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${localName}>`, "gi");
  return [...xml.matchAll(expression)].map((match) => match[1] ?? "");
}

function firstElement(xml: string, localName: string): string | null {
  return matchElements(xml, localName)[0] ?? null;
}

function attribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeXml(value: string): string {
  return value.replace(/&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (entity, code: string) => {
    const normalized = code.toLocaleLowerCase();
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "amp") return "&";
    const point = normalized[1] === "x"
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : "";
  });
}
