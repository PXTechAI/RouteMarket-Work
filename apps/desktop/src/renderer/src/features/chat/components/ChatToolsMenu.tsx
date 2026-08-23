import "./chat-tools-menu.scss";

import {
  Brain,
  Check,
  ChevronRight,
  File,
  FolderClock,
  Globe2,
  Paperclip,
  Plus,
  Trash2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DesktopChatAttachment, WebSearchMode } from "../../../../../shared/desktop-api";
import { tr } from "../../../i18n";

type ToolsSubmenu = "recent" | "search" | null;

export function ChatToolsMenu({
  attachments,
  recentAttachments,
  deepThinkingEnabled,
  canUseDeepThinking,
  webSearchMode,
  canUseWebSearch,
  canUseNativeWebSearch,
  disabled,
  onChooseAttachments,
  onChooseRecentAttachment,
  onClearAttachments,
  onDeepThinkingChange,
  onWebSearchModeChange
}: {
  attachments: DesktopChatAttachment[];
  recentAttachments: DesktopChatAttachment[];
  deepThinkingEnabled: boolean;
  canUseDeepThinking: boolean;
  webSearchMode: WebSearchMode;
  canUseWebSearch: boolean;
  canUseNativeWebSearch: boolean;
  disabled: boolean;
  onChooseAttachments(): void;
  onChooseRecentAttachment(attachment: DesktopChatAttachment): void;
  onClearAttachments(): void;
  onDeepThinkingChange(value: boolean): void;
  onWebSearchModeChange(value: WebSearchMode): void;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<ToolsSubmenu>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const searchModeLabel = webSearchMode === "agentic"
    ? tr("chat.tools.search.agentic")
    : webSearchMode === "native"
      ? tr("chat.tools.search.native")
      : tr("chat.tools.search.off");

  function closeMenu() {
    setOpen(false);
    setSubmenu(null);
  }

  return (
    <div className="chat-tools-menu" ref={rootRef}>
      <button
        className={`composer-plus-button${open ? " open" : ""}`}
        type="button"
        title={tr("chat.tools.ariaLabel")}
        aria-label={tr("chat.tools.ariaLabel")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
          setSubmenu(null);
        }}
      >
        <Plus size={15}/>
      </button>

      {open ? (
        <div className="chat-tools-popover-group">
          <div className="chat-tools-popover" role="menu">
            <button
              type="button"
              role="menuitem"
              className="chat-tools-item"
              disabled={attachments.length >= 6}
              onClick={() => {
                closeMenu();
                onChooseAttachments();
              }}
            >
              <span className="chat-tools-item-icon"><Paperclip/></span>
              <span className="chat-tools-item-copy">
                <strong>{tr("chat.tools.attach")}</strong>
                <small>{tr("chat.tools.attachHint", [6, 20])}</small>
              </span>
              <span className="chat-tools-item-state"/>
            </button>

            <button
              type="button"
              role="menuitem"
              aria-expanded={submenu === "recent"}
              className={`chat-tools-item${submenu === "recent" ? " active" : ""}`}
              onMouseEnter={() => setSubmenu("recent")}
              onClick={() => setSubmenu("recent")}
            >
              <span className="chat-tools-item-icon"><FolderClock/></span>
              <span className="chat-tools-item-copy">
                <strong>{tr("chat.tools.recentFiles")}</strong>
                <small>{recentAttachments.length
                  ? tr("chat.tools.recentFilesCount", [recentAttachments.length])
                  : tr("chat.tools.recentFilesEmpty")}</small>
              </span>
              <span className="chat-tools-item-state chevron"><ChevronRight/></span>
            </button>

            {canUseDeepThinking ? (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={deepThinkingEnabled}
                className={`chat-tools-item${deepThinkingEnabled ? " active" : ""}`}
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => onDeepThinkingChange(!deepThinkingEnabled)}
              >
                <span className="chat-tools-item-icon"><Brain/></span>
                <span className="chat-tools-item-copy">
                  <strong>{tr("chat.tools.deepThinking")}</strong>
                  <small>{tr(deepThinkingEnabled ? "chat.tools.enabled" : "chat.tools.disabled")}</small>
                </span>
                <span className="chat-tools-item-state">
                  <span className={`chat-tools-toggle${deepThinkingEnabled ? " on" : ""}`} aria-hidden="true"/>
                </span>
              </button>
            ) : null}

            {canUseWebSearch ? (
              <button
                type="button"
                role="menuitem"
                aria-expanded={submenu === "search"}
                className={`chat-tools-item${webSearchMode !== "off" ? " active" : ""}`}
                onMouseEnter={() => setSubmenu("search")}
                onClick={() => setSubmenu("search")}
              >
                <span className="chat-tools-item-icon"><Globe2/></span>
                <span className="chat-tools-item-copy">
                  <strong>{tr("chat.tools.webSearch")}</strong>
                  <small>{searchModeLabel}</small>
                </span>
                <span className="chat-tools-item-state chevron"><ChevronRight/></span>
              </button>
            ) : null}

            {attachments.length ? (
              <button
                type="button"
                role="menuitem"
                className="chat-tools-item danger"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  closeMenu();
                  onClearAttachments();
                }}
              >
                <span className="chat-tools-item-icon"><Trash2/></span>
                <span className="chat-tools-item-copy">
                  <strong>{tr("chat.tools.clearFiles")}</strong>
                  <small>{tr("chat.tools.clearFilesHint", [attachments.length])}</small>
                </span>
                <span className="chat-tools-item-state"/>
              </button>
            ) : null}
          </div>

          {submenu === "recent" ? (
            <div className="chat-tools-submenu recent" role="menu" onMouseEnter={() => setSubmenu("recent")}>
              <header>
                <strong>{tr("chat.tools.recentFiles")}</strong>
                <small>{tr("chat.tools.recentFilesHint")}</small>
              </header>
              {recentAttachments.length ? (
                <div className="chat-tools-recent-list">
                  {recentAttachments.map((attachment) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={attachment.id}
                      disabled={attachments.some((item) => item.id === attachment.id) || attachments.length >= 6}
                      onClick={() => {
                        onChooseRecentAttachment(attachment);
                        closeMenu();
                      }}
                    >
                      <span><File size={16}/></span>
                      <span>
                        <strong title={attachment.name}>{attachment.name}</strong>
                        <small>{formatAttachmentSize(attachment.size)}</small>
                      </span>
                      {attachments.some((item) => item.id === attachment.id) ? <Check size={13}/> : null}
                    </button>
                  ))}
                </div>
              ) : <p>{tr("chat.tools.recentFilesEmpty")}</p>}
            </div>
          ) : null}

          {submenu === "search" ? (
            <div className="chat-tools-submenu search" role="menu" onMouseEnter={() => setSubmenu("search")}>
              {(["off", "agentic", "native"] as const).map((mode) => {
                const nativeDisabled = mode === "native" && !canUseNativeWebSearch;
                const label = mode === "off"
                  ? tr("chat.tools.search.off")
                  : mode === "agentic"
                    ? tr("chat.tools.search.agentic")
                    : tr("chat.tools.search.native");
                const description = mode === "agentic"
                  ? tr("chat.tools.search.agenticHint")
                  : mode === "native"
                    ? tr(nativeDisabled
                      ? "chat.tools.search.nativeUnavailable"
                      : "chat.tools.search.nativeHint")
                    : null;
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={webSearchMode === mode}
                    key={mode}
                    disabled={nativeDisabled}
                    className={webSearchMode === mode ? "selected" : ""}
                    onClick={() => {
                      onWebSearchModeChange(mode);
                      closeMenu();
                    }}
                  >
                    <span>
                      <strong>{label}</strong>
                      {description ? <small>{description}</small> : null}
                    </span>
                    {webSearchMode === mode ? <Check size={14}/> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
