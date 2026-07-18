import {
  Bot,
  Folder,
  Globe2,
  MessageSquare,
  Plug,
  Settings2,
  Workflow
} from "lucide-react";
import type { WorkState } from "../../../shared/desktop-api";
import { AccountMenu } from "./AccountMenu";

type RailView = "chat" | "files" | "workflow" | "browser" | "mcp";

export function AppRail({
  activeView,
  state,
  authBusy,
  onSelect,
  onSignIn,
  onSignOut
}: {
  activeView: string;
  state: WorkState;
  authBusy: boolean;
  onSelect(view: RailView): void;
  onSignIn(): void;
  onSignOut(): void;
}) {
  return (
    <nav className="rm-rail" aria-label="主导航">
      <div className="rm-brand-mark" title="RouteMarket Work">R</div>
      <div className="rm-rail-group">
        <RailButton label="项目" active={activeView === "files"} onClick={() => onSelect("files")}>
          <Folder size={18} />
        </RailButton>
        <RailButton label="对话" active={activeView === "chat"} onClick={() => onSelect("chat")}>
          <MessageSquare size={18} />
        </RailButton>
        <RailButton label="工作流" active={activeView === "workflow"} onClick={() => onSelect("workflow")}>
          <Workflow size={18} />
        </RailButton>
        <RailButton label="Agent">
          <Bot size={18} />
        </RailButton>
        <RailButton label="浏览器" active={activeView === "browser"} onClick={() => onSelect("browser")}>
          <Globe2 size={18} />
        </RailButton>
        <RailButton label="Local MCP" active={activeView === "mcp"} onClick={() => onSelect("mcp")}>
          <Plug size={18} />
        </RailButton>
      </div>
      <div className="rm-rail-spacer" />
      <RailButton label="设置">
        <Settings2 size={18} />
      </RailButton>
      <AccountMenu
        state={state}
        busy={authBusy}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
    </nav>
  );
}

function RailButton({
  label,
  active = false,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick?(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rm-rail-button ${active ? "active" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
