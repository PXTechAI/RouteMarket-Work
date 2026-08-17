import { createHash } from "node:crypto";
import type { ProjectChatArtifact } from "../shared/desktop-api";

const MAX_OUTPUT_FILES = 20;

export function extractProjectOutputArtifacts(
  localProjectId: string,
  resultJson: string,
  providerId: string
): ProjectChatArtifact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const result = parsed as Record<string, unknown>;
  if (
    result.timed_out === true ||
    (typeof result.exit_code === "number" && result.exit_code !== 0) ||
    (typeof result.error === "string" && result.error.trim()) ||
    (typeof result.error_code === "string" && result.error_code.trim()) ||
    !Array.isArray(result.output_files)
  ) return [];

  return result.output_files.flatMap((value): ProjectChatArtifact[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const file = value as Record<string, unknown>;
    const relativePath = readRelativePath(file);
    if (!relativePath) return [];
    const filename = typeof file.filename === "string" && file.filename.trim()
      ? file.filename.trim().slice(0, 512)
      : relativePath.split("/").at(-1)!;
    const mimeType = typeof file.mime_type === "string" && file.mime_type.trim()
      ? file.mime_type.trim().slice(0, 256)
      : "application/octet-stream";
    const size = typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0
      ? file.size
      : 0;
    const expectedUri = projectUri(localProjectId, relativePath);
    const uri = typeof file.project_uri === "string" && file.project_uri === expectedUri
      ? file.project_uri
      : expectedUri;
    const identity = typeof file.content_hash === "string" && file.content_hash
      ? file.content_hash
      : `${relativePath}:${size}`;
    return [{
      id: `artifact_${createHash("sha256").update(`${localProjectId}:${identity}`).digest("hex").slice(0, 24)}`,
      kind: "file",
      relativePath,
      filename,
      mimeType,
      size,
      uri,
      providerId
    }];
  }).slice(0, MAX_OUTPUT_FILES);
}

function readRelativePath(file: Record<string, unknown>): string | null {
  const value = typeof file.relative_path === "string"
    ? file.relative_path
    : typeof file.relativePath === "string"
      ? file.relativePath
      : "";
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.length > 1_024 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) return null;
  return normalized;
}

function projectUri(localProjectId: string, relativePath: string): string {
  return `project://${localProjectId}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}
