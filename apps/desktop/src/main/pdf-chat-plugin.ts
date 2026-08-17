import { createHash } from "node:crypto";
import type { ProjectChatArtifact } from "../shared/desktop-api";
import type { ProjectPdfResult } from "./project-pdf-service";
import type { ProjectChatPluginTool } from "./project-chat-plugin-registry";
import type { ProjectChatToolExecution } from "./project-chat-tools";
import type { ToolApprovalMode, ToolRisk } from "./tool-broker";

const PLUGIN_ID = "ai.routemarket.pdf";
const TOOL_NAME = "pdf";

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

export function createPdfChatPlugin(options: {
  createProjectPdf(input: {
    localProjectId: string;
    relativePath: string;
    title?: string;
    content: string;
  }): Promise<ProjectPdfResult>;
  runAuthorized: RunAuthorized;
}): ProjectChatPluginTool {
  return {
    pluginId: PLUGIN_ID,
    definition: {
      type: "function",
      function: {
        name: TOOL_NAME,
        description: "Create a polished PDF file in the current project from Markdown or plain text. Use this tool directly for PDF generation. Do not create helper scripts or start project processes.",
        parameters: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["create"], description: "PDF operation to perform." },
            path: { type: "string", description: "A new .pdf filename in the current project root." },
            title: { type: "string", description: "Document title." },
            content: { type: "string", description: "Complete Markdown or plain-text document content." }
          },
          required: ["operation", "path", "content"],
          additionalProperties: false
        }
      }
    },
    async execute({ localProjectId, args, signal, approvalMode }) {
      throwIfAborted(signal);
      assertNoUnexpectedKeys(args, ["operation", "path", "title", "content"]);
      if (requiredString(args, "operation", 16) !== "create") throw new Error("Unsupported PDF operation.");
      const path = requiredString(args, "path", 180);
      const title = optionalString(args, "title", 256);
      const content = requiredString(args, "content", 500_000);
      return options.runAuthorized(
        localProjectId,
        {
          capability: "local.pdf.write",
          risk: "R2",
          title: "PDF",
          detail: path,
          approvalKey: createHash("sha256").update(JSON.stringify({ path, title, content })).digest("hex")
        },
        "PDF",
        path,
        async () => {
          throwIfAborted(signal);
          const result = await options.createProjectPdf({ localProjectId, relativePath: path, ...(title ? { title } : {}), content });
          return {
            content: JSON.stringify({
              operation: "create",
              created: true,
              page_count: result.pageCount,
              sha256: result.sha256,
              output_files: [{
                filename: result.filename,
                relative_path: result.relativePath,
                mime_type: result.mimeType,
                size: result.bytes,
                content_hash: result.sha256,
                project_uri: result.uri
              }]
            }),
            summary: `${result.filename}${result.pageCount ? ` · ${result.pageCount} pages` : ""}`,
            artifacts: [artifactFor(localProjectId, result)]
          };
        },
        approvalMode
      );
    }
  };
}

function artifactFor(localProjectId: string, result: ProjectPdfResult): ProjectChatArtifact {
  return {
    id: `artifact_${createHash("sha256").update(`${localProjectId}:${result.relativePath}:${result.sha256}`).digest("hex").slice(0, 24)}`,
    kind: "file",
    relativePath: result.relativePath,
    filename: result.filename,
    mimeType: result.mimeType,
    size: result.bytes,
    uri: result.uri,
    providerId: PLUGIN_ID
  };
}

function requiredString(args: Record<string, unknown>, key: string, maxLength: number): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
    throw new Error(`${key} must contain between 1 and ${maxLength} characters.`);
  }
  return value.trim();
}
function optionalString(args: Record<string, unknown>, key: string, maxLength: number) { return args[key] === undefined ? undefined : requiredString(args, key, maxLength); }
function assertNoUnexpectedKeys(args: Record<string, unknown>, allowed: string[]) { const unexpected = Object.keys(args).find((key) => !allowed.includes(key)); if (unexpected) throw new Error(`Unexpected tool argument: ${unexpected}`); }
function throwIfAborted(signal?: AbortSignal) { if (!signal?.aborted) return; const error = new Error("Operation aborted."); error.name = "AbortError"; throw error; }
