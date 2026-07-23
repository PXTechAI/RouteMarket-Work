import {
  Bot,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  RefreshCw,
  Trash2,
  Workflow
} from "lucide-react";
import { useState } from "react";
import brandIcon from "../../../../build/icon.png";
import type { RouteMarketWorkApi, WorkState } from "../../../shared/desktop-api";
import {
  projectFolderAvailable,
  projectFolderLabel,
  projectFolderStatus
} from "../features/projects/project-folder-status";
import { AccountMenu } from "./AccountMenu";
import { cloudStatusLabel, workerStatusLabel } from "./connection-status";
import {
  getRailExpandedPreference,
  setRailExpandedPreference
} from "./rail-preference";

type RailView = "chat" | "files" | "workflow" | "agent" | "browser" | "mcp";

export function AppRail({
  activeView,
  state,
  dataApi,
  selectedProjectId,
  authBusy,
  onSelect,
  onCreateProject,
  onSelectProject,
  onAttachProjectFolder,
  onDeleteProject,
  onRefreshState,
  onSignIn,
  onSignOut,
  onSwitchSpace
}: {
  activeView: string;
  state: WorkState;
  dataApi: Pick<
    RouteMarketWorkApi,
    "getLocalDataInfo" | "showLocalData" | "exportLocalData" | "clearLocalData"
  >;
  selectedProjectId: string | null;
  authBusy: boolean;
  onSelect(view: RailView): void;
  onCreateProject(): void;
  onSelectProject(projectId: string): void;
  onAttachProjectFolder(projectId: string): void;
  onDeleteProject(projectId: string): void;
  onRefreshState(): void;
  onSignIn(): void;
  onSignOut(): void;
  onSwitchSpace(spaceId: string): void;
}) {
  const [expanded, setExpanded] = useState(
    getRailExpandedPreference
  );

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      setRailExpandedPreference(next);
      return next;
    });
  }

  const selectedProject = state.projects.find(
    (project) => project.localProjectId === selectedProjectId
  );
  const selectedFolderAvailable = selectedProject
    ? projectFolderAvailable(selectedProject)
    : true;

  return (
    <nav className={`rm-rail ${expanded ? "expanded" : ""}`} aria-label="主导航">
      <div className="rm-rail-brand" title="RouteMarket Work">
        <div className="rm-brand-mark"><img src={brandIcon} alt="" /></div>
        <div className="rm-rail-brand-copy">
          <strong>RouteMarket</strong>
          <span>Work</span>
        </div>
      </div>

      <div className="rm-rail-group">
        <span className="rm-rail-group-label">工作区</span>
        <RailButton
          label="文件"
          active={activeView === "files"}
          disabled={!selectedFolderAvailable}
          badge={!selectedFolderAvailable ? projectFolderLabel(selectedProject) : undefined}
          onClick={() => onSelect("files")}
        >
          <Folder size={18} />
        </RailButton>
        <RailButton label="对话" active={activeView === "chat"} onClick={() => onSelect("chat")}>
          <MessageSquare size={18} />
        </RailButton>
        <RailButton label="工作流" active={activeView === "workflow"} onClick={() => onSelect("workflow")}>
          <Workflow size={18} />
        </RailButton>
      </div>

      <section className="rm-rail-projects" aria-label="项目">
        <div className="rm-rail-projects-heading">
          <span>项目</span>
          <button type="button" title="创建项目" onClick={onCreateProject}>
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="rm-rail-project-list">
          {state.projects.map((project) => {
            const folderStatus = projectFolderStatus(project);
            const folderAvailable = projectFolderAvailable(project);
            return (
              <div
                className={`rm-rail-project-row ${project.localProjectId === selectedProjectId ? "active" : ""}`}
                key={project.localProjectId}
              >
                <button className="rm-rail-project-main" type="button" title={project.displayName} onClick={() => onSelectProject(project.localProjectId)}>
                  <FolderOpen size={15} />
                  <span>{project.displayName}</span>
                  <small className={`folder-status ${folderStatus}`}>{projectFolderLabel(project)}</small>
                </button>
                {!folderAvailable && (
                  <button
                    className="rm-rail-project-action"
                    type="button"
                    title={folderStatus === "unlinked" ? "关联本机文件夹" : "重新关联文件夹"}
                    onClick={() => onAttachProjectFolder(project.localProjectId)}
                  >
                    <FolderPlus size={13} />
                  </button>
                )}
                <button className="rm-rail-project-action danger" type="button" title="删除项目" onClick={() => onDeleteProject(project.localProjectId)}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          {state.projects.length === 0 && (
            <button className="empty" type="button" onClick={onCreateProject}>
              <FolderPlus size={16} />
              <span>创建第一个项目</span>
            </button>
          )}
        </div>
      </section>

      <div className="rm-rail-group rm-rail-capabilities">
        <span className="rm-rail-group-label">本地能力</span>
        <RailButton label="Agent" active={activeView === "agent"} onClick={() => onSelect("agent")}>
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

      <div className="rm-rail-worker">
        <span className={`rm-status-dot ${state.workerStatus}`} />
        <div>
          <strong>本机 Worker</strong>
          <span>{workerStatusLabel(state.workerStatus)} · {cloudStatusLabel(state.cloudStatus)}</span>
        </div>
        <button type="button" title="刷新连接状态" onClick={onRefreshState}>
          <RefreshCw size={13} />
        </button>
      </div>

      <RailButton
        label={expanded ? "收起侧栏" : "展开侧栏"}
        onClick={toggleExpanded}
      >
        {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </RailButton>
      <AccountMenu
        state={state}
        dataApi={dataApi}
        busy={authBusy}
        expanded={expanded}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onSwitchSpace={onSwitchSpace}
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
