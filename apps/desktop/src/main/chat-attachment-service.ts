import { trMain } from "./i18n";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type {
  DesktopChatAttachment,
  DesktopChatAttachmentUpload
} from "../shared/desktop-api";
import type { RouteMarketApiClient } from "./routemarket-api-client";

export const MAX_CHAT_ATTACHMENTS = 6;
export const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_TEXT_EXCERPT = 4_000;

type SelectedFile = {
  path: string;
  name: string;
  size: number;
  mimeType: string;
};

type UploadFile = Omit<SelectedFile, "path"> & {
  bytes: Buffer;
};

export async function uploadSelectedChatAttachments(
  apiClient: RouteMarketApiClient,
  filePaths: string[]
): Promise<DesktopChatAttachment[]> {
  const selected = await inspectSelectedFiles(filePaths);
  const attachments: DesktopChatAttachment[] = [];
  for (const file of selected) {
    attachments.push(await uploadAttachment(apiClient, {
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      bytes: await readFile(file.path)
    }));
  }
  return attachments;
}

export async function uploadTransferredChatAttachments(
  apiClient: RouteMarketApiClient,
  value: unknown
): Promise<DesktopChatAttachment[]> {
  const files = inspectTransferredFiles(value);
  const attachments: DesktopChatAttachment[] = [];
  for (const file of files) {
    attachments.push(await uploadAttachment(apiClient, file));
  }
  return attachments;
}

export async function releaseChatAttachment(
  apiClient: RouteMarketApiClient,
  attachment: DesktopChatAttachment
): Promise<void> {
  const response = await apiClient.request(
    "/api/app/v1/assets/references/release",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_id: attachment.assetId,
        reference_type: "chat_upload",
        reference_id: attachment.id
      })
    },
    "required"
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(readApiError(payload, response.status));
  }
}

export async function inspectSelectedFiles(
  filePaths: string[]
): Promise<SelectedFile[]> {
  const unique = [...new Set(filePaths)];
  if (unique.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(trMain("ui.93ff81d98459", [MAX_CHAT_ATTACHMENTS]));
  }
  const selected = await Promise.all(unique.map(async (path) => {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(trMain("ui.831f9764ccb0"));
    if (info.size <= 0) throw new Error(trMain("ui.bd75983531bb", [basename(path)]));
    if (info.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(trMain("ui.6df660e8cbfa", [basename(path)]));
    }
    const name = basename(path);
    return {
      path,
      name,
      size: info.size,
      mimeType: guessMimeType(name)
    };
  }));
  const total = selected.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
    throw new Error(trMain("ui.477505da461e"));
  }
  return selected;
}

async function uploadAttachment(
  apiClient: RouteMarketApiClient,
  file: UploadFile
): Promise<DesktopChatAttachment> {
  const id = `attachment_${randomUUID().replaceAll("-", "")}`;
  const blobBytes = new Uint8Array(file.bytes.byteLength);
  blobBytes.set(file.bytes);
  const form = new FormData();
  form.append(
    "file",
    new Blob([blobBytes], { type: file.mimeType }),
    file.name
  );
  form.append("reference_type", "chat_upload");
  form.append("reference_id", id);
  form.append("source", "desktop_chat");
  form.append("client", "routemarket_work");
  const response = await apiClient.request(
    "/api/app/v1/assets/upload",
    { method: "POST", body: form },
    "required"
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readUploadError(payload, response.status));
  }
  const normalized = normalizeUpload(payload, apiClient, id, file);
  if (!normalized) {
    throw new Error(trMain("ui.f96c8c1cda4a", [file.name]));
  }
  return {
    ...normalized,
    textExcerpt: isTextLike(file.name, file.mimeType)
      ? file.bytes.toString("utf8").slice(0, MAX_TEXT_EXCERPT).trim() || null
      : null
  };
}

function inspectTransferredFiles(value: unknown): UploadFile[] {
  if (!Array.isArray(value) || value.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(trMain("ui.93ff81d98459", [MAX_CHAT_ATTACHMENTS]));
  }
  const files = value.map((candidate): UploadFile => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(trMain("ui.831f9764ccb0"));
    }
    const input = candidate as Partial<DesktopChatAttachmentUpload>;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.includes("/") || name.includes("\\") || basename(name) !== name) {
      throw new Error(trMain("ui.831f9764ccb0"));
    }
    const bytes = toBuffer(input.bytes);
    if (!bytes || bytes.byteLength <= 0 || input.size !== bytes.byteLength) {
      throw new Error(trMain("ui.bd75983531bb", [name]));
    }
    if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(trMain("ui.6df660e8cbfa", [name]));
    }
    return {
      name,
      size: bytes.byteLength,
      mimeType:
        typeof input.mimeType === "string" && input.mimeType.trim()
          ? input.mimeType.trim().slice(0, 255)
          : guessMimeType(name),
      bytes
    };
  });
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
    throw new Error(trMain("ui.477505da461e"));
  }
  return files;
}

function toBuffer(value: unknown): Buffer | null {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (!ArrayBuffer.isView(value)) return null;
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function normalizeUpload(
  value: unknown,
  apiClient: RouteMarketApiClient,
  id: string,
  file: Pick<UploadFile, "name" | "size" | "mimeType">
): Omit<DesktopChatAttachment, "textExcerpt"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const asset =
    payload.asset && typeof payload.asset === "object" && !Array.isArray(payload.asset)
      ? payload.asset as Record<string, unknown>
      : null;
  const assetId = nonEmptyString(asset?.id);
  const downloadUrl = resolveAssetUrl(
    nonEmptyString(payload.download_url),
    apiClient
  );
  if (!assetId || !downloadUrl) return null;
  const mimeType = nonEmptyString(asset?.mime_type) ?? file.mimeType;
  return {
    id,
    name: nonEmptyString(asset?.original_name) ?? file.name,
    mimeType,
    size:
      typeof asset?.size_bytes === "number" && Number.isFinite(asset.size_bytes)
        ? asset.size_bytes
        : file.size,
    kind: attachmentKind(
      nonEmptyString(asset?.kind),
      mimeType
    ),
    assetId,
    downloadUrl,
    previewUrl: resolveAssetUrl(
      nonEmptyString(payload.preview_url),
      apiClient
    )
  };
}

function resolveAssetUrl(
  value: string | null,
  apiClient: RouteMarketApiClient
): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : apiClient.resolve(value);
}

function attachmentKind(
  value: string | null,
  mimeType: string
): DesktopChatAttachment["kind"] {
  if (value === "image" || value === "audio" || value === "video") return value;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readUploadError(value: unknown, status: number): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return trMain("ui.d0d0606f28d6", [status]);
}

function readApiError(value: unknown, status: number): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return trMain("ui.3f3d984dcffb", [status]);
}

function isTextLike(name: string, mimeType: string): boolean {
  return mimeType.startsWith("text/") ||
    [
      ".json", ".jsonl", ".md", ".mdx", ".yaml", ".yml", ".toml",
      ".xml", ".csv", ".tsv", ".js", ".jsx", ".ts", ".tsx", ".css",
      ".html", ".py", ".go", ".rs", ".java", ".kt", ".swift", ".sql",
      ".sh", ".ps1"
    ].includes(extname(name).toLowerCase());
}

function guessMimeType(name: string): string {
  const extension = extname(name).toLowerCase();
  const known: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
  };
  return known[extension] ?? "application/octet-stream";
}
