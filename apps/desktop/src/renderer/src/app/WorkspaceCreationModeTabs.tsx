import { AudioLines, Image, MessageSquare, Video } from "lucide-react";
import { tr } from "../i18n";
import "./workspace-creation-mode-tabs.scss";

export type WorkspaceCreationMode = "chat" | "image" | "video" | "audio";

const CREATION_MODES: ReadonlyArray<{
  key: WorkspaceCreationMode;
  labelKey: "nav.chat" | "nav.imageCreation" | "nav.videoCreation" | "nav.audioGeneration";
}> = [
  { key: "chat", labelKey: "nav.chat" },
  { key: "image", labelKey: "nav.imageCreation" },
  { key: "video", labelKey: "nav.videoCreation" },
  { key: "audio", labelKey: "nav.audioGeneration" },
];

export function WorkspaceCreationModeTabs({
  activeMode,
  onSelect,
}: {
  activeMode: WorkspaceCreationMode;
  onSelect(mode: WorkspaceCreationMode): void;
}) {
  return (
    <nav className="workspace-creation-mode-tabs" aria-label={tr("nav.creation")}>
      {CREATION_MODES.map((mode) => {
        const active = mode.key === activeMode;
        return (
          <button
            type="button"
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            key={mode.key}
            onClick={() => {
              if (!active) onSelect(mode.key);
            }}
          >
            <CreationModeIcon mode={mode.key} />
            <span>{tr(mode.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function CreationModeIcon({ mode }: { mode: WorkspaceCreationMode }) {
  if (mode === "chat") return <MessageSquare size={16} />;
  if (mode === "image") return <Image size={16} />;
  if (mode === "video") return <Video size={16} />;
  return <AudioLines size={16} />;
}
