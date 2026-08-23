import { tr } from "../../i18n";
import "./project-sidebar.scss";
import { FolderOpen, FolderPlus, RefreshCw, Search } from "lucide-react";
import type { WorkState } from "../../../../shared/desktop-api";
import { cloudStatusLabel, workerStatusLabel } from "../../app/connection-status";
export function ProjectSidebar({ state, selectedProjectId, onChooseProject, onSelectProject, onRefreshState }: {
    state: WorkState;
    selectedProjectId: string | null;
    onChooseProject(): void;
    onSelectProject(projectId: string): void;
    onRefreshState(): void;
}) {
    return (<aside className="rm-project-sidebar">
      <button className="rm-project-search" type="button">
        <Search size={15}/>
        <span>{tr("ui.b617f05c84e4")}</span>
        <kbd>Ctrl K</kbd>
      </button>

      <section className="rm-sidebar-section rm-projects-section">
        <div className="rm-sidebar-heading">
          <span>{tr("ui.22336e6b892f")}</span>
          <button className="rm-icon-button" type="button" title={tr("ui.3120403417db")} onClick={onChooseProject}>
            <FolderPlus size={15}/>
          </button>
        </div>
        <div className="rm-project-list">
          {state.projects.map((project) => (<button className={`rm-project-button ${project.localProjectId === selectedProjectId ? "active" : ""}`} key={project.localProjectId} type="button" onClick={() => onSelectProject(project.localProjectId)}>
              <FolderOpen size={16}/>
              <span>{project.displayName}</span>
            </button>))}
          {state.projects.length === 0 && (<button className="rm-empty-project" type="button" onClick={onChooseProject}>
              <FolderPlus size={20}/>
              <span>{tr("ui.6bfe789c314e")}</span>
            </button>)}
        </div>
      </section>

      <div className="rm-worker-status">
        <span className={`rm-status-dot ${state.workerStatus}`}/>
        <div>
          <strong>Local Worker</strong>
          <span>
            {workerStatusLabel(state.workerStatus)}
            {" · "}
            {cloudStatusLabel(state.cloudStatus)}
          </span>
          {state.cloudError && (<span className="rm-cloud-error" title={state.cloudError}>
              {state.cloudError}
            </span>)}
        </div>
        <button className="rm-icon-button" type="button" title={tr("ui.7cc7f07a2c03")} onClick={onRefreshState}>
          <RefreshCw size={14}/>
        </button>
      </div>
    </aside>);
}
