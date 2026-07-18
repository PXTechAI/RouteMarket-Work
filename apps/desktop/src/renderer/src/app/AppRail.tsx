import {
  Bot,
  Folder,
  Globe2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Workflow
} from "lucide-react";
import { useState } from "react";
import type { WorkState } from "../../../shared/desktop-api";
import { AccountMenu } from "./AccountMenu";

type RailView = "chat" | "files" | "workflow" | "browser" | "mcp";
const railExpandedKey = "routemarket-work:rail-expanded";

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
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(railExpandedKey) === "true"
  );

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      localStorage.setItem(railExpandedKey, String(next));
      return next;
    });
  }

  return (
    <nav className={`rm-rail ${expanded ? "expanded" : ""}`} aria-label="主导航">
      <div className="rm-rail-brand" title="RouteMarket Work">
        <div className="rm-brand-mark">R</div>
        <div className="rm-rail-brand-copy">
          <strong>RouteMarket</strong>
          <span>Work</span>
        </div>
      </div>

      <div className="rm-rail-group">
        <span className="rm-rail-group-label">工作区</span>
        <RailButton label="项目" active={activeView === "files"} onClick={() => onSelect("files")}>
          <Folder size={18} />
        </RailButton>
        <RailButton label="对话" active={activeView === "chat"} onClick={() => onSelect("chat")}>
          <MessageSquare size={18} />
        </RailButton>
        <RailButton label="工作流" active={activeView === "workflow"} onClick={() => onSelect("workflow")}>
          <Workflow size={18} />
        </RailButton>
      </div>

      <div className="rm-rail-group rm-rail-capabilities">
        <span className="rm-rail-group-label">本地能力</span>
        <RailButton label="Agent" disabled badge="即将推出">
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

      <RailButton
        label={expanded ? "收起侧栏" : "展开侧栏"}
        onClick={toggleExpanded}
      >
        {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </RailButton>
      <AccountMenu
        state={state}
        busy={authBusy}
        expanded={expanded}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
    </nav>
  );
}

function RailButton({
  label,
  active = false,
  disabled = false,
  badge,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string;
  onClick?(): void;
  children: React.ReactNode;
}) {
  const title = disabled && badge ? `${label}（${badge}）` : label;

  return (
    <button
      className={`rm-rail-button ${active ? "active" : ""}`}
      type="button"
      title={title}
      aria-label={title}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="rm-rail-button-icon">{children}</span>
      <span className="rm-rail-button-label">{label}</span>
      {badge && <span className="rm-rail-button-badge">{badge}</span>}
    </button>
  );
}
