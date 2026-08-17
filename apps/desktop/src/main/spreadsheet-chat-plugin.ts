import { createHash } from "node:crypto";
import { trMain } from "./i18n";
import type { ProjectChatArtifact } from "../shared/desktop-api";
import type { ProjectChatToolExecution } from "./project-chat-tools";
import type { ProjectChatPluginTool } from "./project-chat-plugin-registry";
import type { ToolApprovalMode, ToolRisk } from "./tool-broker";
import type { WorkerClient } from "./worker-client";

const PLUGIN_ID = "ai.routemarket.spreadsheet";
const TOOL_NAME = "spreadsheet";
const MAX_PATH_LENGTH = 1_024;

type SpreadsheetWorkerClient = Partial<Pick<
  WorkerClient,
  | "createProjectSpreadsheet"
  | "inspectProjectSpreadsheet"
  | "readProjectSpreadsheetRange"
  | "writeProjectSpreadsheetRange"
  | "exportProjectSpreadsheetCsv"
>>;

type RunAuthorized = (
  localProjectId: string,
  authorization: {
    capability: string;
    risk: ToolRisk;
    title: string;
    detail: string;
    auditDetail?: string;
    approvalKey: string;
  },
  activityTitle: string,
  activityDetail: string,
  operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>,
  approvalMode: ToolApprovalMode
) => Promise<ProjectChatToolExecution>;

export function createSpreadsheetChatPlugin(options: {
  workerClient: SpreadsheetWorkerClient;
  runAuthorized: RunAuthorized;
  identity?: {
    pluginId: string;
    toolName: string;
    description: string;
  };
}): ProjectChatPluginTool {
  const identity = options.identity ?? {
    pluginId: PLUGIN_ID,
    toolName: TOOL_NAME,
    description: "Create, inspect, read, edit, and export spreadsheet files in the current project. Always select an operation explicitly. Before write_range, pass the sha256 returned by inspect or read_range as expected_sha256. Do not create helper scripts for spreadsheet work."
  };
  return {
    pluginId: identity.pluginId,
    definition: {
      type: "function",
      function: {
        name: identity.toolName,
        description: identity.description,
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["create", "inspect", "read_range", "write_range", "export_csv"],
              description: "Spreadsheet operation to perform."
            },
            path: { type: "string", description: "Project-relative .xlsx path." },
            output_path: { type: "string", description: "New project-relative .csv path for export_csv." },
            sheet_name: { type: "string", description: "Optional worksheet name. The first worksheet is used by default." },
            range: { type: "string", description: "A1 range. read_range requires both corners; write_range accepts a top-left cell or exact range." },
            expected_sha256: { type: "string", description: "Required by write_range. Use the sha256 returned by inspect or read_range." },
            title: { type: "string", description: "Optional workbook title for create." },
            rows: {
              type: "array",
              description: "Rows for create or write_range. Cells may be strings, numbers, booleans, or null.",
              items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } }
            },
            freeze_pane: { type: "string", description: "Optional freeze pane for create, such as A2 or B4." },
            column_widths: { type: "array", items: { type: "number" }, description: "Optional column widths for create." }
          },
          required: ["operation", "path"],
          additionalProperties: false
        }
      }
    },
    async execute({ localProjectId, args, signal, approvalMode }) {
      throwIfAborted(signal);
      assertNoUnexpectedKeys(args, [
        "operation", "path", "output_path", "sheet_name", "range", "expected_sha256",
        "title", "rows", "freeze_pane", "column_widths"
      ]);
      const operation = requiredString(args, "operation", 32);
      const path = requiredString(args, "path", MAX_PATH_LENGTH).replaceAll("\\", "/");
      const sheetName = optionalString(args, "sheet_name", 31);
      const activityTitle = trMain("chat.tool.spreadsheet");

      if (operation === "inspect") {
        const inspect = requireMethod(options.workerClient.inspectProjectSpreadsheet?.bind(options.workerClient), "inspect");
        return options.runAuthorized(
          localProjectId,
          readAuthorization(operation, path, sheetName),
          activityTitle,
          path,
          async () => {
            const result = await inspect({ localProjectId, relativePath: path, ...(sheetName ? { sheetName } : {}) });
            return {
              content: JSON.stringify({
                operation,
                path: result.relativePath,
                sha256: result.sha256,
                bytes: result.bytes,
                sheets: result.sheets,
                active_sheet_id: result.activeSheetId,
                active_sheet_name: result.activeSheetName,
                used_range: result.usedRange,
                row_count: result.rowCount,
                column_count: result.columnCount,
                truncated: result.truncated
              }),
              summary: `${result.filename} · ${result.activeSheetName} · ${result.usedRange}`
            };
          },
          approvalMode
        );
      }

      if (operation === "read_range") {
        const readRange = requireMethod(options.workerClient.readProjectSpreadsheetRange?.bind(options.workerClient), "read_range");
        const range = requiredString(args, "range", 64);
        return options.runAuthorized(
          localProjectId,
          readAuthorization(operation, path, sheetName, range),
          activityTitle,
          `${path} · ${range}`,
          async () => {
            const result = await readRange({ localProjectId, relativePath: path, range, ...(sheetName ? { sheetName } : {}) });
            return {
              content: JSON.stringify({
                operation,
                path: result.relativePath,
                sha256: result.sha256,
                sheet_name: result.activeSheetName,
                range: result.range,
                rows: result.rows,
                truncated: result.truncated
              }),
              summary: `${result.filename} · ${result.activeSheetName}!${result.range}`
            };
          },
          approvalMode
        );
      }

      if (operation === "create") {
        const create = requireMethod(options.workerClient.createProjectSpreadsheet?.bind(options.workerClient), "create");
        const rows = requiredSpreadsheetRows(args.rows);
        const title = optionalString(args, "title", 256);
        const freezePane = optionalString(args, "freeze_pane", 16);
        const columnWidths = optionalNumberArray(args, "column_widths", 100);
        return options.runAuthorized(
          localProjectId,
          writeAuthorization(operation, path, { sheetName, title, rows, freezePane, columnWidths }),
          activityTitle,
          path,
          async () => {
            throwIfAborted(signal);
            const result = await create({
              localProjectId,
              relativePath: path,
              ...(sheetName ? { sheetName } : {}),
              ...(title ? { title } : {}),
              rows,
              ...(freezePane ? { freezePane } : {}),
              ...(columnWidths.length ? { columnWidths } : {})
            });
            const artifact = artifactFor(localProjectId, result);
            return {
              content: JSON.stringify({ operation, created: true, sha256: result.sha256, output_files: [outputFile(result)] }),
              summary: result.filename,
              artifacts: [artifact]
            };
          },
          approvalMode
        );
      }

      if (operation === "write_range") {
        const writeRange = requireMethod(options.workerClient.writeProjectSpreadsheetRange?.bind(options.workerClient), "write_range");
        const range = requiredString(args, "range", 64);
        const expectedSha256 = requiredSha256(args, "expected_sha256");
        const rows = requiredSpreadsheetRows(args.rows, 500);
        return options.runAuthorized(
          localProjectId,
          writeAuthorization(operation, path, { sheetName, range, expectedSha256, rows }),
          activityTitle,
          `${path} · ${range}`,
          async () => {
            throwIfAborted(signal);
            const result = await writeRange({
              localProjectId,
              relativePath: path,
              range,
              rows,
              expectedSha256,
              ...(sheetName ? { sheetName } : {})
            });
            const artifact = artifactFor(localProjectId, result);
            return {
              content: JSON.stringify({
                operation,
                changed: result.changed,
                sheet_name: result.sheetName,
                range: result.range,
                previous_sha256: result.previousSha256,
                sha256: result.sha256,
                output_files: [outputFile(result)]
              }),
              summary: `${result.filename} · ${result.sheetName}!${result.range}`,
              artifacts: [artifact]
            };
          },
          approvalMode
        );
      }

      if (operation === "export_csv") {
        const exportCsv = requireMethod(options.workerClient.exportProjectSpreadsheetCsv?.bind(options.workerClient), "export_csv");
        const outputPath = requiredString(args, "output_path", MAX_PATH_LENGTH).replaceAll("\\", "/");
        const range = optionalString(args, "range", 64);
        return options.runAuthorized(
          localProjectId,
          writeAuthorization(operation, outputPath, { sourcePath: path, sheetName, range }),
          activityTitle,
          outputPath,
          async () => {
            throwIfAborted(signal);
            const result = await exportCsv({
              localProjectId,
              relativePath: path,
              outputPath,
              ...(sheetName ? { sheetName } : {}),
              ...(range ? { range } : {})
            });
            const artifact = artifactFor(localProjectId, result);
            return {
              content: JSON.stringify({
                operation,
                exported: true,
                source_path: path,
                sheet_name: result.sheetName,
                range: result.range,
                sha256: result.sha256,
                output_files: [outputFile(result)]
              }),
              summary: result.filename,
              artifacts: [artifact]
            };
          },
          approvalMode
        );
      }

      throw new Error(`Unsupported spreadsheet operation: ${operation}`);
    }
  };
}

function readAuthorization(operation: string, path: string, sheetName?: string, range?: string) {
  return {
    capability: "local.spreadsheet.read",
    risk: "R0" as const,
    title: trMain("chat.tool.spreadsheet"),
    detail: [path, sheetName, range].filter(Boolean).join(" · "),
    approvalKey: sha256(JSON.stringify({ operation, path, sheetName, range }))
  };
}

function writeAuthorization(operation: string, path: string, detail: unknown) {
  return {
    capability: "local.spreadsheet.write",
    risk: "R2" as const,
    title: trMain("chat.tool.spreadsheet"),
    detail: path,
    approvalKey: sha256(JSON.stringify({ operation, path, detail }))
  };
}

function artifactFor(localProjectId: string, result: {
  relativePath: string;
  filename: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  uri: string;
}): ProjectChatArtifact {
  return {
    id: `artifact_${sha256(`${localProjectId}:${result.relativePath}:${result.sha256}`).slice(0, 24)}`,
    kind: "file",
    relativePath: result.relativePath,
    filename: result.filename,
    mimeType: result.mimeType,
    size: result.bytes,
    uri: result.uri,
    providerId: PLUGIN_ID
  };
}

function outputFile(result: { filename: string; relativePath: string; mimeType: string; bytes: number; sha256: string; uri: string }) {
  return {
    filename: result.filename,
    relative_path: result.relativePath,
    mime_type: result.mimeType,
    size: result.bytes,
    content_hash: result.sha256,
    project_uri: result.uri
  };
}

function requireMethod<T extends (...args: never[]) => unknown>(method: T | undefined, operation: string): T {
  if (!method) throw new Error(`The native spreadsheet ${operation} runtime is unavailable.`);
  return method;
}

function requiredString(args: Record<string, unknown>, key: string, maxLength: number): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${key} must contain between 1 and ${maxLength} characters.`);
  }
  if (value.includes("\0")) throw new Error(`${key} contains an invalid null byte.`);
  return value.trim();
}
function optionalString(args: Record<string, unknown>, key: string, maxLength: number) { return args[key] === undefined ? undefined : requiredString(args, key, maxLength); }
function requiredSha256(args: Record<string, unknown>, key: string) { const value = requiredString(args, key, 71); if (!/^sha256:[a-f0-9]{64}$/i.test(value)) throw new Error(`${key} must be a sha256: digest.`); return value.toLowerCase(); }
function assertNoUnexpectedKeys(args: Record<string, unknown>, allowed: string[]) { const unexpected = Object.keys(args).find((key) => !allowed.includes(key)); if (unexpected) throw new Error(`Unexpected tool argument: ${unexpected}`); }

function requiredSpreadsheetRows(value: unknown, maxRows = 2_000): Array<Array<string | number | boolean | null>> {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxRows) throw new Error(`rows must contain between 1 and ${maxRows} rows.`);
  let cellCount = 0;
  return value.map((rawRow, index) => {
    if (!Array.isArray(rawRow) || rawRow.length > 100) throw new Error(`rows[${index}] must contain at most 100 cells.`);
    cellCount += rawRow.length;
    if (cellCount > 50_000) throw new Error("Spreadsheet input exceeds 50000 cells.");
    return rawRow.map((cell) => {
      if (cell === null || typeof cell === "boolean") return cell;
      if (typeof cell === "number" && Number.isFinite(cell)) return cell;
      if (typeof cell === "string" && cell.length <= 10_000 && !cell.includes("\0")) return cell;
      throw new Error("Spreadsheet cells must be strings, finite numbers, booleans, or null.");
    });
  });
}
function optionalNumberArray(args: Record<string, unknown>, key: string, maxItems: number): number[] { const value = args[key]; if (value === undefined) return []; if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${key} must be an array of at most ${maxItems} finite numbers.`); return value as number[]; }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function throwIfAborted(signal?: AbortSignal) { if (!signal?.aborted) return; const error = new Error("Operation aborted."); error.name = "AbortError"; throw error; }
