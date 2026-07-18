import {
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search
} from "lucide-react";
import type {
  WorkState
} from "../../../../shared/desktop-api";

export function ProjectSidebar({
  state,
  selectedProjectId,
  onChooseProject,
  onSelectProject,
  onRefreshState
}: {
  state: WorkState;
  selectedProjectId: string | null;
  onChooseProject(): void;
  onSelectProject(projectId: string): void;
  onRefreshState(): void;
}) {
  return (
    <aside className="rm-project-sidebar">
      <button className="rm-project-search" type="button">
        <Search size={15} />
        <span>搜索项目</span>
        <kbd>Ctrl K</kbd>
      </button>

      <section className="rm-sidebar-section rm-projects-section">
        <div className="rm-sidebar-heading">
          <span>项目</span>
          <button
            className="rm-icon-button"
            type="button"
            title="打开文件夹"
            onClick={onChooseProject}
          >
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="rm-project-list">
          {state.projects.map((project) => (
            <button
              className={`rm-project-button ${project.localProjectId === selectedProjectId ? "active" : ""}`}
              key={project.localProjectId}
              type="button"
              onClick={() => onSelectProject(project.localProjectId)}
            >
              <FolderOpen size={16} />
              <span>{project.displayName}</span>
            </button>
          ))}
          {state.projects.length === 0 && (
            <button className="rm-empty-project" type="button" onClick={onChooseProject}>
              <FolderPlus size={20} />
              <span>打开本地文件夹</span>
            </button>
          )}
        </div>
      </section>

      <div className="rm-worker-status">
        <span className={`rm-status-dot ${state.workerStatus}`} />
        <div>
          <strong>Local Worker</strong>
          <span>
            {state.workerStatus === "online" ? "本地已连接" : "正在启动"}
            {" · "}
            {cloudStatusLabel(state.cloudStatus)}
          </span>
        </div>
        <button className="rm-icon-button" type="button" title="刷新状态" onClick={onRefreshState}>
          <RefreshCw size={14} />
        </button>
      </div>
    </aside>
  );
}

function cloudStatusLabel(status: WorkState["cloudStatus"]) {
  if (status === "online") return "云端已连接";
  if (status === "connecting") return "云端连接中";
  if (status === "error") return "云端异常";
  return "云端未登录";
}
