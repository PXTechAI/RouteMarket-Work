import {
  ChevronDown,
  CircleAlert,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Play,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AttachedBrowserState,
  AttachedBrowserTarget,
  ChatModel,
  DesktopWorkflowDraft,
  DesktopWorkflowDraftSummary,
  DesktopWorkflowNodeRegistry,
  DesktopWorkflowRun,
  DesktopWorkflowRunEvent,
  ManagedProcessSummary,
  ManagedBrowserState,
  LocalTriggerSummary,
  LocalTriggerKind,
  McpServerSummary,
  NativeAppConnectorSummary,
  ProjectChatEvent,
  ProjectChatRequest,
  ProjectContext,
  ProjectAssetPreview,
  ProjectFileVersion,
  ProjectFileVersionSummary,
  ProjectFileTree,
  ProjectSearchResult,
  ProjectSummary,
  ReadResult,
  RouteMarketWorkApi,
  WorkState
} from "../../shared/desktop-api";
import { createDiffPreview } from "./diff";
import { parseCommandLine } from "./command-line";
import { AppRail } from "./app/AppRail";
import { AuthGate } from "./app/AuthGate";
import { GlobalHeader } from "./app/GlobalHeader";
import { AgentPage } from "./features/agent/AgentPage";
import { useAgentWorkspace } from "./features/agent/useAgentWorkspace";
import { ApprovalPage } from "./features/approvals/ApprovalPage";
import { BrowserPage } from "./features/browser/BrowserPage";
import { ChatPage } from "./features/chat/ChatPage";
import { resolveConversationAgentVersion } from "./features/chat/agent-version";
import { messagesBeforeEditedUser } from "./features/chat/chat-edit";
import type { ChatMessage } from "./features/chat/types";
import { FilesPage } from "./features/files/FilesPage";
import { ProjectCreateDialog } from "./features/projects/ProjectCreateDialog";
import {
  projectFolderAvailable,
  projectFolderMessage,
  projectFolderStatus
} from "./features/projects/project-folder-status";
import { WorkflowPage } from "./features/workflow/WorkflowPage";
import type { WorkflowPanel } from "./features/workflow/types";

type WorkspaceView = "chat" | "files" | "changes" | "versions" | "terminal" | "approvals" | "browser" | "mcp" | "workflow" | "agent";

const previewState: WorkState = {
  workerStatus: "online",
  cloudStatus: "online",
  runtimeId: "runtime_preview",
  cloudError: null,
  authStatus: "signed_in",
  account: {
    id: "account_preview",
    displayName: "PX Labs",
    email: "hello@routemarket.ai",
    membership: {
      planCode: "pro",
      planName: "RouteMarket Pro",
      status: "active",
      expiresAt: "2027-07-18T00:00:00.000Z"
    }
  },
  authError: null,
  projects: [
    {
      localProjectId: "project_preview",
      displayName: "RouteMarket-Desktop",
      hasFolder: true,
      rootFingerprint: "sha256:preview",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  activities: [],
  approvals: [],
  approvalPolicies: [
    {
      policyId: "policy_preview_allow",
      capability: "local.fs.write",
      projectId: "project_preview",
      effect: "allow",
      createdAt: "2026-07-18T08:00:00.000Z",
      updatedAt: "2026-07-18T08:00:00.000Z"
    },
    {
      policyId: "policy_preview_deny",
      capability: "local.process.start",
      projectId: "project_preview",
      effect: "deny",
      createdAt: "2026-07-18T08:05:00.000Z",
      updatedAt: "2026-07-18T08:05:00.000Z"
    }
  ]
};

const previewModels: ChatModel[] = [
  {
    code: "gpt-5",
    displayName: "GPT-5",
    category: "reasoning",
    supportsTools: true,
    supportsVision: true,
    supportsStream: true
  },
  {
    code: "claude-sonnet",
    displayName: "Claude Sonnet",
    category: "chat",
    supportsTools: true,
    supportsVision: true,
    supportsStream: true
  }
];

const previewAgents = [
  {
    id: "agent_project_builder",
    revision: 1,
    name: "Project Builder",
    description: "读取项目、调用本地能力并持续完成开发任务。",
    avatarUrl: "emoji:🛠️|bg:#4f46e5",
    systemPrompt: "Work through the project task carefully and verify every concrete change.",
    greeting: "今天要在这个项目里完成什么？",
    starterQuestions: [
      "检查当前项目并告诉我下一步应该做什么",
      "运行测试并修复发现的问题",
      "梳理这个项目的架构"
    ],
    tags: ["project", "development"],
    defaultModelCode: "gpt-5",
    skills: [],
    toolPermissions: [],
    executionPolicy: { environment: "local" as const, approvalMode: "risky_only" as const },
    tools: [],
    updatedAt: "2026-07-18T00:00:00.000Z"
  },
  {
    id: "agent_browser_operator",
    revision: 1,
    name: "Browser Operator",
    description: "使用内置浏览器处理网页操作和信息采集。",
    avatarUrl: "emoji:🌐|bg:#0ea5e9",
    systemPrompt: "Use browser tools deliberately and report what was actually observed.",
    greeting: "告诉我需要在浏览器里完成的目标。",
    starterQuestions: ["打开网站并检查当前页面", "整理页面中的关键信息"],
    tags: ["browser"],
    defaultModelCode: "claude-sonnet",
    skills: [],
    toolPermissions: [{ type: "browser" }],
    executionPolicy: { environment: "local" as const, approvalMode: "risky_only" as const },
    tools: [{ type: "browser" }],
    updatedAt: "2026-07-18T00:00:00.000Z"
  }
];

let previewCurrentState = previewState;
const previewChatListeners = new Set<(event: ProjectChatEvent) => void>();
const previewWorkflowRunListeners = new Set<
  (event: DesktopWorkflowRunEvent) => void
>();
let previewProcesses: ManagedProcessSummary[] = [];
let previewBrowserState: ManagedBrowserState = {
  localProjectId: "project_preview",
  visible: false,
  activeProfileId: "profile_default",
  activePageId: "page_preview",
  url: "about:blank",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  userTakeover: true,
  crashed: false,
  downloads: [],
  operations: [{
    operationId: "browser_op_failed",
    localProjectId: "project_preview",
    pageId: "page_preview",
    source: "workflow",
    kind: "click",
    status: "failed",
    title: "点击网页元素",
    detail: "button[data-action=publish]",
    url: "https://example.com/editor",
    startedAt: "2026-07-18T08:12:30.000Z",
    finishedAt: "2026-07-18T08:12:31.000Z",
    error: "Browser element not found",
    retryable: true,
    retryOfOperationId: null
  }, {
    operationId: "browser_op_agent",
    localProjectId: "project_preview",
    pageId: "page_preview",
    source: "agent",
    kind: "navigate",
    status: "succeeded",
    title: "打开网页",
    detail: "https://example.com/editor",
    url: "https://example.com/editor",
    startedAt: "2026-07-18T08:12:20.000Z",
    finishedAt: "2026-07-18T08:12:22.000Z",
    error: null,
    retryable: true,
    retryOfOperationId: null
  }, {
    operationId: "browser_op_user",
    localProjectId: "project_preview",
    pageId: "page_preview",
    source: "user",
    kind: "screenshot",
    status: "succeeded",
    title: "截取网页画面",
    detail: "当前页面",
    url: "https://example.com/editor",
    startedAt: "2026-07-18T08:10:00.000Z",
    finishedAt: "2026-07-18T08:10:01.000Z",
    error: null,
    retryable: true,
    retryOfOperationId: null
  }],
  profiles: [{
    profileId: "profile_default",
    localProjectId: "project_preview",
    name: "Default",
    userAgent: "",
    proxyRules: "",
    proxyBypassRules: "<local>",
    persistence: "persistent"
  }],
  pages: [{
    pageId: "page_preview",
    profileId: "profile_default",
    localProjectId: "project_preview",
    title: "",
    url: "about:blank",
    loading: false,
    crashed: false
  }]
};
let previewAttachedBrowserState: AttachedBrowserState = {
  connected: false,
  endpoint: null,
  target: null,
  error: null
};
let previewMcpServers: McpServerSummary[] = [];
let previewLocalTriggers: LocalTriggerSummary[] = [];
let previewWorkflowDraft: DesktopWorkflowDraft | null = null;
let previewWorkflowRuns: DesktopWorkflowRun[] = [];

const previewApi: RouteMarketWorkApi = {
  async getState() {
    return previewCurrentState;
  },
  async clearActivities() {
    previewCurrentState = { ...previewCurrentState, activities: [] };
    return previewCurrentState;
  },
  async signIn() {
    previewCurrentState = previewState;
    return previewCurrentState;
  },
  async signOut() {
    previewCurrentState = {
      ...previewState,
      cloudStatus: "disabled",
      runtimeId: null,
      authStatus: "signed_out",
      account: undefined
    };
    return previewCurrentState;
  },
  async switchSpace(spaceId) {
    if (previewCurrentState.account) {
      previewCurrentState = {
        ...previewCurrentState,
        account: { ...previewCurrentState.account, activeSpaceId: spaceId }
      };
    }
    return previewCurrentState;
  },
  async removeApprovalPolicy(policyId) {
    const before = previewCurrentState.approvalPolicies.length;
    previewCurrentState = {
      ...previewCurrentState,
      approvalPolicies: previewCurrentState.approvalPolicies.filter(
        (policy) => policy.policyId !== policyId
      )
    };
    return previewCurrentState.approvalPolicies.length !== before;
  },
  async chooseProject() {
    return null;
  },
  async createProject(displayName) {
    const project: ProjectSummary = {
      localProjectId: `project_preview_${Date.now()}`,
      displayName,
      hasFolder: false,
      rootFingerprint: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    previewCurrentState = { ...previewCurrentState, projects: [project, ...previewCurrentState.projects] };
    return project;
  },
  async attachProjectFolder(localProjectId) {
    const project = previewCurrentState.projects.find((item) => item.localProjectId === localProjectId);
    if (!project) return null;
    const linked = { ...project, hasFolder: true, rootFingerprint: "sha256:preview" };
    previewCurrentState = {
      ...previewCurrentState,
      projects: previewCurrentState.projects.map((item) => item.localProjectId === localProjectId ? linked : item)
    };
    return linked;
  },
  async deleteProject(localProjectId) {
    previewCurrentState = {
      ...previewCurrentState,
      projects: previewCurrentState.projects.filter((item) => item.localProjectId !== localProjectId)
    };
    return true;
  },
  async getProjectContext() {
    return {
      instructions: {
        relativePath: "AGENTS.md",
        text: "Keep changes focused and run tests.",
        truncated: false
      },
      readme: null,
      settings: { defaultAgent: null, defaultModel: null, cloudProjectId: null, ignore: [] },
      skills: [{
        id: "review",
        name: "Code review",
        description: "Review project changes safely.",
        relativePath: ".routemarket/skills/review/SKILL.md"
      }]
    };
  },
  async getWorkflowNodeRegistry() {
    const definitions = [
      { executorKey: "local.fs.read", title: "读取文件", description: "读取项目内文本文件。", portability: "portable" as const },
      { executorKey: "local.browser.navigate", title: "浏览器导航", description: "在本机浏览器中打开网页。", portability: "device_bound" as const },
      { executorKey: "local.app.vscode.open", title: "Visual Studio Code", description: "在 VS Code 中打开当前项目。", portability: "requires_connector" as const }
    ].map((item) => ({
      ...item,
      definitionVersion: 1,
      source: item.executorKey.startsWith("local.app") ? "local_extension" as const : "desktop_builtin" as const,
      executionTarget: "desktop" as const,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [item.executorKey],
      definitionHash: `sha256:${"1".repeat(64)}`,
      available: true,
      blockedReason: null
    }));
    return { revisionHash: `sha256:${"0".repeat(64)}`, generatedAt: new Date().toISOString(), definitions };
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
  async searchProject(_localProjectId, query) {
    return {
      query,
      matches: query.trim()
        ? [{
            relativePath: "README.md",
            matchKind: "content" as const,
            line: 1,
            column: 3,
            preview: "# RouteMarket Work"
          }]
        : [],
      filesScanned: 2,
      truncated: false
    };
  },
  async readProjectFile(localProjectId, relativePath) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      text: "# RouteMarket Work\n\nLocal-first AI workspace for projects, workflows, agents and browser tasks.\n",
      bytesRead: 96,
      truncated: false,
      encoding: "utf8",
      sha256: `sha256:${"0".repeat(64)}`
    };
  },
  async readProjectAsset(localProjectId, relativePath) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      bytesRead: 8
    };
  },
  async writeProjectFile(localProjectId, relativePath, text, expectedSha256) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      text,
      bytesRead: new TextEncoder().encode(text).byteLength,
      truncated: false,
      encoding: "utf8",
      sha256: expectedSha256,
      changed: true,
      previousSha256: expectedSha256
    };
  },
  async createProjectFile(localProjectId, relativePath, text) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      text,
      bytesRead: new TextEncoder().encode(text).byteLength,
      truncated: false,
      encoding: "utf8",
      sha256: `sha256:${"1".repeat(64)}`,
      created: true as const
    };
  },
  async listProjectFileVersions(localProjectId, relativePath) {
    return [{
      versionId: "version_preview",
      localProjectId,
      relativePath,
      sha256: `sha256:${"2".repeat(64)}`,
      bytes: 74,
      source: "baseline" as const,
      createdAt: new Date(Date.now() - 3_600_000).toISOString()
    }];
  },
  async readProjectFileVersion(localProjectId, relativePath, versionId) {
    return {
      versionId,
      localProjectId,
      relativePath,
      sha256: `sha256:${"2".repeat(64)}`,
      bytes: 74,
      source: "baseline" as const,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      text: "# RouteMarket Work\n\nEarlier locally saved project file version.\n"
    };
  },
  async restoreProjectFileVersion(localProjectId, relativePath, _versionId) {
    return previewApi.writeProjectFile(localProjectId, relativePath, "# RouteMarket Work\n\nEarlier locally saved project file version.\n", `sha256:${"0".repeat(64)}`);
  },
  async exportProjectFile(_localProjectId, relativePath) { return { exportedPath: `C:/Exports/${relativePath.split("/").at(-1)}` }; },
  async startProcess(localProjectId, executable, args) {
    const process: ManagedProcessSummary = {
      processId: `process_${crypto.randomUUID().replaceAll("-", "")}`,
      localProjectId,
      executable,
      args,
      status: "running",
      pid: 12345,
      exitCode: null,
      signal: null,
      stdout: `> ${[executable, ...args].join(" ")}\nPreview process started.\n`,
      stderr: "",
      outputTruncated: false,
      startedAt: new Date().toISOString(),
      finishedAt: null
    };
    previewProcesses = [process, ...previewProcesses];
    return process;
  },
  async listProcesses() {
    return previewProcesses;
  },
  async stopProcess(processId) {
    const process = previewProcesses.find((item) => item.processId === processId);
    if (!process) throw new Error("Process not found");
    process.status = "stopped";
    process.finishedAt = new Date().toISOString();
    return process;
  },
  async getBrowserState(localProjectId) {
    previewBrowserState = { ...previewBrowserState, localProjectId };
    return previewBrowserState;
  },
  async showBrowser(localProjectId) {
    previewBrowserState = { ...previewBrowserState, localProjectId, visible: true };
    return previewBrowserState;
  },
  async hideBrowser() {
    previewBrowserState = { ...previewBrowserState, visible: false };
  },
  async setBrowserBounds() {},
  async createBrowserPage(localProjectId, profileId) {
    const pageId = `page_${crypto.randomUUID().replaceAll("-", "")}`;
    const nextProfileId = profileId ?? previewBrowserState.activeProfileId;
    previewBrowserState = {
      ...previewBrowserState,
      localProjectId,
      activeProfileId: nextProfileId,
      activePageId: pageId,
      url: "about:blank",
      title: "",
      pages: [...previewBrowserState.pages, {
        pageId,
        profileId: nextProfileId,
        localProjectId,
        title: "",
        url: "about:blank",
        loading: false,
        crashed: false
      }]
    };
    return previewBrowserState;
  },
  async selectBrowserPage(_localProjectId, pageId) {
    const page = previewBrowserState.pages.find((item) => item.pageId === pageId);
    if (!page) throw new Error("Browser page not found");
    previewBrowserState = {
      ...previewBrowserState,
      activePageId: pageId,
      activeProfileId: page.profileId,
      url: page.url,
      title: page.title
    };
    return previewBrowserState;
  },
  async closeBrowserPage(localProjectId, pageId) {
    const pages = previewBrowserState.pages.filter((page) => page.pageId !== pageId);
    previewBrowserState = { ...previewBrowserState, pages };
    if (!pages.length) return previewApi.createBrowserPage(localProjectId);
    return previewApi.selectBrowserPage(localProjectId, pages[0].pageId);
  },
  async createBrowserProfile(localProjectId, input) {
    const profileId = `profile_${crypto.randomUUID().replaceAll("-", "")}`;
    previewBrowserState = {
      ...previewBrowserState,
      profiles: [...previewBrowserState.profiles, { profileId, localProjectId, ...input }]
    };
    return previewApi.createBrowserPage(localProjectId, profileId);
  },
  async updateBrowserProfile(_localProjectId, profileId, input) {
    previewBrowserState = {
      ...previewBrowserState,
      profiles: previewBrowserState.profiles.map((profile) =>
        profile.profileId === profileId ? { ...profile, ...input } : profile
      )
    };
    return previewBrowserState;
  },
  async deleteBrowserProfile(localProjectId, profileId) {
    previewBrowserState = {
      ...previewBrowserState,
      profiles: previewBrowserState.profiles.filter((profile) => profile.profileId !== profileId),
      pages: previewBrowserState.pages.filter((page) => page.profileId !== profileId)
    };
    const next = previewBrowserState.pages[0];
    return next
      ? previewApi.selectBrowserPage(localProjectId, next.pageId)
      : previewApi.createBrowserPage(localProjectId, previewBrowserState.profiles[0]?.profileId);
  },
  async navigateBrowser(_localProjectId, url) {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    previewBrowserState = {
      ...previewBrowserState,
      url: normalizedUrl,
      title: "Preview page",
      pages: previewBrowserState.pages.map((page) =>
        page.pageId === previewBrowserState.activePageId
          ? { ...page, url: normalizedUrl, title: "Preview page" }
          : page
      )
    };
    return previewBrowserState;
  },
  async browserBack() { return previewBrowserState; },
  async browserForward() { return previewBrowserState; },
  async reloadBrowser() { return previewBrowserState; },
  async setBrowserTakeover(_localProjectId, userTakeover) {
    previewBrowserState = { ...previewBrowserState, userTakeover };
    return previewBrowserState;
  },
  async clickBrowser() {},
  async typeBrowser() {},
  async uploadBrowser(_localProjectId, _selector, relativePaths) {
    return {
      completed: true as const,
      pageId: previewBrowserState.activePageId,
      url: previewBrowserState.url,
      relativePaths
    };
  },
  async extractBrowser() { return "Preview extracted text"; },
  async screenshotBrowser() { return "data:image/png;base64,"; },
  async retryBrowserOperation(localProjectId, operationId) {
    const previous = previewBrowserState.operations.find(
      (operation) => operation.operationId === operationId
    );
    if (!previous || previous.status !== "failed") {
      throw new Error("Managed Browser operation is not available for retry.");
    }
    const now = new Date().toISOString();
    previewBrowserState = {
      ...previewBrowserState,
      operations: [{
        ...previous,
        operationId: `browser_op_${crypto.randomUUID().replaceAll("-", "")}`,
        localProjectId,
        source: "user",
        status: "succeeded",
        title: `重试：${previous.title}`,
        startedAt: now,
        finishedAt: now,
        error: null,
        retryOfOperationId: previous.operationId
      }, ...previewBrowserState.operations]
    };
    return previewBrowserState;
  },
  async discoverAttachedBrowser(endpoint) {
    return [{ targetId: "preview-page", title: "Preview page", url: "https://example.com", type: "page" }];
  },
  async connectAttachedBrowser(endpoint, targetId) {
    previewAttachedBrowserState = {
      connected: true,
      endpoint,
      target: { targetId: targetId ?? "preview-page", title: "Preview page", url: "https://example.com", type: "page" },
      error: null
    };
    return previewAttachedBrowserState;
  },
  async disconnectAttachedBrowser() {
    previewAttachedBrowserState = { connected: false, endpoint: null, target: null, error: null };
    return previewAttachedBrowserState;
  },
  async navigateAttachedBrowser(url) {
    if (!previewAttachedBrowserState.target) throw new Error("Attached Browser 未连接");
    previewAttachedBrowserState = {
      ...previewAttachedBrowserState,
      target: { ...previewAttachedBrowserState.target, url: url.startsWith("http") ? url : `https://${url}` }
    };
    return previewAttachedBrowserState;
  },
  async clickAttachedBrowser() {},
  async typeAttachedBrowser() {},
  async extractAttachedBrowser() { return "Preview extracted text"; },
  async screenshotAttachedBrowser() { return "data:image/png;base64,"; },
  async listLocalTriggers(localProjectId) { return previewLocalTriggers.filter((item) => item.localProjectId === localProjectId); },
  async saveLocalTrigger(input, triggerId) {
    const existing = triggerId ? previewLocalTriggers.find((item) => item.triggerId === triggerId) : null;
    const now = new Date().toISOString();
    const trigger: LocalTriggerSummary = {
      triggerId: triggerId ?? `trigger_${crypto.randomUUID().replaceAll("-", "")}`,
      localProjectId: input.localProjectId,
      name: input.name,
      kind: input.kind,
      enabled: input.enabled,
      relativePath: input.relativePath ?? null,
      intervalMinutes: input.intervalMinutes ?? null,
      accelerator: input.accelerator ?? null,
      status: input.enabled ? "active" : "inactive",
      lastError: null,
      lastFiredAt: existing?.lastFiredAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    previewLocalTriggers = [trigger, ...previewLocalTriggers.filter((item) => item.triggerId !== trigger.triggerId)];
    return trigger;
  },
  async removeLocalTrigger(triggerId) { previewLocalTriggers = previewLocalTriggers.filter((item) => item.triggerId !== triggerId); },
  async fireLocalTrigger(triggerId) {
    const trigger = previewLocalTriggers.find((item) => item.triggerId === triggerId);
    if (!trigger) throw new Error("Local trigger not found");
    trigger.lastFiredAt = new Date().toISOString();
    return trigger;
  },
  async listNativeAppConnectors() {
    return [
      { connectorId: "vscode" as const, name: "Visual Studio Code", description: "打开当前项目或文件。", available: true, executablePath: "C:/Preview/Code.exe", supportedExtensions: [] },
      { connectorId: "excel" as const, name: "Microsoft Excel", description: "打开项目内工作簿。", available: false, executablePath: null, supportedExtensions: [".xlsx", ".xls", ".csv"] },
      { connectorId: "powerpoint" as const, name: "Microsoft PowerPoint", description: "打开项目内演示文稿。", available: false, executablePath: null, supportedExtensions: [".pptx", ".ppt"] }
    ];
  },
  async openNativeAppConnector(connectorId, _localProjectId, relativePath) { return { connectorId, openedPath: relativePath ?? ".", launchedAt: new Date().toISOString() }; },
  async listDesktopWorkflowDrafts(localProjectId) {
    return previewWorkflowDraft?.localProjectId === localProjectId ? [{
      workflowId: previewWorkflowDraft.workflowId,
      localProjectId,
      kind: previewWorkflowDraft.kind,
      name: previewWorkflowDraft.name,
      nodeCount: previewWorkflowDraft.nodes.length,
      edgeCount: previewWorkflowDraft.edges.length,
      createdAt: previewWorkflowDraft.createdAt,
      updatedAt: previewWorkflowDraft.updatedAt
    }] : [];
  },
  async getDesktopWorkflowDraft(localProjectId, workflowId) { return previewWorkflowDraft?.localProjectId === localProjectId && (!workflowId || previewWorkflowDraft.workflowId === workflowId) ? previewWorkflowDraft : null; },
  async saveDesktopWorkflowDraft(draft) { previewWorkflowDraft = { ...draft, updatedAt: new Date().toISOString() }; return previewWorkflowDraft; },
  async deleteDesktopWorkflowDraft(_localProjectId, workflowId) { if (previewWorkflowDraft?.workflowId === workflowId) previewWorkflowDraft = null; },
  async runDesktopWorkflow(localProjectId, workflowId, input = {}) {
    if (
      !previewWorkflowDraft ||
      previewWorkflowDraft.localProjectId !== localProjectId ||
      previewWorkflowDraft.workflowId !== workflowId
    ) {
      throw new Error("Workflow draft not found");
    }
    const now = new Date().toISOString();
    const run: DesktopWorkflowRun = {
      runId: `run_${crypto.randomUUID().replaceAll("-", "")}`,
      workflowId,
      workflowName: previewWorkflowDraft.name,
      localProjectId,
      status: "running",
      input,
      output: null,
      error: null,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      nodeRuns: previewWorkflowDraft.nodes.map((node) => ({
        nodeRunId: `node_run_${crypto.randomUUID().replaceAll("-", "")}`,
        nodeId: node.nodeId,
        executorKey: node.executorKey,
        title: node.title,
        status: "running",
        input,
        output: null,
        error: null,
        startedAt: now,
        finishedAt: null,
        attempt: 1
      }))
    };
    previewWorkflowRuns = [run, ...previewWorkflowRuns];
    window.setTimeout(() => {
      if (run.status !== "running") return;
      const finishedAt = new Date().toISOString();
      run.status = "succeeded";
      run.output = { preview: true, input };
      run.finishedAt = finishedAt;
      run.nodeRuns = run.nodeRuns.map((node) => ({
        ...node,
        status: "succeeded",
        output: { preview: true },
        finishedAt
      }));
      for (const listener of previewWorkflowRunListeners) {
        listener({ type: "updated", run: structuredClone(run) });
      }
    }, 700);
    return structuredClone(run);
  },
  async getDesktopWorkflowRun(runId) {
    const run = previewWorkflowRuns.find((item) => item.runId === runId);
    return run ? structuredClone(run) : null;
  },
  async listDesktopWorkflowRuns(localProjectId, workflowId) {
    return previewWorkflowRuns
      .filter(
        (run) =>
          run.localProjectId === localProjectId &&
          (!workflowId || run.workflowId === workflowId)
      )
      .map((run) => structuredClone(run));
  },
  async cancelDesktopWorkflowRun(runId) {
    const run = previewWorkflowRuns.find((item) => item.runId === runId);
    if (!run) throw new Error("Workflow run not found");
    const finishedAt = new Date().toISOString();
    run.status = "canceled";
    run.error = "Workflow run was canceled.";
    run.finishedAt = finishedAt;
    run.nodeRuns = run.nodeRuns.map((node) => ({
      ...node,
      status: node.status === "succeeded" ? node.status : "canceled",
      finishedAt
    }));
    return structuredClone(run);
  },
  async retryDesktopWorkflowRun(runId) {
    const run = previewWorkflowRuns.find((item) => item.runId === runId);
    if (!run) throw new Error("Workflow run not found");
    return previewApi.runDesktopWorkflow(
      run.localProjectId,
      run.workflowId,
      run.input
    );
  },
  onDesktopWorkflowRunEvent(listener) {
    previewWorkflowRunListeners.add(listener);
    return () => previewWorkflowRunListeners.delete(listener);
  },
  async installMcpServer(input) {
    const server: McpServerSummary = {
      serverId: `mcp_${crypto.randomUUID().replaceAll("-", "")}`,
      name: input.name,
      transport: input.transport,
      command: input.command ?? "",
      args: input.args,
      url: input.url ?? null,
      localProjectId: input.localProjectId,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "offline",
      tools: [],
      serverInfo: null,
      protocolVersion: null,
      stderr: "",
      lastError: null
    };
    previewMcpServers = [server, ...previewMcpServers];
    return server;
  },
  async listMcpServers() { return previewMcpServers; },
  async startMcpServer(serverId) {
    const server = previewMcpServers.find((item) => item.serverId === serverId);
    if (!server) throw new Error("MCP server not found");
    server.status = "online";
    server.protocolVersion = "2025-11-25";
    server.tools = [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }];
    return server;
  },
  async stopMcpServer(serverId) {
    const server = previewMcpServers.find((item) => item.serverId === serverId);
    if (!server) throw new Error("MCP server not found");
    server.status = "offline";
    return server;
  },
  async removeMcpServer(serverId) {
    previewMcpServers = previewMcpServers.filter((item) => item.serverId !== serverId);
  },
  async refreshMcpTools(serverId) {
    return previewApi.startMcpServer(serverId);
  },
  async callMcpTool(_serverId, name, args) {
    return { content: [{ type: "text", text: JSON.stringify({ name, args }) }], isError: false };
  },
  async listChatModels() {
    return previewModels;
  },
  async getLocalProjectChat() {
    return null;
  },
  async truncateLocalProjectChat() {
    return 0;
  },
  async listAgentProfiles() {
    return previewAgents;
  },
  async sendProjectMessage(input) {
    if (input.message.includes("模拟失败")) {
      window.setTimeout(() => {
        for (const listener of previewChatListeners) {
          listener({
            requestId: input.requestId,
            type: "error",
            message: "预览模式：模型服务暂时不可用。"
          });
        }
      }, 350);
      return;
    }
    const reply = input.contextFile
      ? [
          "## 分析完成",
          "",
          `我已经结合 \`${input.contextFile.relativePath}\` 的内容完成分析：`,
          "",
          "- 保留当前项目上下文",
          "- 按 Agent 的 Skill 与工具权限执行",
          "- 本机改动仍受本机审批策略保护"
        ].join("\n")
      : [
          "## 项目检查完成",
          "",
          "当前对话已经固定到所选 Agent 版本，并在 **本机环境** 中运行。",
          "",
          "- Agent 的 system prompt 已生效",
          "- Skills 与工具权限彼此独立",
          "- 对话记录仅保存在本机",
          "",
          "```text",
          "pnpm test",
          "✓ preview checks passed",
          "```"
        ].join("\n");
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "tool_started",
          toolCallId: "preview_project_read",
          toolName: "project_read_file",
          title: "读取项目文件"
        });
      }
    }, 120);
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "tool_completed",
          toolCallId: "preview_project_read",
          toolName: "project_read_file",
          title: "读取项目文件",
          summary: "已读取 AGENTS.md"
        });
      }
    }, 220);
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "delta",
          content: reply
        });
      }
    }, 250);
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "complete",
          content: reply
        });
      }
    }, 500);
  },
  async stopProjectMessage(requestId) {
    for (const listener of previewChatListeners) {
      listener({ requestId, type: "stopped", content: "" });
    }
  },
  onProjectChatEvent(listener) {
    previewChatListeners.add(listener);
    return () => previewChatListeners.delete(listener);
  }
};

function desktopBridgeUnavailable(): never {
  throw new Error("RouteMarket Work 桌面桥接加载失败，请重新启动或安装最新版本。");
}

const unavailableApi: RouteMarketWorkApi = {
  getState: async () => desktopBridgeUnavailable(),
  clearActivities: async () => desktopBridgeUnavailable(),
  signIn: async () => desktopBridgeUnavailable(),
  signOut: async () => desktopBridgeUnavailable(),
  switchSpace: async () => desktopBridgeUnavailable(),
  removeApprovalPolicy: async () => desktopBridgeUnavailable(),
  chooseProject: async () => desktopBridgeUnavailable(),
  createProject: async () => desktopBridgeUnavailable(),
  attachProjectFolder: async () => desktopBridgeUnavailable(),
  deleteProject: async () => desktopBridgeUnavailable(),
  getProjectContext: async () => desktopBridgeUnavailable(),
  getWorkflowNodeRegistry: async () => desktopBridgeUnavailable(),
  listProjectFiles: async () => desktopBridgeUnavailable(),
  searchProject: async () => desktopBridgeUnavailable(),
  readProjectFile: async () => desktopBridgeUnavailable(),
  readProjectAsset: async () => desktopBridgeUnavailable(),
  writeProjectFile: async () => desktopBridgeUnavailable(),
  createProjectFile: async () => desktopBridgeUnavailable(),
  listProjectFileVersions: async () => desktopBridgeUnavailable(),
  readProjectFileVersion: async () => desktopBridgeUnavailable(),
  restoreProjectFileVersion: async () => desktopBridgeUnavailable(),
  exportProjectFile: async () => desktopBridgeUnavailable(),
  startProcess: async () => desktopBridgeUnavailable(),
  listProcesses: async () => desktopBridgeUnavailable(),
  stopProcess: async () => desktopBridgeUnavailable(),
  getBrowserState: async () => desktopBridgeUnavailable(),
  showBrowser: async () => desktopBridgeUnavailable(),
  hideBrowser: async () => desktopBridgeUnavailable(),
  setBrowserBounds: async () => desktopBridgeUnavailable(),
  createBrowserPage: async () => desktopBridgeUnavailable(),
  selectBrowserPage: async () => desktopBridgeUnavailable(),
  closeBrowserPage: async () => desktopBridgeUnavailable(),
  createBrowserProfile: async () => desktopBridgeUnavailable(),
  updateBrowserProfile: async () => desktopBridgeUnavailable(),
  deleteBrowserProfile: async () => desktopBridgeUnavailable(),
  navigateBrowser: async () => desktopBridgeUnavailable(),
  browserBack: async () => desktopBridgeUnavailable(),
  browserForward: async () => desktopBridgeUnavailable(),
  reloadBrowser: async () => desktopBridgeUnavailable(),
  setBrowserTakeover: async () => desktopBridgeUnavailable(),
  clickBrowser: async () => desktopBridgeUnavailable(),
  typeBrowser: async () => desktopBridgeUnavailable(),
  uploadBrowser: async () => desktopBridgeUnavailable(),
  extractBrowser: async () => desktopBridgeUnavailable(),
  screenshotBrowser: async () => desktopBridgeUnavailable(),
  retryBrowserOperation: async () => desktopBridgeUnavailable(),
  discoverAttachedBrowser: async () => desktopBridgeUnavailable(),
  connectAttachedBrowser: async () => desktopBridgeUnavailable(),
  disconnectAttachedBrowser: async () => desktopBridgeUnavailable(),
  navigateAttachedBrowser: async () => desktopBridgeUnavailable(),
  clickAttachedBrowser: async () => desktopBridgeUnavailable(),
  typeAttachedBrowser: async () => desktopBridgeUnavailable(),
  extractAttachedBrowser: async () => desktopBridgeUnavailable(),
  screenshotAttachedBrowser: async () => desktopBridgeUnavailable(),
  listLocalTriggers: async () => desktopBridgeUnavailable(),
  saveLocalTrigger: async () => desktopBridgeUnavailable(),
  removeLocalTrigger: async () => desktopBridgeUnavailable(),
  fireLocalTrigger: async () => desktopBridgeUnavailable(),
  listNativeAppConnectors: async () => desktopBridgeUnavailable(),
  openNativeAppConnector: async () => desktopBridgeUnavailable(),
  getDesktopWorkflowDraft: async () => desktopBridgeUnavailable(),
  listDesktopWorkflowDrafts: async () => desktopBridgeUnavailable(),
  saveDesktopWorkflowDraft: async () => desktopBridgeUnavailable(),
  deleteDesktopWorkflowDraft: async () => desktopBridgeUnavailable(),
  runDesktopWorkflow: async () => desktopBridgeUnavailable(),
  getDesktopWorkflowRun: async () => desktopBridgeUnavailable(),
  listDesktopWorkflowRuns: async () => desktopBridgeUnavailable(),
  cancelDesktopWorkflowRun: async () => desktopBridgeUnavailable(),
  retryDesktopWorkflowRun: async () => desktopBridgeUnavailable(),
  onDesktopWorkflowRunEvent: () => () => undefined,
  installMcpServer: async () => desktopBridgeUnavailable(),
  listMcpServers: async () => desktopBridgeUnavailable(),
  startMcpServer: async () => desktopBridgeUnavailable(),
  stopMcpServer: async () => desktopBridgeUnavailable(),
  removeMcpServer: async () => desktopBridgeUnavailable(),
  refreshMcpTools: async () => desktopBridgeUnavailable(),
  callMcpTool: async () => desktopBridgeUnavailable(),
  listAgentProfiles: async () => desktopBridgeUnavailable(),
  listChatModels: async () => desktopBridgeUnavailable(),
  getLocalProjectChat: async () => desktopBridgeUnavailable(),
  truncateLocalProjectChat: async () => desktopBridgeUnavailable(),
  sendProjectMessage: async () => desktopBridgeUnavailable(),
  stopProjectMessage: async () => desktopBridgeUnavailable(),
  onProjectChatEvent: () => () => undefined
};

const api =
  window.routeMarketWork ?? (import.meta.env.DEV ? previewApi : unavailableApi);

export function App() {
  const [stateLoaded, setStateLoaded] = useState(false);
  const [state, setState] = useState<WorkState>({
    workerStatus: "starting",
    cloudStatus: "disabled",
    runtimeId: null,
    cloudError: null,
    authStatus: "signed_out",
    authError: null,
    projects: [],
    activities: [],
    approvals: [],
    approvalPolicies: []
  });
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileTree | null>(null);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [workflowRegistry, setWorkflowRegistry] = useState<DesktopWorkflowNodeRegistry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<ProjectSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [assetPreview, setAssetPreview] = useState<ProjectAssetPreview | null>(null);
  const [fileDraft, setFileDraft] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  const [newFileDraft, setNewFileDraft] = useState(false);
  const [fileVersions, setFileVersions] = useState<ProjectFileVersionSummary[]>([]);
  const [selectedFileVersion, setSelectedFileVersion] = useState<ProjectFileVersion | null>(null);
  const [fileVersionBusy, setFileVersionBusy] = useState(false);
  const [processes, setProcesses] = useState<ManagedProcessSummary[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [processCommand, setProcessCommand] = useState("");
  const [processBusy, setProcessBusy] = useState(false);
  const [browserState, setBrowserState] = useState<ManagedBrowserState | null>(null);
  const [browserMode, setBrowserMode] = useState<"managed" | "attached">("managed");
  const [browserAddress, setBrowserAddress] = useState("https://example.com");
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserScreenshot, setBrowserScreenshot] = useState<string | null>(null);
  const [attachedEndpoint, setAttachedEndpoint] = useState("http://127.0.0.1:9222");
  const [attachedTargets, setAttachedTargets] = useState<AttachedBrowserTarget[]>([]);
  const [selectedAttachedTargetId, setSelectedAttachedTargetId] = useState("");
  const [attachedState, setAttachedState] = useState<AttachedBrowserState>({
    connected: false,
    endpoint: null,
    target: null,
    error: null
  });
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null);
  const [selectedMcpToolName, setSelectedMcpToolName] = useState<string | null>(null);
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "streamable-http">("stdio");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpToolArgs, setMcpToolArgs] = useState("{}");
  const [mcpResult, setMcpResult] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [workflowPanel, setWorkflowPanel] = useState<WorkflowPanel>("canvas");
  const [localTriggers, setLocalTriggers] = useState<LocalTriggerSummary[]>([]);
  const [triggerName, setTriggerName] = useState("");
  const [triggerKind, setTriggerKind] = useState<LocalTriggerKind>("file_changed");
  const [triggerValue, setTriggerValue] = useState(".");
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [nativeConnectors, setNativeConnectors] = useState<NativeAppConnectorSummary[]>([]);
  const [connectorBusyId, setConnectorBusyId] = useState<string | null>(null);
  const [workflowDraft, setWorkflowDraft] = useState<DesktopWorkflowDraft | null>(null);
  const [workflowDrafts, setWorkflowDrafts] = useState<DesktopWorkflowDraftSummary[]>([]);
  const [workflowDraftDirty, setWorkflowDraftDirty] = useState(false);
  const [workflowDraftBusy, setWorkflowDraftBusy] = useState(false);
  const [workflowRuns, setWorkflowRuns] = useState<DesktopWorkflowRun[]>([]);
  const [workflowRunInput, setWorkflowRunInput] = useState("{}");
  const [workflowRunBusy, setWorkflowRunBusy] = useState(false);
  const [workflowAddExecutor, setWorkflowAddExecutor] = useState("");
  const [workflowEdgeSource, setWorkflowEdgeSource] = useState("");
  const [workflowEdgeTarget, setWorkflowEdgeTarget] = useState("");
  const [includeFileContext, setIncludeFileContext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [authAction, setAuthAction] = useState<"sign-in" | "sign-out" | "switch-space" | null>(null);
  const [busyApprovalPolicyId, setBusyApprovalPolicyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [selectedModelCode, setSelectedModelCode] = useState("");
  const [executionEnvironment, setExecutionEnvironment] = useState<"auto" | "local" | "cloud">("auto");
  const [selectedProjectSkillId, setSelectedProjectSkillId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [chatMessagesByProject, setChatMessagesByProject] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [adoptedAgentRevisions, setAdoptedAgentRevisions] = useState<
    Record<string, number>
  >({});
  const sessionIdsRef = useRef(new Map<string, string>());
  const activeRequestRef = useRef<{
    requestId: string;
    projectId: string;
  } | null>(null);
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserAddressRef = useRef<HTMLInputElement | null>(null);

  const selectedProject = useMemo(
    () => state.projects.find((project) => project.localProjectId === selectedProjectId) ?? null,
    [selectedProjectId, state.projects]
  );
  const selectedFolderAvailable = projectFolderAvailable(selectedProject);
  const selectedFolderStatus = projectFolderStatus(selectedProject);
  const agentWorkspace = useAgentWorkspace({
    api,
    active: workspaceView === "agent" || workspaceView === "chat",
    authStatus: state.authStatus,
    selectedProject,
    projectContext,
    models,
    modelsLoading,
    onChooseProject: () => void chooseProject()
  });
  const chatMessages = selectedProjectId
    ? chatMessagesByProject[selectedProjectId] ?? []
    : [];
  const selectedChatAgent = agentWorkspace.model.selectedAgent;
  const agentVersionKey =
    selectedProjectId && selectedChatAgent
      ? `${selectedProjectId}:${selectedChatAgent.id}`
      : null;
  const conversationAgentVersion = useMemo(
    () =>
      resolveConversationAgentVersion(
        chatMessages,
        selectedChatAgent,
        agentVersionKey ? adoptedAgentRevisions[agentVersionKey] : undefined
      ),
    [
      adoptedAgentRevisions,
      agentVersionKey,
      chatMessages,
      selectedChatAgent
    ]
  );

  useEffect(() => {
    setEditingMessageId(null);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    let active = true;
    void api.getLocalProjectChat(selectedProjectId)
      .then((chat) => {
        if (!active || !chat) return;
        sessionIdsRef.current.set(selectedProjectId, chat.sessionId);
        setChatMessagesByProject((current) => ({
          ...current,
          [selectedProjectId]: chat.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sentAt: message.sentAt,
            ...(message.contextFile ? { contextFile: message.contextFile } : {}),
            ...(message.stopped ? { stopped: true } : {}),
            ...(message.agentId ? { agentId: message.agentId } : {}),
            ...(message.agentRevision ? { agentRevision: message.agentRevision } : {}),
            ...(message.agentName ? { agentName: message.agentName } : {}),
            ...("agentAvatarUrl" in message
              ? { agentAvatarUrl: message.agentAvatarUrl }
              : {})
          }))
        }));
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "本地对话加载失败");
      });
    return () => { active = false; };
  }, [selectedProjectId]);
  const hasFileChanges = Boolean(
    readResult && (newFileDraft || fileDraft !== readResult.text)
  );
  const selectedProcess = processes.find((process) => process.processId === selectedProcessId) ??
    processes[0] ?? null;
  const visibleApprovals = state.approvals.filter(
    (approval) => !approval.projectId || approval.projectId === selectedProjectId
  );
  const visibleApprovalPolicies = state.approvalPolicies.filter(
    (policy) => policy.projectId === selectedProjectId
  );
  const selectedMcpServer = mcpServers.find((server) => server.serverId === selectedMcpServerId) ??
    mcpServers[0] ?? null;
  const selectedMcpTool = selectedMcpServer?.tools.find((tool) => tool.name === selectedMcpToolName) ??
    selectedMcpServer?.tools[0] ?? null;
  const selectedWorkflowRun = workflowRuns.find(
    (run) => run.workflowId === workflowDraft?.workflowId
  ) ?? null;
  const visibleWorkflowDefinitions = useMemo(() => {
    const query = workflowSearch.trim().toLocaleLowerCase();
    const definitions = workflowRegistry?.definitions ?? [];
    return query
      ? definitions.filter((definition) =>
          `${definition.title} ${definition.executorKey} ${definition.description}`
            .toLocaleLowerCase()
            .includes(query)
        )
      : definitions;
  }, [workflowRegistry, workflowSearch]);

  const refreshState = useCallback(async () => {
    const nextState = await api.getState();
    setState(nextState);
    setStateLoaded(true);
    setSelectedProjectId((current) =>
      current && nextState.projects.some((project) => project.localProjectId === current)
        ? current
        : nextState.projects[0]?.localProjectId ?? null
    );
    return nextState;
  }, []);

  useEffect(() => {
    void refreshState().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "无法连接 RouteMarket Worker");
    });
    const timer = window.setInterval(() => {
      void refreshState().catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "无法连接 RouteMarket Worker");
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshState]);

  useEffect(() => {
    const unsubscribe = api.onProjectChatEvent((event) => {
      const activeRequest = activeRequestRef.current;
      if (!activeRequest || event.requestId !== activeRequest.requestId) return;
      const projectId = activeRequest.projectId;

      if (event.type === "error") {
        setChatMessagesByProject((current) =>
          updateAssistantMessage(current, projectId, event.requestId, (message) => ({
            ...message,
            content: message.content || `请求失败：${event.message}`
          }))
        );
        activeRequestRef.current = null;
        setActiveRequestId(null);
        return;
      }

      if (
        event.type === "tool_started" ||
        event.type === "tool_completed" ||
        event.type === "tool_error"
      ) {
        setChatMessagesByProject((current) =>
          updateAssistantMessage(current, projectId, event.requestId, (message) => ({
            ...message,
            tools: updateChatToolActivity(message.tools ?? [], event)
          }))
        );
        return;
      }

      setChatMessagesByProject((current) =>
        updateAssistantMessage(current, projectId, event.requestId, (message) => ({
          ...message,
          content: event.content,
          stopped: event.type === "stopped"
        }))
      );
      if (event.type === "complete" || event.type === "stopped") {
        activeRequestRef.current = null;
        setActiveRequestId(null);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return api.onDesktopWorkflowRunEvent((event) => {
      setWorkflowRuns((current) => upsertWorkflowRun(current, event.run));
    });
  }, []);

  useEffect(() => {
    let active = true;
    setProjectFiles(null);
    setProjectContext(null);
    setSearchQuery("");
    setSearchResult(null);
    setSelectedFilePath(null);
    setReadResult(null);
    setAssetPreview(null);
    setFileDraft("");
    setNewFileDraft(false);
    setIncludeFileContext(true);
    if (!selectedProjectId || !selectedFolderAvailable) {
      setTreeLoading(false);
      return () => {
        active = false;
      };
    }

    setTreeLoading(true);
    void Promise.all([
      api.listProjectFiles(selectedProjectId),
      api.getProjectContext(selectedProjectId)
    ])
      .then(([tree, context]) => {
        if (active) {
          setProjectFiles(tree);
          setProjectContext(context);
        }
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
  }, [selectedFolderAvailable, selectedProjectId]);

  useEffect(() => {
    const preferred = projectContext?.settings.defaultModel;
    if (preferred && models.some((model) => model.code === preferred)) {
      setSelectedModelCode(preferred);
    }
  }, [models, projectContext]);

  useEffect(() => {
    setSelectedProjectSkillId((current) =>
      current && projectContext?.skills.some((skill) => skill.id === current) ? current : ""
    );
  }, [projectContext]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!selectedProjectId || !query) {
      setSearchResult(null);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api.searchProject(selectedProjectId, query)
        .then((result) => {
          if (active) setSearchResult(result);
        })
        .catch((nextError) => {
          if (active) setError(nextError instanceof Error ? nextError.message : "项目搜索失败");
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery, selectedProjectId]);

  const refreshProcesses = useCallback(async () => {
    const items = await api.listProcesses();
    const projectItems = selectedProjectId
      ? items.filter((item) => item.localProjectId === selectedProjectId)
      : [];
    setProcesses(projectItems);
    setSelectedProcessId((current) =>
      current && projectItems.some((item) => item.processId === current)
        ? current
        : projectItems[0]?.processId ?? null
    );
  }, [selectedProjectId]);

  useEffect(() => {
    if (workspaceView !== "terminal") return;
    void refreshProcesses().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "本地进程加载失败");
    });
    const timer = window.setInterval(() => {
      void refreshProcesses().catch(() => undefined);
    }, 800);
    return () => window.clearInterval(timer);
  }, [refreshProcesses, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "browser" || browserMode !== "managed" || !selectedProjectId) {
      void api.hideBrowser().catch(() => undefined);
      if (!selectedProjectId) setBrowserState(null);
      return;
    }
    if (browserScreenshot) {
      void api.hideBrowser();
      return;
    }
    let active = true;
    const syncBounds = () => {
      const element = browserViewportRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const bounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      };
      void api.showBrowser(selectedProjectId, bounds).then((state) => {
        if (active) setBrowserState(state);
      }).catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "浏览器启动失败");
      });
    };
    const frame = window.requestAnimationFrame(syncBounds);
    const observer = new ResizeObserver(syncBounds);
    if (browserViewportRef.current) observer.observe(browserViewportRef.current);
    window.addEventListener("resize", syncBounds);
    const timer = window.setInterval(() => {
      void api.getBrowserState(selectedProjectId).then((state) => {
        if (!active) return;
        setBrowserState(state);
        if (document.activeElement !== browserAddressRef.current && state.url !== "about:blank") {
          setBrowserAddress(state.url);
        }
      }).catch(() => undefined);
    }, 500);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      void api.hideBrowser().catch(() => undefined);
    };
  }, [browserMode, browserScreenshot, selectedProjectId, workspaceView]);

  const refreshMcpServers = useCallback(async () => {
    const servers = await api.listMcpServers();
    setMcpServers(servers);
    setSelectedMcpServerId((current) =>
      current && servers.some((server) => server.serverId === current)
        ? current
        : servers[0]?.serverId ?? null
    );
  }, []);

  useEffect(() => {
    if (workspaceView !== "mcp") return;
    void refreshMcpServers().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Local MCP 加载失败");
    });
    const timer = window.setInterval(() => void refreshMcpServers().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshMcpServers, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "workflow" || !selectedProjectId) return;
    let active = true;
    void api.getWorkflowNodeRegistry(selectedProjectId)
      .then((registry) => {
        if (active) setWorkflowRegistry(registry);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "工作流节点加载失败");
      });
    return () => { active = false; };
  }, [selectedProjectId, workspaceView, mcpServers]);

  const refreshLocalTriggers = useCallback(async () => {
    if (!selectedProjectId) {
      setLocalTriggers([]);
      return;
    }
    setLocalTriggers(await api.listLocalTriggers(selectedProjectId));
  }, [selectedProjectId]);

  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "triggers") return;
    void refreshLocalTriggers().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "本地触发器加载失败");
    });
  }, [refreshLocalTriggers, workflowPanel, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "connectors") return;
    void api.listNativeAppConnectors().then(setNativeConnectors).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "本地软件连接器加载失败");
    });
  }, [workflowPanel, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "canvas" || !selectedProjectId) return;
    let active = true;
    setWorkflowDraftBusy(true);
    void api.listDesktopWorkflowDrafts(selectedProjectId)
      .then(async (summaries) => {
        if (!active) return;
        const draft = summaries[0]
          ? await api.getDesktopWorkflowDraft(selectedProjectId, summaries[0].workflowId)
          : null;
        if (!active) return;
        const now = new Date().toISOString();
        setWorkflowDrafts(summaries);
        setWorkflowDraft(draft ?? {
          workflowId: `workflow_${crypto.randomUUID().replaceAll("-", "")}`,
          localProjectId: selectedProjectId,
          kind: "workflow",
          name: "未命名工作流",
          nodes: [],
          edges: [],
          createdAt: now,
          updatedAt: now
        });
        setWorkflowDraftDirty(false);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "工作流草稿加载失败");
      })
      .finally(() => { if (active) setWorkflowDraftBusy(false); });
    return () => { active = false; };
  }, [selectedProjectId, workflowPanel, workspaceView]);

  useEffect(() => {
    if (
      workspaceView !== "workflow" ||
      workflowPanel !== "canvas" ||
      !selectedProjectId
    ) {
      return;
    }
    let active = true;
    void api.listDesktopWorkflowRuns(selectedProjectId)
      .then((runs) => {
        if (active) setWorkflowRuns(runs);
      })
      .catch((nextError) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Workflow 运行记录加载失败"
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedProjectId, workflowPanel, workspaceView]);

  useEffect(() => {
    if (state.authStatus !== "signed_in") {
      setModels([]);
      setSelectedModelCode("");
      return;
    }
    let active = true;
    setModelsLoading(true);
    void api.listChatModels()
      .then((nextModels) => {
        if (!active) return;
        setModels(nextModels);
        setSelectedModelCode((current) =>
          nextModels.some((model) => model.code === current)
            ? current
            : nextModels[0]?.code ?? ""
        );
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "模型列表加载失败");
        }
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [state.authStatus]);

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
    if (activeRequestId) {
      await api.stopProjectMessage(activeRequestId).catch(() => undefined);
    }
    await agentWorkspace.stopActive().catch(() => undefined);
    setAuthAction("sign-out");
    setError(null);
    try {
      setState(await api.signOut());
      activeRequestRef.current = null;
      setActiveRequestId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "退出登录失败");
    } finally {
      setAuthAction(null);
    }
  }

  async function switchSpace(spaceId: string) {
    if (spaceId === state.account?.activeSpaceId) return;
    if (activeRequestId) await api.stopProjectMessage(activeRequestId).catch(() => undefined);
    await agentWorkspace.stopActive().catch(() => undefined);
    setAuthAction("switch-space");
    setError(null);
    try {
      setState(await api.switchSpace(spaceId));
      activeRequestRef.current = null;
      setActiveRequestId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "空间切换失败");
    } finally {
      setAuthAction(null);
    }
  }

  async function revokeApprovalPolicy(policyId: string) {
    setBusyApprovalPolicyId(policyId);
    setError(null);
    try {
      await api.removeApprovalPolicy(policyId);
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法撤销项目审批策略");
    } finally {
      setBusyApprovalPolicyId(null);
    }
  }

  function chooseProject() {
    setError(null);
    setProjectDialogOpen(true);
  }

  async function createProject(displayName: string, attachFolder: boolean) {
    setProjectActionBusy(true);
    setError(null);
    try {
      const project = await api.createProject(displayName);
      setSelectedProjectId(project.localProjectId);
      setWorkspaceView("chat");
      setProjectDialogOpen(false);
      if (attachFolder) await api.attachProjectFolder(project.localProjectId);
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目创建失败");
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function attachProjectFolder(localProjectId: string) {
    setError(null);
    try {
      const project = await api.attachProjectFolder(localProjectId);
      if (!project) return;
      await refreshState();
      setSelectedProjectId(localProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "关联文件夹失败");
    }
  }

  async function deleteProject(localProjectId: string) {
    setError(null);
    try {
      if (!await api.deleteProject(localProjectId)) return;
      const nextState = await refreshState();
      if (selectedProjectId === localProjectId) {
        setSelectedProjectId(nextState.projects[0]?.localProjectId ?? null);
      }
      setChatMessagesByProject((current) => {
        const next = { ...current };
        delete next[localProjectId];
        return next;
      });
      sessionIdsRef.current.delete(localProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除项目失败");
    }
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
    setAssetPreview(null);
    setFileVersions([]);
    setSelectedFileVersion(null);
    try {
      if (isPreviewableAsset(relativePath)) {
        const preview = await api.readProjectAsset(selectedProject.localProjectId, relativePath);
        setAssetPreview(preview);
        setReadResult(null);
        setFileDraft("");
        setIncludeFileContext(false);
      } else {
        const result = await api.readProjectFile(selectedProject.localProjectId, relativePath);
        setReadResult(result);
        setFileDraft(result.text);
        setNewFileDraft(false);
        setIncludeFileContext(true);
      }
      await refreshState();
    } catch (nextError) {
      setReadResult(null);
      setAssetPreview(null);
      setError(nextError instanceof Error ? nextError.message : "项目文件读取失败");
      await refreshState();
    } finally {
      setLoading(false);
    }
  }

  function selectProjectFile(relativePath: string) {
    if (
      readResult &&
      hasFileChanges &&
      relativePath !== selectedFilePath &&
      !window.confirm("当前文件有未保存的更改。放弃更改并打开其他文件吗？")
    ) {
      return;
    }
    void readProjectFile(relativePath);
  }

  function reviewProjectFileChanges() {
    if (!hasFileChanges) return;
    setWorkspaceView("changes");
  }

  function prepareNewProjectFile() {
    if (!selectedProject) return;
    if (hasFileChanges && !window.confirm("当前文件有未保存的更改。放弃并新建文件吗？")) {
      return;
    }
    const value = window.prompt("输入项目内相对路径，例如 src/new-file.ts");
    const relativePath = value?.trim().replaceAll("\\", "/");
    if (!relativePath) return;
    setSelectedFilePath(relativePath);
    setReadResult({
      uri: `project://${selectedProject.localProjectId}/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
      text: "",
      bytesRead: 0,
      truncated: false,
      encoding: "utf8",
      sha256: `sha256:${"0".repeat(64)}`
    });
    setFileDraft("");
    setNewFileDraft(true);
    setFileVersions([]);
    setSelectedFileVersion(null);
    setWorkspaceView("files");
    setError(null);
  }

  async function saveProjectFile() {
    if (!selectedProject || !selectedFilePath || !readResult || savingFile) return;
    setSavingFile(true);
    setError(null);
    try {
      const result = newFileDraft
        ? await api.createProjectFile(
            selectedProject.localProjectId,
            selectedFilePath,
            fileDraft
          )
        : await api.writeProjectFile(
            selectedProject.localProjectId,
            selectedFilePath,
            fileDraft,
            readResult.sha256
          );
      setReadResult(result);
      setFileDraft(result.text);
      setNewFileDraft(false);
      setWorkspaceView("files");
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目文件保存失败");
    } finally {
      setSavingFile(false);
    }
  }

  async function openFileVersions() {
    if (!selectedProjectId || !selectedFilePath || !readResult || newFileDraft) return;
    setFileVersionBusy(true);
    setError(null);
    try {
      const versions = await api.listProjectFileVersions(selectedProjectId, selectedFilePath);
      setFileVersions(versions);
      const first = versions[0];
      setSelectedFileVersion(first
        ? await api.readProjectFileVersion(selectedProjectId, selectedFilePath, first.versionId)
        : null);
      setWorkspaceView("versions");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文件版本历史加载失败");
    } finally {
      setFileVersionBusy(false);
    }
  }

  async function selectFileVersion(versionId: string) {
    if (!selectedProjectId || !selectedFilePath || fileVersionBusy) return;
    setFileVersionBusy(true);
    setError(null);
    try {
      setSelectedFileVersion(await api.readProjectFileVersion(
        selectedProjectId,
        selectedFilePath,
        versionId
      ));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "历史版本读取失败");
    } finally {
      setFileVersionBusy(false);
    }
  }

  async function restoreFileVersion() {
    if (!selectedProjectId || !selectedFilePath || !selectedFileVersion || fileVersionBusy) return;
    setFileVersionBusy(true);
    setError(null);
    try {
      const result = await api.restoreProjectFileVersion(
        selectedProjectId,
        selectedFilePath,
        selectedFileVersion.versionId
      );
      setReadResult(result);
      setFileDraft(result.text);
      setNewFileDraft(false);
      setWorkspaceView("files");
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "历史版本恢复失败");
    } finally {
      setFileVersionBusy(false);
    }
  }

  async function exportSelectedProjectFile(versionId?: string) {
    if (!selectedProjectId || !selectedFilePath || fileVersionBusy) return;
    setFileVersionBusy(true);
    setError(null);
    try {
      await api.exportProjectFile(selectedProjectId, selectedFilePath, versionId);
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目文件导出失败");
    } finally {
      setFileVersionBusy(false);
    }
  }

  async function startProjectProcess() {
    if (!selectedProject || processBusy) return;
    setProcessBusy(true);
    setError(null);
    try {
      const command = parseCommandLine(processCommand);
      const result = await api.startProcess(
        selectedProject.localProjectId,
        command.executable,
        command.args
      );
      setProcessCommand("");
      await refreshProcesses();
      setSelectedProcessId(result.processId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地进程启动失败");
    } finally {
      setProcessBusy(false);
    }
  }

  async function stopProjectProcess() {
    if (!selectedProcess || selectedProcess.status !== "running" || processBusy) return;
    setProcessBusy(true);
    setError(null);
    try {
      await api.stopProcess(selectedProcess.processId);
      await refreshProcesses();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地进程停止失败");
    } finally {
      setProcessBusy(false);
    }
  }

  async function navigateCurrentBrowser() {
    if (browserBusy || (browserMode === "managed" && !selectedProjectId)) return;
    setBrowserBusy(true);
    setError(null);
    try {
      if (browserMode === "attached") {
        const state = await api.navigateAttachedBrowser(browserAddress);
        setAttachedState(state);
        if (state.target) setBrowserAddress(state.target.url);
      } else {
        const state = await api.navigateBrowser(selectedProjectId!, browserAddress);
        setBrowserState(state);
        setBrowserAddress(state.url);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网页导航失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function discoverAttachedTargets() {
    if (browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const targets = await api.discoverAttachedBrowser(attachedEndpoint);
      setAttachedTargets(targets);
      setSelectedAttachedTargetId((current) =>
        current && targets.some((target) => target.targetId === current)
          ? current
          : targets[0]?.targetId ?? ""
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "浏览器目标发现失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function toggleAttachedConnection() {
    if (browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = attachedState.connected
        ? await api.disconnectAttachedBrowser()
        : await api.connectAttachedBrowser(attachedEndpoint, selectedAttachedTargetId || undefined);
      setAttachedState(state);
      if (state.target?.url) setBrowserAddress(state.target.url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Attached Browser 连接失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function runBrowserNavigation(action: "back" | "forward" | "reload") {
    if (!selectedProjectId) return;
    setError(null);
    try {
      const state = action === "back"
        ? await api.browserBack(selectedProjectId)
        : action === "forward"
          ? await api.browserForward(selectedProjectId)
          : await api.reloadBrowser(selectedProjectId);
      setBrowserState(state);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "浏览器操作失败");
    }
  }

  async function toggleBrowserTakeover() {
    if (!browserState || !selectedProjectId) return;
    try {
      setBrowserState(await api.setBrowserTakeover(selectedProjectId, !browserState.userTakeover));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "浏览器接管失败");
    }
  }

  async function captureBrowserScreenshot() {
    if (browserMode === "managed" && !selectedProjectId) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const screenshot = browserMode === "attached"
        ? await api.screenshotAttachedBrowser()
        : await api.screenshotBrowser(selectedProjectId!);
      if (browserMode === "managed") await api.hideBrowser();
      setBrowserScreenshot(screenshot);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网页截图失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function retryManagedBrowserOperation(operationId: string) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      setBrowserState(
        await api.retryBrowserOperation(selectedProjectId, operationId)
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "浏览器操作重试失败"
      );
    } finally {
      setBrowserBusy(false);
    }
  }

  async function createManagedBrowserPage(profileId?: string) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = await api.createBrowserPage(selectedProjectId, profileId);
      setBrowserState(state);
      setBrowserAddress("https://example.com");
      setBrowserScreenshot(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "浏览器页面创建失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function selectManagedBrowserPage(pageId: string) {
    if (!selectedProjectId || browserBusy || pageId === browserState?.activePageId) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = await api.selectBrowserPage(selectedProjectId, pageId);
      setBrowserState(state);
      setBrowserAddress(state.url === "about:blank" ? "https://example.com" : state.url);
      setBrowserScreenshot(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "浏览器页面切换失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function closeManagedBrowserPage(pageId: string) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = await api.closeBrowserPage(selectedProjectId, pageId);
      setBrowserState(state);
      setBrowserAddress(state.url === "about:blank" ? "https://example.com" : state.url);
      setBrowserScreenshot(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "浏览器页面关闭失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function createManagedBrowserProfile(
    input: Parameters<RouteMarketWorkApi["createBrowserProfile"]>[1]
  ) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = await api.createBrowserProfile(selectedProjectId, input);
      setBrowserState(state);
      setBrowserAddress("https://example.com");
      setBrowserScreenshot(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Browser Profile 创建失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function updateManagedBrowserProfile(
    profileId: string,
    input: Parameters<RouteMarketWorkApi["updateBrowserProfile"]>[2]
  ) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      setBrowserState(await api.updateBrowserProfile(selectedProjectId, profileId, input));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Browser Profile 保存失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function deleteManagedBrowserProfile(profileId: string) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = await api.deleteBrowserProfile(selectedProjectId, profileId);
      setBrowserState(state);
      setBrowserAddress(state.url === "about:blank" ? "https://example.com" : state.url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Browser Profile 删除失败");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function createLocalTrigger() {
    if (!selectedProjectId || !triggerName.trim() || triggerBusy) return;
    setTriggerBusy(true);
    setError(null);
    try {
      await api.saveLocalTrigger({
        localProjectId: selectedProjectId,
        name: triggerName.trim(),
        kind: triggerKind,
        enabled: true,
        ...(triggerKind === "file_changed" || triggerKind === "folder_added"
          ? { relativePath: triggerValue.trim() || "." }
          : triggerKind === "schedule"
            ? { intervalMinutes: Number(triggerValue) }
            : { accelerator: triggerValue.trim() })
      });
      setTriggerName("");
      await refreshLocalTriggers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地触发器创建失败");
    } finally {
      setTriggerBusy(false);
    }
  }

  async function removeLocalTrigger(triggerId: string) {
    if (triggerBusy) return;
    setTriggerBusy(true);
    setError(null);
    try {
      await api.removeLocalTrigger(triggerId);
      await refreshLocalTriggers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地触发器移除失败");
    } finally {
      setTriggerBusy(false);
    }
  }

  async function fireLocalTrigger(triggerId: string) {
    if (triggerBusy) return;
    setTriggerBusy(true);
    setError(null);
    try {
      await api.fireLocalTrigger(triggerId);
      await refreshLocalTriggers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地触发器运行失败");
    } finally {
      setTriggerBusy(false);
    }
  }

  async function toggleLocalTrigger(trigger: LocalTriggerSummary) {
    if (triggerBusy) return;
    setTriggerBusy(true);
    setError(null);
    try {
      await api.saveLocalTrigger({
        localProjectId: trigger.localProjectId,
        name: trigger.name,
        kind: trigger.kind,
        enabled: !trigger.enabled,
        ...(trigger.relativePath ? { relativePath: trigger.relativePath } : {}),
        ...(trigger.intervalMinutes ? { intervalMinutes: trigger.intervalMinutes } : {}),
        ...(trigger.accelerator ? { accelerator: trigger.accelerator } : {})
      }, trigger.triggerId);
      await refreshLocalTriggers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地触发器状态更新失败");
    } finally {
      setTriggerBusy(false);
    }
  }

  async function openNativeConnector(connector: NativeAppConnectorSummary) {
    if (!selectedProjectId || !connector.available || connectorBusyId) return;
    setConnectorBusyId(connector.connectorId);
    setError(null);
    try {
      const relativePath = connector.connectorId === "vscode" ? selectedFilePath ?? undefined : selectedFilePath ?? undefined;
      if (connector.connectorId !== "vscode" && !relativePath) {
        throw new Error(`请先在左侧选择一个 ${connector.name} 支持的项目文件。`);
      }
      await api.openNativeAppConnector(connector.connectorId, selectedProjectId, relativePath);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "本地软件打开失败");
    } finally {
      setConnectorBusyId(null);
    }
  }

  function updateWorkflowDraft(mutator: (draft: DesktopWorkflowDraft) => DesktopWorkflowDraft) {
    setWorkflowDraft((current) => current ? mutator(current) : current);
    setWorkflowDraftDirty(true);
  }

  function addWorkflowNode() {
    const definition = workflowRegistry?.definitions.find((item) => item.executorKey === workflowAddExecutor);
    if (!definition || !workflowDraft) return;
    const index = workflowDraft.nodes.length;
    const nodeId = `node_${crypto.randomUUID().replaceAll("-", "")}`;
    updateWorkflowDraft((draft) => ({
      ...draft,
      nodes: [...draft.nodes, {
        nodeId,
        executorKey: definition.executorKey,
        title: definition.title,
        executionTarget: definition.executionTarget,
        x: 48 + (index % 3) * 250,
        y: 70 + Math.floor(index / 3) * 150,
        config: {},
        definitionSnapshot: definition
      }]
    }));
    setWorkflowAddExecutor("");
  }

  function removeWorkflowNode(nodeId: string) {
    updateWorkflowDraft((draft) => ({
      ...draft,
      nodes: draft.nodes.filter((node) => node.nodeId !== nodeId),
      edges: draft.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
    }));
    if (workflowEdgeSource === nodeId) setWorkflowEdgeSource("");
    if (workflowEdgeTarget === nodeId) setWorkflowEdgeTarget("");
  }

  function connectWorkflowNodes() {
    if (!workflowDraft || !workflowEdgeSource || !workflowEdgeTarget || workflowEdgeSource === workflowEdgeTarget) return;
    if (workflowDraft.edges.some((edge) => edge.sourceNodeId === workflowEdgeSource && edge.targetNodeId === workflowEdgeTarget)) return;
    updateWorkflowDraft((draft) => ({
      ...draft,
      edges: [...draft.edges, {
        edgeId: `edge_${crypto.randomUUID().replaceAll("-", "")}`,
        sourceNodeId: workflowEdgeSource,
        targetNodeId: workflowEdgeTarget
      }]
    }));
    setWorkflowEdgeSource("");
    setWorkflowEdgeTarget("");
  }

  async function saveWorkflowDraft() {
    if (!workflowDraft || workflowDraftBusy) return;
    setWorkflowDraftBusy(true);
    setError(null);
    try {
      const saved = await api.saveDesktopWorkflowDraft(workflowDraft);
      setWorkflowDraft(saved);
      setWorkflowDrafts(await api.listDesktopWorkflowDrafts(saved.localProjectId));
      setWorkflowRegistry(await api.getWorkflowNodeRegistry(saved.localProjectId));
      setWorkflowDraftDirty(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "工作流草稿保存失败");
    } finally {
      setWorkflowDraftBusy(false);
    }
  }

  async function deleteWorkflowDraft() {
    if (!selectedProjectId || !workflowDraft || workflowDraftBusy) return;
    setWorkflowDraftBusy(true);
    setError(null);
    try {
      await api.deleteDesktopWorkflowDraft(selectedProjectId, workflowDraft.workflowId);
      const summaries = await api.listDesktopWorkflowDrafts(selectedProjectId);
      setWorkflowDrafts(summaries);
      setWorkflowRegistry(await api.getWorkflowNodeRegistry(selectedProjectId));
      const next = summaries[0]
        ? await api.getDesktopWorkflowDraft(selectedProjectId, summaries[0].workflowId)
        : null;
      const now = new Date().toISOString();
      setWorkflowDraft(next ?? { workflowId: `workflow_${crypto.randomUUID().replaceAll("-", "")}`, localProjectId: selectedProjectId, kind: "workflow", name: "未命名工作流", nodes: [], edges: [], createdAt: now, updatedAt: now });
      setWorkflowDraftDirty(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "工作流草稿删除失败");
    } finally {
      setWorkflowDraftBusy(false);
    }
  }

  async function runWorkflowDraft() {
    if (
      !selectedProjectId ||
      !workflowDraft ||
      workflowDraft.kind !== "workflow" ||
      workflowDraftDirty ||
      workflowRunBusy
    ) {
      return;
    }
    setWorkflowRunBusy(true);
    setError(null);
    try {
      const input = JSON.parse(workflowRunInput) as unknown;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Workflow 运行输入必须是 JSON 对象。");
      }
      const run = await api.runDesktopWorkflow(
        selectedProjectId,
        workflowDraft.workflowId,
        input as Record<string, unknown>
      );
      setWorkflowRuns((current) => upsertWorkflowRun(current, run));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Workflow 运行失败"
      );
    } finally {
      setWorkflowRunBusy(false);
    }
  }

  async function cancelWorkflowRun() {
    if (!selectedWorkflowRun || workflowRunBusy) return;
    setWorkflowRunBusy(true);
    setError(null);
    try {
      const run = await api.cancelDesktopWorkflowRun(selectedWorkflowRun.runId);
      setWorkflowRuns((current) => upsertWorkflowRun(current, run));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Workflow 取消失败"
      );
    } finally {
      setWorkflowRunBusy(false);
    }
  }

  async function retryWorkflowRun() {
    if (!selectedWorkflowRun || workflowRunBusy) return;
    setWorkflowRunBusy(true);
    setError(null);
    try {
      const run = await api.retryDesktopWorkflowRun(selectedWorkflowRun.runId);
      setWorkflowRuns((current) => upsertWorkflowRun(current, run));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Workflow 重试失败"
      );
    } finally {
      setWorkflowRunBusy(false);
    }
  }

  async function selectWorkflowDraft(workflowId: string) {
    if (!selectedProjectId || workflowDraftBusy || workflowId === workflowDraft?.workflowId) return;
    if (workflowDraftDirty && !window.confirm("当前工作流有未保存更改。放弃并切换吗？")) return;
    setWorkflowDraftBusy(true);
    setError(null);
    try {
      setWorkflowDraft(await api.getDesktopWorkflowDraft(selectedProjectId, workflowId));
      setWorkflowDraftDirty(false);
      setWorkflowEdgeSource("");
      setWorkflowEdgeTarget("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "工作流草稿切换失败");
    } finally {
      setWorkflowDraftBusy(false);
    }
  }

  function createWorkflowDraft(kind: DesktopWorkflowDraft["kind"]) {
    if (!selectedProjectId) return;
    if (workflowDraftDirty && !window.confirm("当前工作流有未保存更改。放弃并新建吗？")) return;
    const now = new Date().toISOString();
    setWorkflowDraft({
      workflowId: `${kind === "local_action" ? "action" : "workflow"}_${crypto.randomUUID().replaceAll("-", "")}`,
      localProjectId: selectedProjectId,
      kind,
      name: kind === "local_action" ? "未命名本地动作" : "未命名工作流",
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now
    });
    setWorkflowDraftDirty(true);
    setWorkflowEdgeSource("");
    setWorkflowEdgeTarget("");
  }

  async function installLocalMcp() {
    if (!mcpName.trim() || !mcpCommand.trim() || mcpBusy) return;
    setMcpBusy(true);
    setError(null);
    try {
      const command = mcpTransport === "stdio" ? parseCommandLine(mcpCommand) : null;
      const server = await api.installMcpServer({
        name: mcpName.trim(),
        transport: mcpTransport,
        ...(command ? { command: command.executable, args: command.args } : {
          args: [],
          url: mcpCommand.trim()
        }),
        localProjectId: selectedProjectId
      });
      setMcpName("");
      setMcpCommand("");
      await refreshMcpServers();
      setSelectedMcpServerId(server.serverId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local MCP 安装失败");
    } finally {
      setMcpBusy(false);
    }
  }

  async function toggleLocalMcp() {
    if (!selectedMcpServer || mcpBusy) return;
    setMcpBusy(true);
    setError(null);
    try {
      if (selectedMcpServer.status === "online" || selectedMcpServer.status === "starting") {
        await api.stopMcpServer(selectedMcpServer.serverId);
      } else {
        await api.startMcpServer(selectedMcpServer.serverId);
      }
      await refreshMcpServers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local MCP 状态切换失败");
    } finally {
      setMcpBusy(false);
    }
  }

  async function removeLocalMcp() {
    if (!selectedMcpServer || mcpBusy) return;
    if (!window.confirm(`移除 Local MCP “${selectedMcpServer.name}” 的本地配置吗？`)) return;
    setMcpBusy(true);
    setError(null);
    try {
      await api.removeMcpServer(selectedMcpServer.serverId);
      setMcpResult("");
      await refreshMcpServers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local MCP 移除失败");
    } finally {
      setMcpBusy(false);
    }
  }

  async function callLocalMcpTool() {
    if (!selectedMcpServer || !selectedMcpTool || mcpBusy) return;
    setMcpBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(mcpToolArgs) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Tool 参数必须是 JSON 对象。");
      }
      const result = await api.callMcpTool(
        selectedMcpServer.serverId,
        selectedMcpTool.name,
        parsed as Record<string, unknown>
      );
      setMcpResult(JSON.stringify(result, null, 2));
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local MCP Tool 调用失败");
    } finally {
      setMcpBusy(false);
    }
  }

  async function sendMessage(messageOverride?: string) {
    const message = (messageOverride ?? draft).trim();
    const selectedAgent = agentWorkspace.model.selectedAgent;
    if (
      !message ||
      !selectedProject ||
      !selectedModelCode ||
      !selectedAgent ||
      activeRequestId
    ) return;
    if (state.authStatus !== "signed_in") {
      setError("请先登录 RouteMarket 账户。");
      return;
    }

    const selectedSkill = projectContext?.skills.find((skill) => skill.id === selectedProjectSkillId);
    let projectSkill: ProjectChatRequest["projectSkill"];
    if (selectedSkill) {
      try {
        const skillFile = await api.readProjectFile(
          selectedProject.localProjectId,
          selectedSkill.relativePath
        );
        projectSkill = {
          id: selectedSkill.id,
          name: selectedSkill.name,
          relativePath: selectedSkill.relativePath,
          text: skillFile.text.slice(0, 64_000),
          truncated: skillFile.truncated || skillFile.text.length > 64_000
        };
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "项目 Skill 加载失败");
        return;
      }
    }

    let requestMessages = chatMessages;
    if (editingMessageId) {
      try {
        requestMessages = messagesBeforeEditedUser(
          requestMessages,
          editingMessageId
        );
      } catch {
        setEditingMessageId(null);
        setError("要编辑的消息已不存在，请重新选择。");
        return;
      }
      try {
        await api.truncateLocalProjectChat(
          selectedProject.localProjectId,
          editingMessageId
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "无法回溯本地对话，请稍后重试"
        );
        return;
      }
      setChatMessagesByProject((current) => ({
        ...current,
        [selectedProject.localProjectId]: requestMessages
      }));
      setEditingMessageId(null);
    }
    const activeAgentVersion = resolveConversationAgentVersion(
      requestMessages,
      selectedAgent,
      agentVersionKey ? adoptedAgentRevisions[agentVersionKey] : undefined
    );
    if (!activeAgentVersion) return;

    const requestId = `work_chat_${crypto.randomUUID().replaceAll("-", "")}`;
    const sessionId =
      sessionIdsRef.current.get(selectedProject.localProjectId) ??
      `work_session_${crypto.randomUUID().replaceAll("-", "")}`;
    sessionIdsRef.current.set(selectedProject.localProjectId, sessionId);
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user:${requestId}`,
      role: "user",
      content: message,
      sentAt,
      ...(includeFileContext && selectedFilePath
        ? { contextFile: selectedFilePath }
        : {})
    };
    const assistantMessage: ChatMessage = {
      id: `assistant:${requestId}`,
      role: "assistant",
      content: "",
      sentAt,
      agentId: selectedAgent.id,
      agentRevision: activeAgentVersion.activeRevision,
      agentName: activeAgentVersion.name,
      agentAvatarUrl: activeAgentVersion.avatarUrl
    };

    setChatMessagesByProject((current) => ({
      ...current,
      [selectedProject.localProjectId]: [
        ...requestMessages,
        userMessage,
        assistantMessage
      ]
    }));
    setDraft("");
    setError(null);
    activeRequestRef.current = {
      requestId,
      projectId: selectedProject.localProjectId
    };
    setActiveRequestId(requestId);

    try {
      await api.sendProjectMessage({
        requestId,
        sessionId,
        sentAt,
        model: selectedModelCode,
        message,
        project: {
          localProjectId: selectedProject.localProjectId,
          displayName: selectedProject.displayName,
          hasFolder: selectedFolderAvailable
        },
        ...(projectContext ? { projectContext } : {}),
        ...(projectSkill ? { projectSkill } : {}),
        agent: {
          agentId: selectedAgent.id,
          agentRevision: activeAgentVersion.activeRevision,
          executionEnvironment,
          agentName: activeAgentVersion.name,
          agentAvatarUrl: activeAgentVersion.avatarUrl,
          localToolGroups: agentWorkspace.model.localToolGroups,
          maxToolRounds: agentWorkspace.model.maxToolRounds
        },
        ...(includeFileContext && selectedFilePath && readResult
          ? {
              contextFile: {
                relativePath: selectedFilePath,
                uri: readResult.uri,
                text: readResult.text,
                truncated: readResult.truncated
              }
            }
          : {})
      });
    } catch (nextError) {
      const messageText =
        nextError instanceof Error ? nextError.message : "对话请求发送失败";
      setChatMessagesByProject((current) =>
        updateAssistantMessage(
          current,
          selectedProject.localProjectId,
          requestId,
          (assistant) => ({
            ...assistant,
            content: `请求失败：${messageText}`
          })
        )
      );
      activeRequestRef.current = null;
      setActiveRequestId(null);
    }
  }

  function retryMessage(messageId: string) {
    const assistantIndex = chatMessages.findIndex((message) => message.id === messageId);
    if (assistantIndex < 0) return;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      const prior = chatMessages[index];
      if (prior?.role === "user" && prior.content.trim()) {
        void sendMessage(prior.content);
        return;
      }
    }
  }

  async function stopMessage() {
    if (!activeRequestId) return;
    await api.stopProjectMessage(activeRequestId);
  }

  if (!stateLoaded || state.authStatus !== "signed_in") {
    return (
      <AuthGate
        loading={!stateLoaded}
        state={state}
        busy={authAction !== null}
        connectionError={error}
        onSignIn={() => void signIn()}
        onCancel={() => void signOut()}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppRail
        activeView={workspaceView}
        state={state}
        selectedProjectId={selectedProjectId}
        authBusy={authAction !== null}
        onSelect={(view) => {
          if (view === "browser") setBrowserScreenshot(null);
          setWorkspaceView(view);
        }}
        onCreateProject={chooseProject}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setWorkspaceView("chat");
          setError(null);
        }}
        onAttachProjectFolder={(projectId) => void attachProjectFolder(projectId)}
        onDeleteProject={(projectId) => void deleteProject(projectId)}
        onRefreshState={() => void refreshState()}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        onSwitchSpace={(spaceId) => void switchSpace(spaceId)}
      />
      <GlobalHeader
        activeView={workspaceView}
        activities={state.activities}
        onClearActivities={() => {
          void api.clearActivities().then(setState).catch((nextError) => {
            setError(nextError instanceof Error ? nextError.message : "无法清除本机活动");
          });
        }}
      />
      <main className="workspace">
        <header className="workspace-header">
          <div className="project-heading">
            <div className="project-icon"><Folder size={18} /></div>
            <div>
              <h1>{selectedProject?.displayName ?? "选择项目"}</h1>
              <span>{selectedFilePath ?? (
                projectContext
                  ? [
                      projectContext.instructions ? "AGENTS.md" : null,
                      projectContext.skills.length
                        ? `${projectContext.skills.length} 个项目 Skill`
                        : null,
                      projectContext.settings.cloudProjectId ? "已关联云端项目" : null
                    ].filter(Boolean).join(" · ") || projectFolderMessage(selectedProject)
                  : selectedProject
                    ? projectFolderMessage(selectedProject)
                    : "项目可选关联文件夹"
              )}</span>
            </div>
            {selectedProject && (
              <button className="icon-button compact" type="button" title="切换项目">
                <ChevronDown size={15} />
              </button>
            )}
          </div>
          <div className="header-actions">
            {selectedProject && !selectedFolderAvailable && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void attachProjectFolder(selectedProject.localProjectId)}
              >
                <FolderOpen size={15} />
                {selectedFolderStatus === "unlinked" ? "关联文件夹" : "修复文件夹"}
              </button>
            )}
            <span className="rm-worker-pill">
              <span className={`rm-status-dot ${state.workerStatus}`} />
              <strong>本机 Worker</strong>
              {state.workerStatus === "online" ? "已连接" : "启动中"}
            </span>
            <button
              className="primary-button"
              type="button"
              disabled={!selectedProject || !selectedFolderAvailable || treeLoading}
              onClick={() => void refreshProjectFiles()}
            >
              {treeLoading
                ? <LoaderCircle className="spin" size={16} />
                : <RefreshCw size={16} />}
              刷新文件
            </button>
          </div>
        </header>

        <div className="workspace-tabs" role="navigation" aria-label="项目工具">
          <button
            className={`tab ${workspaceView === "files" ? "active" : ""}`}
            type="button"
            disabled={Boolean(selectedProject && !selectedFolderAvailable)}
            title={selectedProject && !selectedFolderAvailable ? projectFolderMessage(selectedProject) : undefined}
            onClick={() => setWorkspaceView("files")}
          >
            <FileText size={15} />文件
          </button>
          <button
            className={`tab ${workspaceView === "terminal" ? "active" : ""}`}
            type="button"
            disabled={Boolean(selectedProject && !selectedFolderAvailable)}
            title={selectedProject && !selectedFolderAvailable ? projectFolderMessage(selectedProject) : undefined}
            onClick={() => setWorkspaceView("terminal")}
          ><SquareTerminal size={15} />终端</button>
          <button
            className={`tab ${workspaceView === "changes" ? "active" : ""}`}
            type="button"
            disabled={!hasFileChanges}
            onClick={reviewProjectFileChanges}
          >
            <GitBranch size={15} />更改
            {hasFileChanges && <span className="change-dot" />}
          </button>
          <button
            className={`tab ${workspaceView === "versions" ? "active" : ""}`}
            type="button"
            disabled={!readResult || newFileDraft}
            onClick={() => void openFileVersions()}
          ><RefreshCw size={15} />版本</button>
          <button
            className={`tab ${workspaceView === "approvals" ? "active" : ""}`}
            type="button"
            onClick={() => setWorkspaceView("approvals")}
          ><ShieldCheck size={15} />审批</button>
        </div>

        <div className="workspace-body">
          {workspaceView === "agent" ? (
            <AgentPage
              model={agentWorkspace.model}
              actions={agentWorkspace.actions}
            />
          ) : workspaceView === "workflow" ? (
            <WorkflowPage
              model={{
                panel: workflowPanel,
                registry: workflowRegistry,
                search: workflowSearch,
                visibleDefinitions: visibleWorkflowDefinitions,
                draft: workflowDraft,
                drafts: workflowDrafts,
                draftDirty: workflowDraftDirty,
                draftBusy: workflowDraftBusy,
                runs: workflowRuns,
                selectedRun: selectedWorkflowRun,
                runInput: workflowRunInput,
                runBusy: workflowRunBusy,
                addExecutor: workflowAddExecutor,
                edgeSource: workflowEdgeSource,
                edgeTarget: workflowEdgeTarget,
                selectedProjectId,
                selectedFilePath,
                triggers: localTriggers,
                triggerName,
                triggerKind,
                triggerValue,
                triggerBusy,
                connectors: nativeConnectors,
                connectorBusyId,
                error
              }}
              actions={{
                navigation: {
                  onPanelChange: setWorkflowPanel,
                  onSearchChange: setWorkflowSearch
                },
                canvas: {
                  onSelectDraft: (workflowId) => void selectWorkflowDraft(workflowId),
                  onCreateDraft: createWorkflowDraft,
                  onDraftNameChange: (name) =>
                    updateWorkflowDraft((draft) => ({ ...draft, name })),
                  onAddExecutorChange: setWorkflowAddExecutor,
                  onAddNode: addWorkflowNode,
                  onEdgeSourceChange: setWorkflowEdgeSource,
                  onEdgeTargetChange: setWorkflowEdgeTarget,
                  onConnectNodes: connectWorkflowNodes,
                  onClearEdges: () =>
                    updateWorkflowDraft((draft) => ({ ...draft, edges: [] })),
                  onRemoveNode: removeWorkflowNode,
                  onSaveDraft: () => void saveWorkflowDraft(),
                  onDeleteDraft: () => void deleteWorkflowDraft(),
                  onRunInputChange: setWorkflowRunInput,
                  onRun: () => void runWorkflowDraft(),
                  onCancelRun: () => void cancelWorkflowRun(),
                  onRetryRun: () => void retryWorkflowRun()
                },
                triggers: {
                  onNameChange: setTriggerName,
                  onKindChange: (kind) => {
                    setTriggerKind(kind);
                    setTriggerValue(
                      kind === "schedule"
                        ? "15"
                        : kind === "hotkey"
                          ? "CommandOrControl+Shift+R"
                          : "."
                    );
                  },
                  onValueChange: setTriggerValue,
                  onCreate: () => void createLocalTrigger(),
                  onToggle: (trigger) => void toggleLocalTrigger(trigger),
                  onFire: (triggerId) => void fireLocalTrigger(triggerId),
                  onRemove: (triggerId) => void removeLocalTrigger(triggerId)
                },
                connectors: {
                  onOpen: (connector) => void openNativeConnector(connector)
                },
                onDismissError: () => setError(null)
              }}
            />
          ) : workspaceView === "mcp" ? (
            <section className="mcp-pane">
              <div className="mcp-install-bar">
                <select
                  value={mcpTransport}
                  aria-label="MCP transport"
                  onChange={(event) => {
                    setMcpTransport(event.target.value as "stdio" | "streamable-http");
                    setMcpCommand("");
                  }}
                >
                  <option value="stdio">stdio</option>
                  <option value="streamable-http">Streamable HTTP</option>
                </select>
                <input
                  value={mcpName}
                  placeholder="Server 名称"
                  aria-label="MCP Server 名称"
                  onChange={(event) => setMcpName(event.target.value)}
                />
                <input
                  value={mcpCommand}
                  placeholder={mcpTransport === "stdio"
                    ? "stdio 命令，例如 npx -y @modelcontextprotocol/server-filesystem ."
                    : "Streamable HTTP URL，例如 http://127.0.0.1:3000/mcp"}
                  aria-label={mcpTransport === "stdio" ? "MCP stdio 命令" : "MCP Streamable HTTP URL"}
                  onChange={(event) => setMcpCommand(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void installLocalMcp();
                  }}
                />
                <button
                  className="primary-button"
                  type="button"
                  disabled={!mcpName.trim() || !mcpCommand.trim() || mcpBusy}
                  onClick={() => void installLocalMcp()}
                >{mcpBusy ? <LoaderCircle className="spin" size={14} /> : <Plug size={14} />}安装</button>
              </div>
              <div className="mcp-layout">
                <aside className="mcp-server-list">
                  {mcpServers.map((server) => (
                    <button
                      key={server.serverId}
                      className={server.serverId === selectedMcpServer?.serverId ? "active" : ""}
                      type="button"
                      onClick={() => {
                        setSelectedMcpServerId(server.serverId);
                        setSelectedMcpToolName(server.tools[0]?.name ?? null);
                        setMcpResult("");
                      }}
                    >
                      <span className={`mcp-status ${server.status}`} />
                      <strong>{server.name}</strong>
                      <small>{server.status} · {server.tools.length} tools</small>
                    </button>
                  ))}
                  {mcpServers.length === 0 && (
                    <div className="mcp-empty"><Plug size={24} /><span>尚未安装 Local MCP</span></div>
                  )}
                </aside>
                <div className="mcp-detail">
                  {selectedMcpServer ? (
                    <>
                      <div className="mcp-detail-header">
                        <div>
                          <h2>{selectedMcpServer.name}</h2>
                          <code>{selectedMcpServer.transport === "stdio"
                            ? `${selectedMcpServer.command} ${selectedMcpServer.args.join(" ")}`
                            : selectedMcpServer.url}</code>
                        </div>
                        <div>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={mcpBusy}
                            onClick={() => void toggleLocalMcp()}
                          >
                            {selectedMcpServer.status === "online"
                              ? <><Square size={12} fill="currentColor" />停止</>
                              : <><Play size={12} fill="currentColor" />启动</>}
                          </button>
                          <button
                            className="danger-icon-button"
                            type="button"
                            title="移除 MCP Server"
                            disabled={mcpBusy}
                            onClick={() => void removeLocalMcp()}
                          ><Trash2 size={14} /></button>
                        </div>
                      </div>
                      {selectedMcpServer.lastError && (
                        <div className="mcp-server-error">{selectedMcpServer.lastError}</div>
                      )}
                      <div className="mcp-tools">
                        <div className="mcp-tool-list">
                          <span>TOOLS</span>
                          {selectedMcpServer.tools.map((tool) => (
                            <button
                              key={tool.name}
                              className={tool.name === selectedMcpTool?.name ? "active" : ""}
                              type="button"
                              onClick={() => {
                                setSelectedMcpToolName(tool.name);
                                setMcpToolArgs("{}");
                                setMcpResult("");
                              }}
                            >
                              <strong>{tool.title ?? tool.name}</strong>
                              <small>{tool.description ?? "No description"}</small>
                            </button>
                          ))}
                          {selectedMcpServer.status === "online" && selectedMcpServer.tools.length === 0 && (
                            <div className="mcp-empty compact">Server 未公开 Tools</div>
                          )}
                        </div>
                        <div className="mcp-tool-runner">
                          {selectedMcpTool ? (
                            <>
                              <div>
                                <strong>{selectedMcpTool.name}</strong>
                                <button
                                  className="primary-button"
                                  type="button"
                                  disabled={mcpBusy || selectedMcpServer.status !== "online"}
                                  onClick={() => void callLocalMcpTool()}
                                >{mcpBusy ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}调用</button>
                              </div>
                              <label>JSON 参数</label>
                              <textarea value={mcpToolArgs} spellCheck={false} onChange={(event) => setMcpToolArgs(event.target.value)} />
                              <label>调用结果</label>
                              <pre>{mcpResult || "调用结果将显示在这里。"}</pre>
                            </>
                          ) : (
                            <div className="mcp-empty"><span>启动 Server 并选择一个 Tool</span></div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mcp-empty"><Plug size={28} /><span>安装一个 stdio MCP Server 开始使用</span></div>
                  )}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={18} /><span>{error}</span>
                  <button type="button" title="关闭" onClick={() => setError(null)}><X size={14} /></button>
                </div>
              )}
            </section>
          ) : workspaceView === "browser" ? (
            <BrowserPage
              model={{
                localProjectId: selectedProjectId,
                mode: browserMode,
                state: browserState,
                address: browserAddress,
                busy: browserBusy,
                screenshot: browserScreenshot,
                attachedEndpoint,
                attachedTargets,
                selectedAttachedTargetId,
                attachedState,
                error
              }}
              actions={{
                onModeChange: (mode) => {
                  setBrowserMode(mode);
                  setBrowserScreenshot(null);
                },
                onNavigate: (action) => void runBrowserNavigation(action),
                onAddressChange: setBrowserAddress,
                onAddressSubmit: () => void navigateCurrentBrowser(),
                onToggleTakeover: () => void toggleBrowserTakeover(),
                onCreatePage: (profileId) => void createManagedBrowserPage(profileId),
                onSelectPage: (pageId) => void selectManagedBrowserPage(pageId),
                onClosePage: (pageId) => void closeManagedBrowserPage(pageId),
                onCreateProfile: (input) => void createManagedBrowserProfile(input),
                onUpdateProfile: (profileId, input) =>
                  void updateManagedBrowserProfile(profileId, input),
                onDeleteProfile: (profileId) => void deleteManagedBrowserProfile(profileId),
                onCaptureScreenshot: () => void captureBrowserScreenshot(),
                onRetryOperation: (operationId) =>
                  void retryManagedBrowserOperation(operationId),
                onCloseScreenshot: () => setBrowserScreenshot(null),
                onAttachedEndpointChange: setAttachedEndpoint,
                onDiscoverAttachedTargets: () => void discoverAttachedTargets(),
                onSelectedAttachedTargetChange: setSelectedAttachedTargetId,
                onToggleAttachedConnection: () => void toggleAttachedConnection(),
                onDismissError: () => setError(null)
              }}
              viewportRef={browserViewportRef}
              addressRef={browserAddressRef}
            />
          ) : workspaceView === "chat" ? (
            <ChatPage
              selectedProject={selectedProject}
              messages={chatMessages}
              activeRequestId={activeRequestId}
              includeFileContext={includeFileContext}
              selectedFilePath={selectedFilePath}
              readResult={readResult}
              draft={draft}
              authStatus={state.authStatus}
              models={models}
              selectedModelCode={selectedModelCode}
              executionEnvironment={executionEnvironment}
              modelsLoading={modelsLoading}
              agents={agentWorkspace.model.agents}
              agentsLoading={agentWorkspace.model.agentsLoading}
              selectedAgentId={agentWorkspace.model.selectedAgentId}
              selectedAgent={agentWorkspace.model.selectedAgent}
              agentVersion={conversationAgentVersion}
              projectContext={projectContext}
              selectedProjectSkillId={selectedProjectSkillId}
              editingMessageId={editingMessageId}
              error={error}
              onChooseProject={() => void chooseProject()}
              onAttachProjectFolder={() => {
                if (selectedProject) void attachProjectFolder(selectedProject.localProjectId);
              }}
              onDraftChange={setDraft}
              onSend={() => void sendMessage()}
              onRetry={retryMessage}
              onEditMessage={(messageId) => {
                const message = chatMessages.find(
                  (candidate) =>
                    candidate.id === messageId && candidate.role === "user"
                );
                if (!message) return;
                setEditingMessageId(message.id);
                setDraft(message.content);
                setError(null);
              }}
              onCancelEdit={() => {
                setEditingMessageId(null);
                setDraft("");
              }}
              onStop={() => void stopMessage()}
              onModelChange={setSelectedModelCode}
              onExecutionEnvironmentChange={setExecutionEnvironment}
              onAgentChange={(agentId) => {
                agentWorkspace.actions.onSelectAgent(agentId);
                const nextAgent = agentWorkspace.model.agents.find(
                  (agent) => agent.id === agentId
                );
                const preferredModel = nextAgent?.defaultModelCode;
                if (preferredModel && models.some((model) => model.code === preferredModel)) {
                  setSelectedModelCode(preferredModel);
                }
                if (nextAgent?.executionPolicy.environment) {
                  setExecutionEnvironment(nextAgent.executionPolicy.environment);
                }
              }}
              onUpdateAgent={() => {
                const currentAgent = agentWorkspace.model.selectedAgent;
                if (!agentVersionKey || !currentAgent) return;
                setAdoptedAgentRevisions((current) => ({
                  ...current,
                  [agentVersionKey]: currentAgent.revision
                }));
              }}
              onProjectSkillChange={setSelectedProjectSkillId}
              onIncludeFileContextChange={setIncludeFileContext}
              onDismissError={() => setError(null)}
            />
          ) : workspaceView === "approvals" ? (
            <ApprovalPage
              approvals={visibleApprovals}
              policies={visibleApprovalPolicies}
              projectName={selectedProject?.displayName ?? null}
              busyPolicyId={busyApprovalPolicyId}
              onRevokePolicy={(policyId) => void revokeApprovalPolicy(policyId)}
            />
          ) : workspaceView === "terminal" ? (
            <section className="terminal-pane">
              <div className="terminal-toolbar">
                <div className="terminal-command">
                  <span>$</span>
                  <input
                    value={processCommand}
                    placeholder="输入命令，例如 pnpm dev"
                    aria-label="本地进程命令"
                    disabled={!selectedProject || processBusy}
                    onChange={(event) => setProcessCommand(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void startProjectProcess();
                    }}
                  />
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!selectedProject || !processCommand.trim() || processBusy}
                    onClick={() => void startProjectProcess()}
                  >
                    {processBusy ? <LoaderCircle className="spin" size={14} /> : <SquareTerminal size={14} />}
                    运行
                  </button>
                </div>
              </div>
              <div className="terminal-layout">
                <div className="process-list">
                  {processes.map((process) => (
                    <button
                      key={process.processId}
                      className={process.processId === selectedProcess?.processId ? "active" : ""}
                      type="button"
                      onClick={() => setSelectedProcessId(process.processId)}
                    >
                      <span className={`process-status ${process.status}`} />
                      <strong>{process.executable}</strong>
                      <small>{process.status}{process.exitCode === null ? "" : ` · ${process.exitCode}`}</small>
                    </button>
                  ))}
                  {processes.length === 0 && <div className="process-empty">暂无本地进程</div>}
                </div>
                <div className="terminal-output">
                  <div className="terminal-output-header">
                    <span>{selectedProcess ? [selectedProcess.executable, ...selectedProcess.args].join(" ") : "Terminal"}</span>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!selectedProcess || selectedProcess.status !== "running" || processBusy}
                      onClick={() => void stopProjectProcess()}
                    ><Square size={12} fill="currentColor" />停止</button>
                  </div>
                  <pre>{selectedProcess
                    ? `${selectedProcess.stdout}${selectedProcess.stderr ? `\n[stderr]\n${selectedProcess.stderr}` : ""}`
                    : "运行命令后，输出将显示在这里。"}</pre>
                  {selectedProcess?.outputTruncated && <span className="output-truncated">较早输出已截断</span>}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={18} /><span>{error}</span>
                  <button type="button" title="关闭" onClick={() => setError(null)}><X size={14} /></button>
                </div>
              )}
            </section>
          ) : workspaceView === "versions" && readResult ? (
            <section className="versions-pane">
              <div className="versions-header">
                <div><span className="eyebrow">Local Version History</span><h2>文件版本比较</h2><p>{selectedFilePath}</p></div>
                <div className="versions-actions">
                  <button className="secondary-button" type="button" onClick={() => setWorkspaceView("files")}>返回编辑</button>
                  <button className="secondary-button" type="button" disabled={!selectedFileVersion || fileVersionBusy} onClick={() => void exportSelectedProjectFile(selectedFileVersion?.versionId)}><FolderOpen size={13} />导出版本</button>
                  <button className="primary-button" type="button" disabled={!selectedFileVersion || fileVersionBusy} onClick={() => void restoreFileVersion()}>{fileVersionBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}恢复此版本</button>
                </div>
              </div>
              <div className="versions-layout">
                <div className="version-list">
                  {fileVersions.map((version) => <button key={version.versionId} type="button" className={selectedFileVersion?.versionId === version.versionId ? "active" : ""} onClick={() => void selectFileVersion(version.versionId)}>
                    <strong>{fileVersionSourceLabel(version.source)}</strong><time>{new Date(version.createdAt).toLocaleString()}</time><span>{version.bytes} bytes · {version.sha256.slice(7, 15)}</span>
                  </button>)}
                  {fileVersions.length === 0 && <div className="version-empty"><RefreshCw size={22} /><span>保存文件后会在这里记录版本</span></div>}
                </div>
                <div className="version-comparison">
                  {selectedFileVersion ? <DiffPreview before={selectedFileVersion.text} after={readResult.text} /> : <div className="version-empty"><GitBranch size={25} /><span>选择一个历史版本进行比较</span></div>}
                </div>
              </div>
              {error && <div className="error-banner" role="alert"><CircleAlert size={18} /><span>{error}</span><button type="button" title="关闭" onClick={() => setError(null)}><X size={14} /></button></div>}
            </section>
          ) : workspaceView === "changes" && readResult ? (
            <section className="changes-pane">
              <div className="changes-header">
                <div>
                  <span className="eyebrow">本机审批 · R1</span>
                  <h2>确认文件更改</h2>
                  <p>{selectedFilePath}</p>
                </div>
                <div className="changes-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={savingFile}
                    onClick={() => setWorkspaceView("files")}
                  >
                    返回编辑
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={savingFile || !hasFileChanges}
                    onClick={() => void saveProjectFile()}
                  >
                    {savingFile
                      ? <LoaderCircle className="spin" size={15} />
                      : <Save size={15} />}
                    {newFileDraft ? "确认并创建" : "确认并保存"}
                  </button>
                </div>
              </div>
              <DiffPreview before={readResult.text} after={fileDraft} />
              {error && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={18} /><span>{error}</span>
                  <button type="button" title="关闭" onClick={() => setError(null)}><X size={14} /></button>
                </div>
              )}
            </section>
          ) : (
            <FilesPage
              model={{
                selectedProject,
                projectFiles,
                treeLoading,
                searchQuery,
                searchResult,
                searching,
                selectedFilePath,
                readResult,
                assetPreview,
                fileDraft,
                loading,
                savingFile,
                fileVersionBusy,
                newFileDraft,
                hasFileChanges,
                error
              }}
              actions={{
                onChooseProject: () => void chooseProject(),
                onRefreshFiles: () => void refreshProjectFiles(),
                onCreateFile: prepareNewProjectFile,
                onSearch: setSearchQuery,
                onSelectFile: selectProjectFile,
                onExportFile: () => void exportSelectedProjectFile(),
                onOpenVersions: () => void openFileVersions(),
                onReviewChanges: reviewProjectFileChanges,
                onDraftChange: setFileDraft,
                onDismissError: () => setError(null)
              }}
            />
          )}

        </div>
      </main>
      <ProjectCreateDialog
        open={projectDialogOpen}
        busy={projectActionBusy}
        onClose={() => { if (!projectActionBusy) setProjectDialogOpen(false); }}
        onCreate={(name, attachFolder) => void createProject(name, attachFolder)}
      />
    </div>
  );
}

function DiffPreview({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => createDiffPreview(before, after), [before, after]);
  const added = lines.filter((line) => line.kind === "added").length;
  const removed = lines.filter((line) => line.kind === "removed").length;
  return (
    <div className="diff-shell">
      <div className="diff-summary">
        <span className="diff-added">+{added}</span>
        <span className="diff-removed">−{removed}</span>
        <span>保存前请检查本机文件变更</span>
      </div>
      <div className="diff-view" role="region" aria-label="文件更改 Diff">
        {lines.map((line, index) => (
          <div className={`diff-line ${line.kind}`} key={`${line.kind}:${index}`}>
            <span>{line.beforeLine ?? ""}</span>
            <span>{line.afterLine ?? ""}</span>
            <code>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}{line.text}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function updateAssistantMessage(
  state: Record<string, ChatMessage[]>,
  projectId: string,
  requestId: string,
  update: (message: ChatMessage) => ChatMessage
) {
  return {
    ...state,
    [projectId]: (state[projectId] ?? []).map((message) =>
      message.id === `assistant:${requestId}` ? update(message) : message
    )
  };
}

function updateChatToolActivity(
  tools: NonNullable<ChatMessage["tools"]>,
  event: Extract<
    ProjectChatEvent,
    { type: "tool_started" | "tool_completed" | "tool_error" }
  >
) {
  const next = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    title: event.title,
    status:
      event.type === "tool_started"
        ? "running" as const
        : event.type === "tool_completed"
          ? "completed" as const
          : "error" as const,
    ...(event.type === "tool_completed"
      ? { detail: event.summary }
      : event.type === "tool_error"
        ? { detail: event.message }
        : {})
  };
  const existingIndex = tools.findIndex(
    (tool) => tool.toolCallId === event.toolCallId
  );
  if (existingIndex < 0) return [...tools, next];
  return tools.map((tool, index) => index === existingIndex ? next : tool);
}

function upsertWorkflowRun(
  runs: DesktopWorkflowRun[],
  run: DesktopWorkflowRun
): DesktopWorkflowRun[] {
  return [
    run,
    ...runs.filter((candidate) => candidate.runId !== run.runId)
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function fileVersionSourceLabel(source: ProjectFileVersionSummary["source"]): string {
  if (source === "created") return "创建版本";
  if (source === "restored") return "恢复版本";
  if (source === "baseline") return "保存前版本";
  return "已保存版本";
}

function isPreviewableAsset(relativePath: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm|pdf)$/i.test(relativePath);
}
