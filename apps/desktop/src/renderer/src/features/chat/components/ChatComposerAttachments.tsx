import {
  File,
  FileImage,
  FileMusic,
  FileText,
  FileVideo,
  X
} from "lucide-react";
import type { DesktopChatAttachment } from "../../../../../shared/desktop-api";
import { tr } from "../../../i18n";
import "./chat-composer-attachments.scss";

type ChatComposerAttachmentsProps = {
  attachments: DesktopChatAttachment[];
  disabled?: boolean;
  onRemove(attachmentId: string): void;
};

export function ChatComposerAttachments({
  attachments,
  disabled = false,
  onRemove
}: ChatComposerAttachmentsProps) {
  if (!attachments.length) return null;

  return (
    <div className="chat-composer-attachments" aria-label={tr("ui.fd8f8ccc9b7f")}>
      <div className="chat-composer-attachment-list">
        {attachments.map((attachment) => {
          const previewUrl = attachment.previewUrl ?? attachment.downloadUrl;
          const isImage = attachment.kind === "image" && Boolean(previewUrl);
          const uploading = !attachment.assetId;
          return (
            <div
              className={`chat-composer-attachment${isImage ? " image" : ""}`}
              key={attachment.id}
            >
              {isImage ? (
                <div className="chat-composer-attachment-thumb">
                  <img src={previewUrl ?? ""} alt={attachment.name} loading="lazy" />
                  {uploading ? (
                    <span className="chat-composer-attachment-status">
                      {tr("chat.attachments.uploading")}
                    </span>
                  ) : null}
                </div>
              ) : (
                <>
                  <span className={`chat-composer-attachment-icon ${attachment.kind}`}>
                    <AttachmentIcon attachment={attachment} />
                  </span>
                  <span className="chat-composer-attachment-copy">
                    <strong title={attachment.name}>{attachment.name}</strong>
                    <small>{uploading ? tr("chat.attachments.uploading") : formatAttachmentMeta(attachment)}</small>
                  </span>
                </>
              )}
              <button
                type="button"
                className="chat-composer-attachment-remove"
                title={tr("ui.6f67cadb4d3a", [attachment.name])}
                aria-label={tr("ui.6f67cadb4d3a", [attachment.name])}
                disabled={disabled}
                onClick={() => onRemove(attachment.id)}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentIcon({ attachment }: { attachment: DesktopChatAttachment }) {
  if (attachment.kind === "image") return <FileImage size={22} />;
  if (attachment.kind === "audio") return <FileMusic size={22} />;
  if (attachment.kind === "video") return <FileVideo size={22} />;
  if (isDocument(attachment)) return <FileText size={22} />;
  return <File size={22} />;
}

function formatAttachmentMeta(attachment: DesktopChatAttachment): string {
  const label =
    attachment.kind === "image"
      ? tr("chat.attachments.image")
      : attachment.kind === "audio"
        ? tr("chat.attachments.audio")
        : attachment.kind === "video"
          ? tr("chat.attachments.video")
          : tr("chat.attachments.file");
  return `${label} · ${formatAttachmentSize(attachment.size)}`;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isDocument(attachment: DesktopChatAttachment): boolean {
  return attachment.mimeType.startsWith("text/") ||
    /\.(?:csv|docx?|json|md|pdf|pptx?|rtf|tsx?|txt|xlsx?|ya?ml)$/i.test(attachment.name);
}
