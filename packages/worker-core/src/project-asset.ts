import { open } from "node:fs/promises";
import { extname } from "node:path";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";
import { resolveProjectFile } from "./project-uri";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf"
};

export type ProjectAssetPreview = {
  uri: string;
  mimeType: string;
  dataUrl: string;
  bytesRead: number;
};

export async function readProjectAsset(
  registry: ProjectRegistry,
  localProjectId: string,
  relativePath: string
): Promise<ProjectAssetPreview> {
  const project = registry.get(localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  const mimeType = MIME_TYPES[extname(relativePath).toLocaleLowerCase()];
  if (!mimeType) throw new WorkerError("ASSET_PREVIEW_UNSUPPORTED", "This asset type cannot be previewed safely.");
  const filePath = await resolveProjectFile(project, relativePath);
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new WorkerError("PROJECT_FILE_NOT_FOUND", "Requested asset is not a file.");
    if (stat.size > MAX_ASSET_BYTES) {
      throw new WorkerError("ASSET_PREVIEW_TOO_LARGE", "Asset preview exceeds the 20 MiB limit.");
    }
    const buffer = Buffer.alloc(stat.size);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const value = buffer.subarray(0, bytesRead);
    return {
      uri: `project://${localProjectId}/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
      mimeType,
      dataUrl: `data:${mimeType};base64,${value.toString("base64")}`,
      bytesRead
    };
  } finally {
    await handle.close();
  }
}

export function canPreviewProjectAsset(relativePath: string): boolean {
  return Boolean(MIME_TYPES[extname(relativePath).toLocaleLowerCase()]);
}
