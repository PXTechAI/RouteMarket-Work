import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe2,
  LoaderCircle,
  LogIn,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Workflow
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActivityItem,
  ProjectFileEntry,
  ProjectFileTree,
  ProjectSummary,
  ReadResult,
  RouteMarketWorkApi,
  WorkState
} from "../../shared/desktop-api";

const previewState: WorkState = {
  workerStatus: "online",
  cloudStatus: "online",
  runtimeId: "runtime_preview",
  cloudError: null,
  authStatus: "signed_in",
  account: {
    id: "account_preview",
    displayName: "PX Labs",
    email: "hello@routemarket.ai"
  },
  authError: null,
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

const previewApi: RouteMarketWorkApi = {
  async getState() {
    return previewState;
  },
  async signIn() {
    return previewState;
  },
  async signOut() {
    return {
      ...previewState,
      cloudStatus: "disabled",
      runtimeId: null,
      authStatus: "signed_out",
      account: undefined
    };
  },
  async chooseProject() {
    return null;
  },
  async listProjectFiles() {
    return {
      entries: [
        {
          name: "src",
          relativePath: "src",
          kind: "directory",
          children: [
            {
              name: "App.tsx",
              relativePath: "src/App.tsx",
              kind: "file"
            }
          ]
        },
        {
          name: "README.md",
          relativePath: "README.md",
          kind: "file"
        }
      ],
      totalEntries: 3,
      truncated: false
    };
  },
  async readProjectFile(localProjectId, relativePath) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
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
    cloudStatus: "disabled",
    runtimeId: null,
    cloudError: null,
    authStatus: "signed_out",
    authError: null,
    projects: [],
    activities: []
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFileTree | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [authAction, setAuthAction] = useState<"sign-in" | "sign-out" | null>(null);
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
    const timer = window.setInterval(() => {
      void refreshState();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshState]);

  useEffect(() => {
    let active = true;
    setProjectFiles(null);
    setSelectedFilePath(null);
    setReadResult(null);
    if (!selectedProjectId) {
      setTreeLoading(false);
      return () => {
        active = false;
      };
    }

    setTreeLoading(true);
    void api.listProjectFiles(selectedProjectId)
      .then((tree) => {
        if (active) setProjectFiles(tree);
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "项目文件加载失败");
        }
      })
      .finally(() => {
        if (active) setTreeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedProjectId]);

  async function signIn() {
    setAuthAction("sign-in");
    setError(null);
    try {
      setState(await api.signIn());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法打开 RouteMarket 登录");
    } finally {
      setAuthAction(null);
    }
  }

  async function signOut() {
    setAuthAction("sign-out");
    setError(null);
    try {
      setState(await api.signOut());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "退出登录失败");
    } finally {
      setAuthAction(null);
    }
  }

  async function chooseProject() {
    setError(null);
    const project = await api.chooseProject();
    if (!project) return;
    await refreshState();
    setSelectedProjectId(project.localProjectId);
    setReadResult(null);
  }

  async function refreshProjectFiles() {
    if (!selectedProject) return;
    setTreeLoading(true);
    setError(null);
    try {
      setProjectFiles(await api.listProjectFiles(selectedProject.localProjectId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目文件加载失败");
    } finally {
      setTreeLoading(false);
    }
  }

  async function readProjectFile(relativePath: string) {
    if (!selectedProject) return;
    setSelectedFilePath(relativePath);
    setLoading(true);
    setError(null);
    try {
      setReadResult(
        await api.readProjectFile(selectedProject.localProjectId, relativePath)
      );
      await refreshState();
    } catch (nextError) {
      setReadResult(null);
      setError(nextError instanceof Error ? nextError.message : "项目文件读取失败");
      await refreshState();
    } finally {
      setLoading(false);
    }
  }

  const accountInitials = getInitials(state.account?.displayName);

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
        <button className="avatar" title="账户" type="button">{accountInitials}</button>
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

        <AccountPanel
          state={state}
          busy={authAction !== null}
          onSignIn={() => void signIn()}
          onSignOut={() => void signOut()}
        />

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
          <button
            className="icon-button compact"
            type="button"
            title="刷新"
            onClick={() => void refreshState()}
          >
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
              <span>{selectedFilePath ?? "本地项目"}</span>
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
              disabled={!selectedProject || treeLoading}
              onClick={() => void refreshProjectFiles()}
            >
              {treeLoading
                ? <LoaderCircle className="spin" size={16} />
                : <RefreshCw size={16} />}
              刷新文件
            </button>
          </div>
        </header>

        <div className="workspace-tabs" role="tablist">
          <button className="tab active" type="button"><FileText size={15} />文件</button>
          <button className="tab" type="button"><Activity size={15} />运行</button>
          <button className="tab" type="button"><GitBranch size={15} />更改</button>
        </div>

        <div className="workspace-body">
          <aside className="file-pane">
            <div className="file-pane-heading">
              <span>项目文件</span>
              <button
                className="icon-button compact"
                type="button"
                title="刷新文件列表"
                disabled={!selectedProject || treeLoading}
                onClick={() => void refreshProjectFiles()}
              >
                {treeLoading
                  ? <LoaderCircle className="spin" size={14} />
                  : <RefreshCw size={14} />}
              </button>
            </div>
            <div className="file-tree">
              {projectFiles && projectFiles.entries.length > 0 && (
                <FileTree
                  entries={projectFiles.entries}
                  selectedPath={selectedFilePath}
                  onSelect={(relativePath) => void readProjectFile(relativePath)}
                />
              )}
              {selectedProject && treeLoading && !projectFiles && (
                <div className="file-tree-state">
                  <LoaderCircle className="spin" size={18} />
                </div>
              )}
              {selectedProject && !treeLoading && projectFiles?.entries.length === 0 && (
                <div className="file-tree-state">
                  <Folder size={18} />
                  <span>空项目</span>
                </div>
              )}
              {!selectedProject && (
                <div className="file-tree-state">
                  <Folder size={18} />
                  <span>未选择项目</span>
                </div>
              )}
            </div>
            {projectFiles && (
              <div className="file-pane-footer">
                <span>{projectFiles.totalEntries} 项</span>
                {projectFiles.truncated && <span>已截断</span>}
              </div>
            )}
          </aside>

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
                <h2>{selectedFilePath ?? "选择项目文件"}</h2>
              </div>
            )}

            {loading && (
              <div className="ready-state">
                <LoaderCircle className="spin" size={30} />
                <h2>正在读取 {selectedFilePath}</h2>
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

function AccountPanel({
  state,
  busy,
  onSignIn,
  onSignOut
}: {
  state: WorkState;
  busy: boolean;
  onSignIn(): void;
  onSignOut(): void;
}) {
  if (state.authStatus === "signed_in" && state.account) {
    return (
      <div className="account-panel">
        <div className="account-copy">
          <strong>{state.account.displayName}</strong>
          <span>{state.account.email ?? "RouteMarket account"}</span>
        </div>
        <button
          className="icon-button compact"
          type="button"
          title="退出登录"
          disabled={busy}
          onClick={onSignOut}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
        </button>
      </div>
    );
  }

  return (
    <div className="account-panel signed-out">
      <div className="account-copy">
        <strong>
          {state.authStatus === "authorizing" ? "等待浏览器授权" : "RouteMarket 账户"}
        </strong>
        <span>
          {state.authError ?? (
            state.authStatus === "authorizing" ? "完成后将自动连接云端" : "登录后连接 Work API"
          )}
        </span>
      </div>
      <button
        className="account-action"
        type="button"
        title={state.authStatus === "authorizing" ? "重新打开登录" : "登录"}
        disabled={busy}
        onClick={onSignIn}
      >
        {busy
          ? <LoaderCircle className="spin" size={15} />
          : <LogIn size={15} />}
      </button>
    </div>
  );
}

function cloudStatusLabel(status: WorkState["cloudStatus"]) {
  if (status === "online") return "云端已连接";
  if (status === "connecting") return "云端连接中";
  if (status === "error") return "云端异常";
  return "云端未登录";
}

function getInitials(displayName?: string) {
  if (!displayName) return "PX";
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "PX";
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

function FileTree({
  entries,
  selectedPath,
  onSelect
}: {
  entries: ProjectFileEntry[];
  selectedPath: string | null;
  onSelect(relativePath: string): void;
}) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeRow
          key={entry.relativePath}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function FileTreeRow({
  entry,
  depth,
  selectedPath,
  onSelect
}: {
  entry: ProjectFileEntry;
  depth: number;
  selectedPath: string | null;
  onSelect(relativePath: string): void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDirectory = entry.kind === "directory";
  return (
    <div className="file-tree-node">
      <button
        className={`file-tree-row ${selectedPath === entry.relativePath ? "active" : ""}`}
        type="button"
        title={entry.relativePath}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (isDirectory) setExpanded((current) => !current);
          else onSelect(entry.relativePath);
        }}
      >
        <span className="tree-disclosure">
          {isDirectory && (
            <ChevronRight className={expanded ? "expanded" : ""} size={13} />
          )}
        </span>
        {isDirectory
          ? expanded
            ? <FolderOpen size={15} />
            : <Folder size={15} />
          : <File size={14} />}
        <span>{entry.name}</span>
      </button>
      {isDirectory && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeRow
              key={child.relativePath}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const succeeded = item.kind === "job.succeeded" || item.kind === "project.bound";
  const failed = item.kind === "job.failed" || item.kind === "cloud.error";
  return (
    <div className="activity-row">
      <span className={`activity-icon ${succeeded ? "success" : failed ? "failed" : "running"}`}>
        {succeeded
          ? <Check size={13} />
          : failed
            ? <CircleAlert size={13} />
            : <LoaderCircle size={13} />}
      </span>
      <div>
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </div>
      <time>
        {new Date(item.occurredAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit"
        })}
      </time>
    </div>
  );
}
