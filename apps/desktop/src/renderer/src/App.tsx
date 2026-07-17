import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Globe2,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Workflow
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActivityItem,
  ProjectSummary,
  ReadResult,
  RouteMarketWorkApi,
  WorkState
} from "../../shared/desktop-api";

const previewApi: RouteMarketWorkApi = {
  async getState() {
    return {
      workerStatus: "online",
      cloudStatus: "online",
      runtimeId: "runtime_preview",
      cloudError: null,
      projects: [
        {
          localProjectId: "project_preview",
          displayName: "RouteMarket-Desktop",
          rootFingerprint: "sha256:preview",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      activities: []
    };
  },
  async chooseProject() {
    return null;
  },
  async readReadme(localProjectId) {
    return {
      uri: `project://${localProjectId}/README.md`,
      text: "# RouteMarket Work\n\nLocal-first AI workspace for projects, workflows, agents and browser tasks.\n",
      bytesRead: 96,
      truncated: false,
      encoding: "utf8"
    };
  }
};

const api = window.routeMarketWork ?? previewApi;

export function App() {
  const [state, setState] = useState<WorkState>({
    workerStatus: "starting",
    cloudStatus: "connecting",
    runtimeId: null,
    cloudError: null,
    projects: [],
    activities: []
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => state.projects.find((project) => project.localProjectId === selectedProjectId) ?? null,
    [selectedProjectId, state.projects]
  );

  const refreshState = useCallback(async () => {
    const nextState = await api.getState();
    setState(nextState);
    setSelectedProjectId((current) =>
      current && nextState.projects.some((project) => project.localProjectId === current)
        ? current
        : nextState.projects[0]?.localProjectId ?? null
    );
  }, []);

  useEffect(() => {
    void refreshState().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "无法连接 RouteMarket Worker");
    });
  }, [refreshState]);

  async function chooseProject() {
    setError(null);
    const project = await api.chooseProject();
    if (!project) return;
    await refreshState();
    setSelectedProjectId(project.localProjectId);
    setReadResult(null);
  }

  async function readReadme() {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    try {
      setReadResult(await api.readReadme(selectedProject.localProjectId));
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "README 读取失败");
      await refreshState();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <nav className="rail" aria-label="主导航">
        <div className="brand-mark" title="RouteMarket Work">R</div>
        <div className="rail-group">
          <IconButton label="项目" active><Folder size={19} /></IconButton>
          <IconButton label="对话"><Sparkles size={19} /></IconButton>
          <IconButton label="工作流"><Workflow size={19} /></IconButton>
          <IconButton label="Agent"><Bot size={19} /></IconButton>
          <IconButton label="浏览器"><Globe2 size={19} /></IconButton>
        </div>
        <div className="rail-spacer" />
        <IconButton label="设置"><Settings2 size={19} /></IconButton>
        <button className="avatar" title="账户" type="button">PX</button>
      </nav>

      <aside className="project-sidebar">
        <div className="sidebar-header">
          <div>
            <span className="product-name">RouteMarket</span>
            <strong>Work</strong>
          </div>
          <button className="icon-button" type="button" title="更多">
            <MoreHorizontal size={18} />
          </button>
        </div>

        <button className="search-box" type="button">
          <Search size={16} />
          <span>搜索项目</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="sidebar-section-heading">
          <span>项目</span>
          <button
            className="icon-button compact"
            type="button"
            title="打开文件夹"
            onClick={() => void chooseProject()}
          >
            <FolderPlus size={16} />
          </button>
        </div>

        <div className="project-list">
          {state.projects.map((project) => (
            <ProjectButton
              key={project.localProjectId}
              project={project}
              active={project.localProjectId === selectedProjectId}
              onClick={() => {
                setSelectedProjectId(project.localProjectId);
                setReadResult(null);
                setError(null);
              }}
            />
          ))}
          {state.projects.length === 0 && (
            <button className="empty-project" type="button" onClick={() => void chooseProject()}>
              <FolderPlus size={22} />
              <span>打开本地文件夹</span>
            </button>
          )}
        </div>

        <div className="worker-status">
          <span className={`status-dot ${state.workerStatus}`} />
          <div>
            <strong>Local Worker</strong>
            <span>
              {state.workerStatus === "online" ? "本地已连接" : "正在启动"}
              {" · "}
              {cloudStatusLabel(state.cloudStatus)}
            </span>
          </div>
          <button className="icon-button compact" type="button" title="刷新" onClick={() => void refreshState()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="project-heading">
            <div className="project-icon"><Folder size={18} /></div>
            <div>
              <h1>{selectedProject?.displayName ?? "选择项目"}</h1>
              <span>本地项目</span>
            </div>
            {selectedProject && (
              <button className="icon-button compact" type="button" title="切换项目">
                <ChevronDown size={15} />
              </button>
            )}
          </div>
          <div className="header-actions">
            <span className="capability-badge"><Check size={14} /> local.fs.read</span>
            <button
              className="primary-button"
              type="button"
              disabled={!selectedProject || loading}
              onClick={() => void readReadme()}
            >
              {loading ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              读取 README
            </button>
          </div>
        </header>

        <div className="workspace-tabs" role="tablist">
          <button className="tab active" type="button"><FileText size={15} />README</button>
          <button className="tab" type="button"><Activity size={15} />运行</button>
          <button className="tab" type="button"><GitBranch size={15} />更改</button>
        </div>

        <div className="workspace-body">
          <section className="document-pane">
            {!selectedProject && (
              <div className="blank-state">
                <div className="blank-icon"><FolderPlus size={28} /></div>
                <h2>打开一个本地项目</h2>
                <button className="primary-button" type="button" onClick={() => void chooseProject()}>
                  <FolderPlus size={16} />
                  选择文件夹
                </button>
              </div>
            )}

            {selectedProject && !readResult && !loading && (
              <div className="ready-state">
                <FileText size={30} />
                <h2>README.md</h2>
                <button className="primary-button" type="button" onClick={() => void readReadme()}>
                  <Play size={16} />
                  读取文件
                </button>
              </div>
            )}

            {loading && (
              <div className="ready-state">
                <LoaderCircle className="spin" size={30} />
                <h2>正在读取 README.md</h2>
              </div>
            )}

            {readResult && (
              <article className="readme-view">
                <div className="file-meta">
                  <span>{readResult.uri}</span>
                  <span>{readResult.bytesRead} bytes</span>
                </div>
                <pre>{readResult.text}</pre>
              </article>
            )}

            {error && (
              <div className="error-banner" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
              </div>
            )}
          </section>

          <aside className="activity-pane">
            <div className="pane-heading">
              <div>
                <span className="eyebrow">本机执行</span>
                <h2>活动</h2>
              </div>
              <span className="activity-count">{state.activities.length}</span>
            </div>
            <div className="activity-list">
              {state.activities.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
              {state.activities.length === 0 && (
                <div className="empty-activity">
                  <Activity size={22} />
                  <span>暂无运行记录</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function cloudStatusLabel(status: WorkState["cloudStatus"]) {
  if (status === "online") return "云端已连接";
  if (status === "connecting") return "云端连接中";
  if (status === "error") return "云端异常";
  return "云端未登录";
}

function IconButton({
  label,
  active = false,
  children
}: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rail-button ${active ? "active" : ""}`}
      type="button"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function ProjectButton({
  project,
  active,
  onClick
}: {
  project: ProjectSummary;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      className={`project-button ${active ? "active" : ""}`}
      type="button"
      onClick={onClick}
    >
      <Folder size={17} />
      <span>{project.displayName}</span>
    </button>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const succeeded = item.kind === "job.succeeded" || item.kind === "project.bound";
  const failed = item.kind === "job.failed";
  return (
    <div className="activity-row">
      <span className={`activity-icon ${succeeded ? "success" : failed ? "failed" : "running"}`}>
        {succeeded ? <Check size={13} /> : failed ? <CircleAlert size={13} /> : <LoaderCircle size={13} />}
      </span>
      <div>
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </div>
      <time>{new Date(item.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  );
}
