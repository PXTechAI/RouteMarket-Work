import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import { WorkerError } from "./errors";
import { canPreviewProjectAsset, readProjectAsset } from "./project-asset";
import { ProjectRegistry } from "./project-registry";
import { resolveProjectFile } from "./project-uri";
import { readXlsxPreview } from "./xlsx-preview";

const MAX_DELIMITED_BYTES = 2 * 1024 * 1024;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 100;
const MAX_CELL_CHARACTERS = 10_000;

export type ProjectArtifactPreview =
  | {
      kind: "media";
      providerId: "core.media";
      uri: string;
      mimeType: string;
      dataUrl: string;
      bytesRead: number;
    }
  | {
      kind: "table";
      providerId: "core.delimited-table" | "ai.routemarket.spreadsheet";
      viewerId: "core.delimited-table" | "spreadsheet.viewer";
      uri: string;
      mimeType:
        | "text/csv"
        | "text/tab-separated-values"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      rows: string[][];
      rowCount: number;
      columnCount: number;
      bytesRead: number;
      truncated: boolean;
      sheets?: Array<{ id: string; name: string }>;
      activeSheetId?: string;
    }
  | {
      kind: "pdf";
      providerId: "ai.routemarket.pdf";
      viewerId: "pdf.viewer";
      uri: string;
      mimeType: "application/pdf";
      dataUrl: string;
      bytesRead: number;
      pageCount: number;
      pageNumber: number;
      width: number;
      height: number;
      isolated: true;
    }
  | {
      kind: "unavailable";
      providerId: "ai.routemarket.spreadsheet" | "ai.routemarket.pdf";
      viewerId: "spreadsheet.viewer" | "pdf.viewer";
      uri: string;
      title: string;
      reason: string;
    };

export async function previewProjectArtifact(
  registry: ProjectRegistry,
  localProjectId: string,
  relativePath: string,
  selectedSheetId?: string,
  pageNumber?: number,
  renderPdfPage?: (filePath: string, pageNumber?: number) => Promise<{
    dataUrl: string;
    bytesRead: number;
    pageCount: number;
    pageNumber: number;
    width: number;
    height: number;
  }>
): Promise<ProjectArtifactPreview> {
  const extension = extname(relativePath).toLocaleLowerCase();
  if (extension === ".csv" || extension === ".tsv") {
    return previewDelimitedTable(registry, localProjectId, relativePath, extension === ".csv" ? "," : "\t");
  }
  if (extension === ".xlsx") {
    const project = registry.get(localProjectId);
    if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
    const filePath = await resolveProjectFile(project, relativePath);
    const workbook = await readXlsxPreview(filePath, selectedSheetId);
    const workbookStat = await stat(filePath);
    return {
      kind: "table",
      providerId: "ai.routemarket.spreadsheet",
      viewerId: "spreadsheet.viewer",
      uri: projectUri(localProjectId, relativePath),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rows: workbook.rows,
      rowCount: workbook.rowCount,
      columnCount: workbook.columnCount,
      bytesRead: workbookStat.size,
      truncated: workbook.truncated,
      sheets: workbook.sheets,
      activeSheetId: workbook.activeSheetId
    };
  }
  if (extension === ".xls") {
    return {
      kind: "unavailable",
      providerId: "ai.routemarket.spreadsheet",
      viewerId: "spreadsheet.viewer",
      uri: projectUri(localProjectId, relativePath),
      title: "Spreadsheet preview is not available yet",
      reason: "Legacy binary XLS preview is planned. Convert this workbook to XLSX for the built-in safe preview."
    };
  }
  if (extension === ".pdf") {
    if (renderPdfPage) {
      const project = registry.get(localProjectId);
      if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
      const filePath = await resolveProjectFile(project, relativePath);
      const rendered = await renderPdfPage(filePath, pageNumber);
      return {
        kind: "pdf",
        providerId: "ai.routemarket.pdf",
        viewerId: "pdf.viewer",
        uri: projectUri(localProjectId, relativePath),
        mimeType: "application/pdf",
        isolated: true,
        ...rendered
      };
    }
    return {
      kind: "unavailable",
      providerId: "ai.routemarket.pdf",
      viewerId: "pdf.viewer",
      uri: projectUri(localProjectId, relativePath),
      title: "PDF preview is not available yet",
      reason: "The PDF plugin is planned, but its isolated rendering engine has not been installed in this build."
    };
  }
  if (canPreviewProjectAsset(relativePath)) {
    const asset = await readProjectAsset(registry, localProjectId, relativePath);
    return {
      kind: "media",
      providerId: "core.media",
      ...asset
    };
  }
  throw new WorkerError("ARTIFACT_PREVIEW_UNSUPPORTED", "No safe viewer is registered for this file type.");
}

export function canPreviewProjectArtifact(relativePath: string): boolean {
  return /\.(?:csv|tsv|xlsx?|png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm|pdf)$/i.test(relativePath);
}

async function previewDelimitedTable(
  registry: ProjectRegistry,
  localProjectId: string,
  relativePath: string,
  delimiter: "," | "\t"
): Promise<Extract<ProjectArtifactPreview, { kind: "table" }>> {
  const project = registry.get(localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  const filePath = await resolveProjectFile(project, relativePath);
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new WorkerError("PROJECT_FILE_NOT_FOUND", "Requested artifact is not a file.");
    const byteLimit = Math.min(stat.size, MAX_DELIMITED_BYTES);
    const buffer = Buffer.alloc(byteLimit);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const parsed = parseDelimitedText(buffer.subarray(0, bytesRead).toString("utf8"), delimiter);
    return {
      kind: "table",
      providerId: "core.delimited-table",
      viewerId: "core.delimited-table",
      uri: projectUri(localProjectId, relativePath),
      mimeType: delimiter === "," ? "text/csv" : "text/tab-separated-values",
      rows: parsed.rows,
      rowCount: parsed.rows.length,
      columnCount: parsed.columnCount,
      bytesRead,
      truncated: stat.size > MAX_DELIMITED_BYTES || parsed.truncated
    };
  } finally {
    await handle.close();
  }
}

export function parseDelimitedText(
  source: string,
  delimiter: "," | "\t"
): { rows: string[][]; columnCount: number; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

  const pushCell = () => {
    if (row.length >= MAX_TABLE_COLUMNS) {
      truncated = true;
      cell = "";
      return;
    }
    if (cell.length > MAX_CELL_CHARACTERS) truncated = true;
    row.push(cell.slice(0, MAX_CELL_CHARACTERS));
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (rows.length < MAX_TABLE_ROWS) rows.push(row);
    else truncated = true;
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        if (cell.length < MAX_CELL_CHARACTERS) cell += '"';
        else truncated = true;
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else if (cell.length < MAX_CELL_CHARACTERS) {
        cell += character;
      } else {
        truncated = true;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === delimiter) pushCell();
    else if (character === "\n") pushRow();
    else if (character !== "\r") {
      if (cell.length < MAX_CELL_CHARACTERS) cell += character;
      else truncated = true;
    }
  }
  if (cell.length > 0 || row.length > 0 || (text.length > 0 && !text.endsWith("\n"))) pushRow();
  return {
    rows,
    columnCount: rows.reduce((maximum, current) => Math.max(maximum, current.length), 0),
    truncated
  };
}

function projectUri(localProjectId: string, relativePath: string): string {
  return `project://${localProjectId}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}
