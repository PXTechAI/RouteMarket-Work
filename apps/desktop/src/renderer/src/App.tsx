import { tr } from "./i18n";
import "./app/app-shell.scss";
import "./features/files/file-history.scss";
import "./features/terminal/terminal.scss";
import {
  CircleAlert,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  LoaderCircle,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Redo2,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AttachedBrowserState,
  AttachedBrowserTarget,
  ChatModel,
  DesktopChatAttachment,
  DesktopExtensionPage,
  DesktopExtensionSummary,
  DesktopWorkflowDraft,
  DesktopWorkflowDraftSummary,
  DesktopWorkflowNodeRegistry,
  DesktopWorkflowRun,
  DesktopWorkflowRunEvent,
  ManagedProcessSummary,
  ManagedBrowserState,
  LocalApiGatewayState,
  LocalProjectChatMessage,
  LocalProjectChatSummary,
  LocalTriggerSummary,
  LocalTriggerKind,
  LocalSkillImportKind,
  LocalSkillInstallReceipt,
  McpServerSummary,
  NativeAppConnectorSummary,
  ProjectChatEvent,
  ProjectChatRequest,
  WebSearchMode,
  ProjectContext,
  ProjectArtifactPreview,
  ProjectFileVersion,
  ProjectFileVersionSummary,
  ProjectFileTree,
  ProjectSearchResult,
  ProjectSummary,
  ReadResult,
  RouteMarketWorkApi,
  WorkState,
} from "../../shared/desktop-api";
import { resolveDesktopAgentSkillAvailability } from "../../shared/agent-skill-availability";
import { resolveAvailableWebSearchMode } from "./features/chat/web-search-mode";
import { createDiffPreview } from "./diff";
import { parseCommandLine } from "./command-line";
import { AppRail } from "./app/AppRail";
import { AppTitleBar } from "./app/AppTitleBar";
import { OutputMenu } from "./app/OutputMenu";
import { buildConversationFileTree } from "./app/output-menu-data";
import { AuthGate } from "./app/AuthGate";
import { ActivityMenu } from "./app/ActivityMenu";
import { AppDialog } from "./app/AppDialog";
import { signedOutWorkState } from "./app/auth-state";
import { withWorkerOffline, workerStatusLabel } from "./app/connection-status";
import { AgentPage } from "./features/agent/AgentPage";
import { useAgentWorkspace } from "./features/agent/useAgentWorkspace";
import { ApprovalPage } from "./features/approvals/ApprovalPage";
import { BrowserPage } from "./features/browser/BrowserPage";
import { ChatPage } from "./features/chat/ChatPage";
import { resolveConversationAgentVersion } from "./features/chat/agent-version";
import { messagesForEditedUserResend } from "./features/chat/chat-edit";
import { readProjectModelPreference, writeProjectModelPreference } from "./features/chat/model-preference";
import type { ChatMessage } from "./features/chat/types";
import { FilesPage } from "./features/files/FilesPage";
import { MediaGenerationPage } from "./features/media/MediaGenerationPage";
import { ExtensionFrame } from "./features/extensions/ExtensionFrame";
import { McpPage } from "./features/mcp/McpPage";
import { LocalSkillPackagesPanel } from "./features/project-skills/LocalSkillPackagesPanel";
import { SettingsPage, type SettingsView, type ToolsCategory } from "./features/settings/SettingsPage";
import { useLocale } from "./i18n";
import { localizeWorkflowNodeDefinition } from "./features/workflow/workflow-node-i18n";
import { ProjectCreateDialog } from "./features/projects/ProjectCreateDialog";
import { ProjectEditDialog } from "./features/projects/ProjectEditDialog";
import {
  projectFolderAvailable,
  projectFolderMessage,
  projectFolderStatus,
} from "./features/projects/project-folder-status";
import { WorkflowPage } from "./features/workflow/WorkflowPage";
import {
  connectWorkflowDraftNodes,
  duplicateWorkflowDraftNodes,
  layoutWorkflowDraft,
  moveWorkflowDraftNodes,
  removeWorkflowDraftEdges,
  removeWorkflowDraftNodes,
} from "./features/workflow/workflow-draft-graph";
import {
  createWorkflowDraftHistory,
  recordWorkflowDraftHistory,
  redoWorkflowDraftHistory,
  undoWorkflowDraftHistory,
} from "./features/workflow/workflow-draft-history";
import type { WorkflowPanel } from "./features/workflow/types";
import { workflowSkillById } from "./features/workflow/workflow-skill-registry";
import {
  shouldRevealWorkflowBrowser,
  workflowRunBrowserResumeUrl,
  workflowRunNeedsBrowserTakeover,
} from "./features/workflow/workflow-run-visibility";
type WorkspaceView =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "files"
  | "changes"
  | "versions"
  | "terminal"
  | "approvals"
  | "browser"
  | "workflow"
  | "settings"
  | `plugin:${string}:${string}`;
type WorkbenchPanel = "files" | "conversation-files" | "terminal" | "browser" | null;
type HeaderChatDialog = "rename" | "move" | "delete" | null;

function workspaceSupportsWorkbench(view: WorkspaceView): boolean {
  return view === "chat" || view === "workflow";
}
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
    creditsBalance: 1280.75,
    activeSpaceId: "personal:account_preview",
    spaces: [
      { id: "personal:account_preview", name: "个人空间", kind: "personal", teamId: null, avatarUrl: null, role: null },
      {
        id: "team_preview",
        name: "Good Team GGGGGGGGG!",
        kind: "team",
        teamId: "team_preview",
        avatarUrl: null,
        role: "owner",
      },
    ],
    membership: {
      planCode: "pro",
      planName: "RouteMarket Pro",
      status: "active",
      expiresAt: "2027-07-18T00:00:00.000Z",
    },
  },
  authError: null,
  projects: [
    {
      localProjectId: "project_preview",
      displayName: "RouteMarket-Desktop",
      hasFolder: true,
      folderStatus: "available",
      rootFingerprint: "sha256:preview",
      folders: [
        {
          folderId: "sha256:preview",
          name: "RouteMarket-Desktop",
          path: "C:/Projects/RouteMarket-Desktop",
          status: "available",
          primary: true,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
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
      updatedAt: "2026-07-18T08:00:00.000Z",
    },
    {
      policyId: "policy_preview_deny",
      capability: "local.process.start",
      projectId: "project_preview",
      effect: "deny",
      createdAt: "2026-07-18T08:05:00.000Z",
      updatedAt: "2026-07-18T08:05:00.000Z",
    },
  ],
};
const previewModels: ChatModel[] = [
  {
    code: "gpt-5",
    displayName: "GPT-5",
    source: "routemarket",
    providerId: null,
    providerName: "RouteMarket",
    category: "reasoning",
    supportsTools: true,
    supportsNativeWebSearch: true,
    supportsVision: true,
    supportsStream: true,
    supportsReasoningSummary: true,
    preferredChatProtocol: "openai_responses",
    platformPricing: {
      primaryCredit: 0.8,
      components: [
        { displayName: "输入", billingMetric: "input_tokens", unitLabel: "1M Token", unitSize: 1_000_000, salePrice: 0.8 },
        { displayName: "输出", billingMetric: "output_tokens", unitLabel: "1M Token", unitSize: 1_000_000, salePrice: 6.4 },
      ],
    },
  },
  {
    code: "claude-sonnet",
    displayName: "Claude Sonnet",
    source: "routemarket",
    providerId: null,
    providerName: "RouteMarket",
    category: "chat",
    supportsTools: true,
    supportsNativeWebSearch: false,
    supportsVision: true,
    supportsStream: true,
    supportsReasoningSummary: false,
    preferredChatProtocol: null,
    platformPricing: {
      primaryCredit: 1.2,
      components: [
        { displayName: "输入", billingMetric: "input_tokens", unitLabel: "1M Token", unitSize: 1_000_000, salePrice: 1.2 },
        { displayName: "输出", billingMetric: "output_tokens", unitLabel: "1M Token", unitSize: 1_000_000, salePrice: 6 },
      ],
    },
  },
];
function getPreviewAgents() {
  return [
    {
      id: "agent_project_builder",
      revision: 1,
      origin: "template" as const,
      forkSourceId: "fork_preview_builder",
      name: "Project Builder",
      description: tr("ui.5082bcd44489"),
      avatarUrl: "emoji:🛠️|bg:#4f46e5",
      systemPrompt: "Work through the project task carefully and verify every concrete change.",
      greeting: tr("ui.dd2eb73944ee"),
      starterQuestions: [tr("ui.df922756a85d"), tr("ui.bfe128918c39"), tr("ui.8f6c15d51af7")],
      tags: ["project", "development"],
      defaultModelCode: "gpt-5",
      skills: [
        {
          skillId: "review",
          name: "Code review",
          version: 2,
          source: "local" as const,
          enabled: true,
        },
        {
          skillId: "research",
          name: "Cloud research",
          version: 1,
          source: "cloud" as const,
          enabled: true,
        },
        {
          skillId: "legacy",
          name: "Legacy formatter",
          version: 1,
          source: "local" as const,
          enabled: false,
        },
      ],
      toolPermissions: [],
      executionPolicy: { environment: "local" as const, approvalMode: "risky_only" as const },
      tools: [],
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    {
      id: "agent_browser_operator",
      revision: 1,
      origin: "personal" as const,
      forkSourceId: null,
      name: "Browser Operator",
      description: tr("ui.13c0ba377183"),
      avatarUrl: "emoji:🌐|bg:#0ea5e9",
      systemPrompt: "Use browser tools deliberately and report what was actually observed.",
      greeting: tr("ui.0711390ddab4"),
      starterQuestions: [tr("ui.1053f0cd205f"), tr("ui.345f4aa5dadc")],
      tags: ["browser"],
      defaultModelCode: "claude-sonnet",
      skills: [],
      toolPermissions: [{ type: "browser" }],
      executionPolicy: { environment: "local" as const, approvalMode: "risky_only" as const },
      tools: [{ type: "browser" }],
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
  ];
}
let previewCurrentState = previewState;
let previewChats: LocalProjectChatSummary[] = [];
const previewMessages = new Map<string, LocalProjectChatMessage[]>();
const previewChatListeners = new Set<(event: ProjectChatEvent) => void>();
const previewWorkflowRunListeners = new Set<(event: DesktopWorkflowRunEvent) => void>();
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
  operations: [
    {
      operationId: "browser_op_failed",
      localProjectId: "project_preview",
      pageId: "page_preview",
      source: "workflow",
      kind: "click",
      status: "failed",
      title: tr("ui.21c2547386d0"),
      detail: "button[data-action=publish]",
      url: "https://example.com/editor",
      startedAt: "2026-07-18T08:12:30.000Z",
      finishedAt: "2026-07-18T08:12:31.000Z",
      error: "Browser element not found",
      retryable: true,
      retryOfOperationId: null,
    },
    {
      operationId: "browser_op_agent",
      localProjectId: "project_preview",
      pageId: "page_preview",
      source: "agent",
      kind: "navigate",
      status: "succeeded",
      title: tr("ui.22d040b33dbe"),
      detail: "https://example.com/editor",
      url: "https://example.com/editor",
      startedAt: "2026-07-18T08:12:20.000Z",
      finishedAt: "2026-07-18T08:12:22.000Z",
      error: null,
      retryable: true,
      retryOfOperationId: null,
    },
    {
      operationId: "browser_op_user",
      localProjectId: "project_preview",
      pageId: "page_preview",
      source: "user",
      kind: "screenshot",
      status: "succeeded",
      title: tr("ui.963479826cf8"),
      detail: tr("ui.b2e23403971b"),
      url: "https://example.com/editor",
      startedAt: "2026-07-18T08:10:00.000Z",
      finishedAt: "2026-07-18T08:10:01.000Z",
      error: null,
      retryable: true,
      retryOfOperationId: null,
    },
  ],
  profiles: [
    {
      profileId: "profile_default",
      localProjectId: "project_preview",
      name: "Default",
      userAgent: "",
      proxyRules: "",
      proxyBypassRules: "<local>",
      persistence: "persistent",
    },
  ],
  pages: [
    {
      pageId: "page_preview",
      profileId: "profile_default",
      localProjectId: "project_preview",
      title: "",
      url: "about:blank",
      loading: false,
      crashed: false,
    },
  ],
};
let previewAttachedBrowserState: AttachedBrowserState = {
  connected: false,
  endpoint: null,
  target: null,
  error: null,
};
let previewMcpServers: McpServerSummary[] = [];
let previewProjectSkills: LocalSkillInstallReceipt[] = [
  {
    localProjectId: "project_preview",
    skillId: "review",
    name: "Code review",
    description: "Review project changes safely.",
    version: "1.0.0",
    packageDigest: `sha256:${"a".repeat(64)}`,
    currentPackageDigest: `sha256:${"a".repeat(64)}`,
    source: "local_directory" as const,
    sourceLabel: "Project folder",
    publisherFingerprint: null,
    installedAt: null,
    updatedAt: null,
    status: "ready" as const,
    managed: false,
    relativePath: ".routemarket/skills/review/SKILL.md",
    permissions: ["project.read"],
    operations: ["invoke"],
  },
];
let previewLocalTriggers: LocalTriggerSummary[] = [];
let previewWorkflowDraft: DesktopWorkflowDraft | null = null;
let previewWorkflowRuns: DesktopWorkflowRun[] = [];
let previewLocalApiState: LocalApiGatewayState = {
  enabled: false,
  port: 17480,
  running: false,
  baseUrl: "http://127.0.0.1:17480/v1",
  token: "rm_local_preview",
  requestCount: 0,
  lastRequestAt: null,
  lastError: null,
  routes: [],
  targetHealth: [],
};
const previewApi: RouteMarketWorkApi = {
  onRuntimeError: () => () => undefined,
  async getPreferences() {
    return {};
  },
  async updatePreferences(patch) {
    return patch;
  },
  async setLocale() {},
  async executeMenuCommand() {},
  async setTitleBarTheme() {},
  async setWorkbenchExpanded(expanded) {
    return { expanded, addedWidth: 0 };
  },
  async getState() {
    return previewCurrentState;
  },
  async getAppInfo() {
    return { version: "0.2.0", buildEnvironment: "development", updateEnabled: false, updateChannel: "stable" };
  },
  async checkForUpdates() {
    return false;
  },
  async listMarketplaceCatalog() {
    return { schemaVersion: 1, revision: `sha256:${"0".repeat(64)}`, items: [] };
  },
  async listDesktopExtensions() {
    return [];
  },
  async refreshDesktopExtensions() {
    return [];
  },
  async openDesktopExtensionPage() {
    return desktopBridgeUnavailable();
  },
  async pickDesktopExtensionFile() {
    return { canceled: true, path: null };
  },
  async listMarketplacePluginInstallations() {
    return [];
  },
  async prepareMarketplacePluginInstall() {
    return desktopBridgeUnavailable();
  },
  async prepareLocalPluginInstall() {
    return null;
  },
  async cancelMarketplacePluginInstall() {
    return false;
  },
  async installMarketplacePlugin() {
    return desktopBridgeUnavailable();
  },
  async setMarketplacePluginEnabled() {
    return desktopBridgeUnavailable();
  },
  async removeMarketplacePlugin() {
    return desktopBridgeUnavailable();
  },
  async getLocalDataInfo() {
    return {
      dataPath: "C:\\Users\\Preview\\AppData\\Roaming\\RouteMarket Work\\worker",
      scope: "account-space",
      accountName: "RouteMarket Preview",
      spaceName: "Personal Space",
      storedAccountCount: 1,
      storedSpaceCount: 1,
      allScopesBytes: 12845056,
      totalBytes: 12845056,
      databaseBytes: 9437184,
      databaseHealth: "healthy",
      lastRecoveredAt: null,
    };
  },
  async listLocalDataScopes() {
    return [
      {
        scopeId: "preview_scope",
        accountName: "RouteMarket Preview",
        spaceName: "Personal Space",
        spaceKind: "personal",
        lastUsedAt: new Date().toISOString(),
        totalBytes: 12845056,
        current: true,
      },
    ];
  },
  async removeLocalDataScope() {
    return false;
  },
  async showLocalData() {},
  async exportLocalData() {
    return { exportedPath: "RouteMarket-Work-Backup.sqlite" };
  },
  async clearLocalData() {
    return false;
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
      account: undefined,
    };
    return previewCurrentState;
  },
  async switchSpace(spaceId) {
    if (previewCurrentState.account) {
      previewCurrentState = {
        ...previewCurrentState,
        account: { ...previewCurrentState.account, activeSpaceId: spaceId },
      };
    }
    return previewCurrentState;
  },
  async removeApprovalPolicy(policyId) {
    const before = previewCurrentState.approvalPolicies.length;
    previewCurrentState = {
      ...previewCurrentState,
      approvalPolicies: previewCurrentState.approvalPolicies.filter((policy) => policy.policyId !== policyId),
    };
    return previewCurrentState.approvalPolicies.length !== before;
  },
  async chooseProject() {
    return null;
  },
  async chooseWorkflowOutputDirectory() {
    return "C:/Output";
  },
  async createProject(displayName) {
    const project: ProjectSummary = {
      localProjectId: `project_preview_${Date.now()}`,
      displayName,
      hasFolder: false,
      rootFingerprint: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    previewCurrentState = { ...previewCurrentState, projects: [project, ...previewCurrentState.projects] };
    return project;
  },
  async renameProject(localProjectId, displayName) {
    const project = previewCurrentState.projects.find((item) => item.localProjectId === localProjectId);
    if (!project) throw new Error("Project not found");
    const renamed = { ...project, displayName, updatedAt: new Date().toISOString() };
    previewCurrentState = {
      ...previewCurrentState,
      projects: previewCurrentState.projects.map((item) => (item.localProjectId === localProjectId ? renamed : item)),
    };
    return renamed;
  },
  async attachProjectFolder(localProjectId) {
    const project = previewCurrentState.projects.find((item) => item.localProjectId === localProjectId);
    if (!project) return null;
    const folderId = `sha256:preview:${Date.now()}`;
    const linked = {
      ...project,
      hasFolder: true,
      folderStatus: "available" as const,
      rootFingerprint: project.rootFingerprint || folderId,
      folders: [
        ...(project.folders ?? []),
        {
          folderId,
          name: "RouteMarket-Preview",
          path: "C:/Projects/RouteMarket-Preview",
          status: "available" as const,
          primary: (project.folders?.length ?? 0) === 0,
        },
      ],
    };
    previewCurrentState = {
      ...previewCurrentState,
      projects: previewCurrentState.projects.map((item) => (item.localProjectId === localProjectId ? linked : item)),
    };
    return linked;
  },
  async removeProjectFolder(localProjectId, folderId) {
    const project = previewCurrentState.projects.find((item) => item.localProjectId === localProjectId);
    if (!project) throw new Error("Project not found");
    const folders = (project.folders ?? [])
      .filter((folder) => folder.folderId !== folderId)
      .map((folder, index) => ({ ...folder, primary: index === 0 }));
    const updated = {
      ...project,
      folders,
      hasFolder: folders.length > 0,
      folderStatus: folders.length > 0 ? ("available" as const) : ("unlinked" as const),
      rootFingerprint: folders[0]?.folderId ?? "",
    };
    previewCurrentState = {
      ...previewCurrentState,
      projects: previewCurrentState.projects.map((item) => (item.localProjectId === localProjectId ? updated : item)),
    };
    return updated;
  },
  async openProjectFolder() {
    return true;
  },
  async deleteProject(localProjectId) {
    previewCurrentState = {
      ...previewCurrentState,
      projects: previewCurrentState.projects.filter((item) => item.localProjectId !== localProjectId),
    };
    return true;
  },
  async getProjectContext() {
    return {
      instructions: {
        relativePath: "AGENTS.md",
        text: "Keep changes focused and run tests.",
        truncated: false,
      },
      readme: null,
      settings: { defaultAgent: null, defaultModel: null, cloudProjectId: null, ignore: [] },
      skills: [
        {
          id: "review",
          name: "Code review",
          description: "Review project changes safely.",
          relativePath: ".routemarket/skills/review/SKILL.md",
        },
      ],
    };
  },
  async listProjectSkills() {
    return previewProjectSkills;
  },
  async chooseAndInstallProjectSkill(localProjectId) {
    const installed = {
      localProjectId,
      skillId: "writing-assistant",
      name: "Writing assistant",
      description: "Improve project writing with reusable instructions.",
      version: "1.0.0",
      packageDigest: `sha256:${"b".repeat(64)}`,
      currentPackageDigest: `sha256:${"b".repeat(64)}`,
      source: "local_archive" as const,
      sourceLabel: "writing-assistant.zip",
      publisherFingerprint: null,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ready" as const,
      managed: true,
      relativePath: ".routemarket/skills/writing-assistant/SKILL.md",
      permissions: ["project.read"],
      operations: ["invoke"],
    };
    previewProjectSkills = [...previewProjectSkills.filter((skill) => skill.skillId !== installed.skillId), installed];
    return installed;
  },
  async listDownloadableCloudSkills() {
    return [
      {
        skillId: "writing-assistant",
        version: "1.0.0",
        versionId: "version_preview_writing",
        name: "Writing assistant",
        description: "Improve project writing with reusable instructions.",
      },
    ];
  },
  async installCloudSkill(localProjectId, skillId) {
    const installed: LocalSkillInstallReceipt = {
      localProjectId,
      skillId,
      name: "Writing assistant",
      description: "Improve project writing with reusable instructions.",
      version: "1.0.0",
      packageDigest: `sha256:${"b".repeat(64)}`,
      currentPackageDigest: `sha256:${"b".repeat(64)}`,
      source: "web_library",
      sourceLabel: "writing-assistant-1.0.0.zip",
      publisherFingerprint: null,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ready",
      managed: true,
      relativePath: `.routemarket/skills/${skillId}/SKILL.md`,
      permissions: ["project.read"],
      operations: ["invoke"],
    };
    previewProjectSkills = [...previewProjectSkills.filter((skill) => skill.skillId !== installed.skillId), installed];
    return installed;
  },
  async removeInstalledProjectSkill(_localProjectId, skillId) {
    previewProjectSkills = previewProjectSkills.filter((skill) => skill.skillId !== skillId);
    return true;
  },
  async getWorkflowNodeRegistry() {
    const definitions = [
      {
        executorKey: "local.fs.read",
        title: tr("ui.dc995cddfa91"),
        description: tr("ui.5bff191f3e7c"),
        portability: "portable" as const,
      },
      {
        executorKey: "local.browser.navigate",
        title: tr("ui.22d040b33dbe"),
        description: tr("ui.58d8f1ad8243"),
        portability: "device_bound" as const,
      },
      {
        executorKey: "local.browser.product_extract",
        title: tr("ui.7a1ef038a396"),
        description: tr("ui.9924801cad0d"),
        portability: "device_bound" as const,
      },
      {
        executorKey: "local.data.csv_export",
        title: tr("ui.d550b7bc237a"),
        description: tr("ui.1092ba3bb83f"),
        portability: "device_bound" as const,
      },
      {
        executorKey: "local.app.vscode.open",
        title: "Visual Studio Code",
        description: tr("ui.6c9b42d40961"),
        portability: "requires_connector" as const,
      },
    ].map((item) => ({
      ...item,
      definitionVersion: 1,
      source: item.executorKey.startsWith("local.app") ? ("local_extension" as const) : ("desktop_builtin" as const),
      executionTarget: "desktop" as const,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [item.executorKey],
      definitionHash: `sha256:${"1".repeat(64)}`,
      available: true,
      blockedReason: null,
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
              kind: "file",
            },
          ],
        },
        {
          name: "README.md",
          relativePath: "README.md",
          kind: "file",
        },
      ],
      totalEntries: 3,
      truncated: false,
    };
  },
  async searchProject(_localProjectId, query) {
    return {
      query,
      matches: query.trim()
        ? [
            {
              relativePath: "README.md",
              matchKind: "content" as const,
              line: 1,
              column: 3,
              preview: "# RouteMarket Work",
            },
          ]
        : [],
      filesScanned: 2,
      truncated: false,
    };
  },
  async readProjectFile(localProjectId, relativePath) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      text: "# RouteMarket Work\n\nLocal-first AI workspace for projects, workflows, agents and browser tasks.\n",
      bytesRead: 96,
      truncated: false,
      encoding: "utf8",
      sha256: `sha256:${"0".repeat(64)}`,
    };
  },
  async readProjectAsset(localProjectId, relativePath) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      bytesRead: 8,
    };
  },
  async previewProjectArtifact(localProjectId, relativePath) {
    return {
      kind: "media" as const,
      providerId: "core.media" as const,
      uri: `project://${localProjectId}/${relativePath}`,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      bytesRead: 8,
    };
  },
  async chooseChatAttachments() {
    return [
      {
        id: `attachment_preview_${Date.now()}`,
        name: "requirements.md",
        mimeType: "text/markdown",
        size: 1280,
        kind: "file",
        textExcerpt: "# Requirements",
        assetId: "asset_preview_requirements",
        downloadUrl: "https://console.routemarket.ai/api/assets/preview",
        previewUrl: null,
      },
    ];
  },
  async uploadChatAttachments(files) {
    return files.map((file, index) => ({
      id: `attachment_preview_upload_${Date.now()}_${index}`,
      name: file.name,
      mimeType: file.mimeType || "application/octet-stream",
      size: file.size,
      kind: file.mimeType.startsWith("image/") ? "image" as const : "file" as const,
      textExcerpt: null,
      assetId: `asset_preview_upload_${index}`,
      downloadUrl: "https://example.invalid/attachment",
      previewUrl: null
    }));
  },
  async discardChatAttachment() {},
  async writeProjectFile(localProjectId, relativePath, text, expectedSha256) {
    return {
      uri: `project://${localProjectId}/${relativePath}`,
      text,
      bytesRead: new TextEncoder().encode(text).byteLength,
      truncated: false,
      encoding: "utf8",
      sha256: expectedSha256,
      changed: true,
      previousSha256: expectedSha256,
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
      created: true as const,
    };
  },
  async listProjectFileVersions(localProjectId, relativePath) {
    return [
      {
        versionId: "version_preview",
        localProjectId,
        relativePath,
        sha256: `sha256:${"2".repeat(64)}`,
        bytes: 74,
        source: "baseline" as const,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
    ];
  },
  async readProjectFileVersion(localProjectId, relativePath, versionId) {
    return {
      versionId,
      localProjectId,
      relativePath,
      sha256: `sha256:${"2".repeat(64)}`,
      bytes: 74,
      source: "baseline" as const,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      text: "# RouteMarket Work\n\nEarlier locally saved project file version.\n",
    };
  },
  async restoreProjectFileVersion(localProjectId, relativePath, _versionId) {
    return previewApi.writeProjectFile(
      localProjectId,
      relativePath,
      "# RouteMarket Work\n\nEarlier locally saved project file version.\n",
      `sha256:${"0".repeat(64)}`,
    );
  },
  async exportProjectFile(_localProjectId, relativePath) {
    return { exportedPath: `C:/Exports/${relativePath.split("/").at(-1)}` };
  },
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
      finishedAt: null,
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
  async getWorkflowBrowserState(localProjectId) {
    previewBrowserState = { ...previewBrowserState, localProjectId };
    return previewBrowserState;
  },
  async showWorkflowBrowser(localProjectId) {
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
      pages: [
        ...previewBrowserState.pages,
        {
          pageId,
          profileId: nextProfileId,
          localProjectId,
          title: "",
          url: "about:blank",
          loading: false,
          crashed: false,
        },
      ],
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
      title: page.title,
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
      profiles: [...previewBrowserState.profiles, { profileId, localProjectId, ...input }],
    };
    return previewApi.createBrowserPage(localProjectId, profileId);
  },
  async updateBrowserProfile(_localProjectId, profileId, input) {
    previewBrowserState = {
      ...previewBrowserState,
      profiles: previewBrowserState.profiles.map((profile) =>
        profile.profileId === profileId ? { ...profile, ...input } : profile,
      ),
    };
    return previewBrowserState;
  },
  async deleteBrowserProfile(localProjectId, profileId) {
    previewBrowserState = {
      ...previewBrowserState,
      profiles: previewBrowserState.profiles.filter((profile) => profile.profileId !== profileId),
      pages: previewBrowserState.pages.filter((page) => page.profileId !== profileId),
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
          : page,
      ),
    };
    return previewBrowserState;
  },
  async browserBack() {
    return previewBrowserState;
  },
  async browserForward() {
    return previewBrowserState;
  },
  async reloadBrowser() {
    return previewBrowserState;
  },
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
      relativePaths,
    };
  },
  async extractBrowser() {
    return "Preview extracted text";
  },
  async screenshotBrowser() {
    return "data:image/png;base64,";
  },
  async retryBrowserOperation(localProjectId, operationId) {
    const previous = previewBrowserState.operations.find((operation) => operation.operationId === operationId);
    if (!previous || previous.status !== "failed") {
      throw new Error("Managed Browser operation is not available for retry.");
    }
    const now = new Date().toISOString();
    previewBrowserState = {
      ...previewBrowserState,
      operations: [
        {
          ...previous,
          operationId: `browser_op_${crypto.randomUUID().replaceAll("-", "")}`,
          localProjectId,
          source: "user",
          status: "succeeded",
          title: tr("ui.9a3e34e1ba9c", [previous.title]),
          startedAt: now,
          finishedAt: now,
          error: null,
          retryOfOperationId: previous.operationId,
        },
        ...previewBrowserState.operations,
      ],
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
      error: null,
    };
    return previewAttachedBrowserState;
  },
  async disconnectAttachedBrowser() {
    previewAttachedBrowserState = { connected: false, endpoint: null, target: null, error: null };
    return previewAttachedBrowserState;
  },
  async navigateAttachedBrowser(url) {
    if (!previewAttachedBrowserState.target) throw new Error(tr("ui.df4d48a4010b"));
    previewAttachedBrowserState = {
      ...previewAttachedBrowserState,
      target: { ...previewAttachedBrowserState.target, url: url.startsWith("http") ? url : `https://${url}` },
    };
    return previewAttachedBrowserState;
  },
  async clickAttachedBrowser() {},
  async typeAttachedBrowser() {},
  async extractAttachedBrowser() {
    return "Preview extracted text";
  },
  async screenshotAttachedBrowser() {
    return "data:image/png;base64,";
  },
  async listLocalTriggers(localProjectId) {
    return previewLocalTriggers.filter((item) => item.localProjectId === localProjectId);
  },
  async saveLocalTrigger(input, triggerId) {
    const existing = triggerId ? previewLocalTriggers.find((item) => item.triggerId === triggerId) : null;
    const now = new Date().toISOString();
    const trigger: LocalTriggerSummary = {
      triggerId: triggerId ?? `trigger_${crypto.randomUUID().replaceAll("-", "")}`,
      localProjectId: input.localProjectId,
      workflowId: input.workflowId ?? null,
      name: input.name,
      kind: input.kind,
      enabled: input.enabled,
      relativePath: input.relativePath ?? null,
      intervalMinutes: input.intervalMinutes ?? null,
      accelerator: input.accelerator ?? null,
      status: input.enabled ? "active" : "inactive",
      lastError: null,
      lastFiredAt: existing?.lastFiredAt ?? null,
      nextRunAt:
        input.enabled && input.kind === "schedule" && input.intervalMinutes
          ? new Date(Date.now() + input.intervalMinutes * 60_000).toISOString()
          : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    previewLocalTriggers = [trigger, ...previewLocalTriggers.filter((item) => item.triggerId !== trigger.triggerId)];
    return trigger;
  },
  async removeLocalTrigger(triggerId) {
    previewLocalTriggers = previewLocalTriggers.filter((item) => item.triggerId !== triggerId);
  },
  async fireLocalTrigger(triggerId) {
    const trigger = previewLocalTriggers.find((item) => item.triggerId === triggerId);
    if (!trigger) throw new Error("Local trigger not found");
    trigger.lastFiredAt = new Date().toISOString();
    return trigger;
  },
  async listNativeAppConnectors() {
    return [
      {
        connectorId: "vscode" as const,
        name: "Visual Studio Code",
        description: tr("ui.b58f1539b978"),
        available: true,
        executablePath: "C:/Preview/Code.exe",
        supportedExtensions: [],
      },
      {
        connectorId: "excel" as const,
        name: "Microsoft Excel",
        description: tr("ui.e1357050b778"),
        available: false,
        executablePath: null,
        supportedExtensions: [".xlsx", ".xls", ".csv"],
      },
      {
        connectorId: "powerpoint" as const,
        name: "Microsoft PowerPoint",
        description: tr("ui.572adf180c4f"),
        available: false,
        executablePath: null,
        supportedExtensions: [".pptx", ".ppt"],
      },
    ];
  },
  async openNativeAppConnector(connectorId, _localProjectId, relativePath) {
    return { connectorId, openedPath: relativePath ?? ".", launchedAt: new Date().toISOString() };
  },
  async listDesktopWorkflowDrafts(localProjectId) {
    return previewWorkflowDraft?.localProjectId === localProjectId
      ? [
          {
            workflowId: previewWorkflowDraft.workflowId,
            localProjectId,
            kind: previewWorkflowDraft.kind,
            name: previewWorkflowDraft.name,
            nodeCount: previewWorkflowDraft.nodes.length,
            edgeCount: previewWorkflowDraft.edges.length,
            createdAt: previewWorkflowDraft.createdAt,
            updatedAt: previewWorkflowDraft.updatedAt,
          },
        ]
      : [];
  },
  async getDesktopWorkflowDraft(localProjectId, workflowId) {
    return previewWorkflowDraft?.localProjectId === localProjectId &&
      (!workflowId || previewWorkflowDraft.workflowId === workflowId)
      ? previewWorkflowDraft
      : null;
  },
  async saveDesktopWorkflowDraft(draft) {
    previewWorkflowDraft = { ...draft, updatedAt: new Date().toISOString() };
    return previewWorkflowDraft;
  },
  async deleteDesktopWorkflowDraft(_localProjectId, workflowId) {
    if (previewWorkflowDraft?.workflowId === workflowId) previewWorkflowDraft = null;
  },
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
        attempt: 1,
      })),
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
        finishedAt,
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
      .filter((run) => run.localProjectId === localProjectId && (!workflowId || run.workflowId === workflowId))
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
      finishedAt,
    }));
    return structuredClone(run);
  },
  async retryDesktopWorkflowRun(runId) {
    const run = previewWorkflowRuns.find((item) => item.runId === runId);
    if (!run) throw new Error("Workflow run not found");
    return previewApi.runDesktopWorkflow(run.localProjectId, run.workflowId, run.input);
  },
  async openDesktopWorkflowArtifact() {
    return true;
  },
  async resumeDesktopWorkflowRun(runId) {
    const run = previewWorkflowRuns.find((item) => item.runId === runId);
    if (!run) throw new Error("Workflow run not found");
    run.status = "running";
    run.error = null;
    for (const node of run.nodeRuns) {
      if (node.status === "waiting_for_user") {
        node.status = "running";
        node.error = null;
        node.attempt += 1;
      }
    }
    return structuredClone(run);
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
      lastError: null,
    };
    previewMcpServers = [server, ...previewMcpServers];
    return server;
  },
  async listMcpServers() {
    return previewMcpServers;
  },
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
  async listMediaModels(kind) {
    return [
      {
        code: kind === "image" ? "gpt-image-2" : kind === "video" ? "seedance-1.5-pro" : "doubao-tts",
        displayName: kind === "image" ? "GPT Image 2" : kind === "video" ? "Seedance 1.5 Pro" : "Doubao TTS",
        iconUrl: null,
        iconStorageProvider: null,
        iconStorageKey: null,
        category: kind,
        source: "routemarket" as const,
        providerId: null,
        providerName: "RouteMarket",
        audioModes: kind === "audio" ? ["tts" as const] : [],
        price: kind === "image" ? 1.6 : null,
        ...(kind === "image" ? {
          imageCapabilities: {
            sizes: [
              { value: "1024x1024", label: "1024x1024", resolution: null, ratio: "1:1" },
              { value: "1024x1536", label: "1024x1536", resolution: null, ratio: "2:3" },
              { value: "1536x1024", label: "1536x1024", resolution: null, ratio: "3:2" },
            ],
            qualities: [
              { value: "low", label: "low" },
              { value: "medium", label: "medium" },
              { value: "high", label: "high" },
            ],
            counts: [1, 2],
            defaultSize: "1024x1024",
            defaultQuality: "medium",
            defaultCount: 1,
            requestCredits: 0,
            prices: [
              { size: null, quality: "low", resolution: null, ratio: null, credits: 1.6 },
              { size: null, quality: "medium", resolution: null, ratio: null, credits: 6.3 },
              { size: null, quality: "high", resolution: null, ratio: null, credits: 25 },
            ],
          },
        } : {}),
      },
    ];
  },
  async listMediaInspiration(input) {
    const palettes = [
      ["#13233a", "#66b6a4"],
      ["#64517b", "#d2a887"],
      ["#315c87", "#ef9f65"],
      ["#1d2635", "#d94139"],
      ["#d9aa55", "#f6e3b7"],
      ["#4a6b77", "#d7d3bf"],
    ];
    return {
      items: palettes.map(([from, to], index) => {
        const title = ["森林微光", "电影感人像", "蓝羽小鸟", "雨夜街景", "品牌插画", "产品视觉"][index]!;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="720" height="900" fill="url(#g)"/><circle cx="${170 + index * 45}" cy="330" r="150" fill="white" opacity=".16"/><text x="42" y="830" fill="white" font-size="42" font-family="sans-serif">${title}</text></svg>`;
        return {
          id: `preview-inspiration-${index}`,
          kind: input.kind,
          title,
          prompt: `${title}，精致构图，高质量光影`,
          modelCode: "gpt-image-2",
          modelName: "GPT Image 2",
          tags: [],
          officialTagCodes: [],
          thumbnailUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          mediaUrl: null,
          mimeType: "image/svg+xml",
          likeCount: 128 - index * 11,
          saveCount: 32,
          viewCount: 860 + index * 73,
          author: { id: "preview", name: "RouteMarket", avatarUrl: null },
        };
      }),
      hasMore: false,
      nextCursor: null,
    };
  },
  async listMediaInspirationTags(kind) {
    return kind === "image" ? [
      { code: "portrait", label: "人像" },
      { code: "anime", label: "动漫" },
      { code: "realistic", label: "写实" },
      { code: "product", label: "产品" },
      { code: "poster", label: "海报" },
      { code: "fashion", label: "时尚" },
      { code: "landscape", label: "风景" },
      { code: "cinematic", label: "电影感" },
    ] : [];
  },
  async generateMedia(input) {
    await new Promise((resolve) => window.setTimeout(resolve, 2_400));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="g"><stop stop-color="#4f63ff"/><stop offset="1" stop-color="#a05cff"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/><text x="512" y="500" text-anchor="middle" fill="white" font-size="58" font-family="sans-serif">RouteMarket Creator</text><text x="512" y="575" text-anchor="middle" fill="white" opacity=".8" font-size="30" font-family="sans-serif">${input.prompt.replace(/[<>&]/g, "")}</text></svg>`;
    return {
      taskId: null,
      outputs: [
        {
          id: "preview-media",
          kind: input.kind,
          url: input.kind === "image" ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "",
          downloadUrl: null,
          thumbnailUrl: null,
          mimeType: input.kind === "image" ? "image/svg+xml" : null,
          revisedPrompt: null,
        },
      ],
    };
  },
  async listModelProviders() {
    return [];
  },
  async saveModelProvider(input) {
    return {
      id: input.id ?? "provider_preview",
      name: input.name,
      instanceName: input.instanceName?.trim() || input.name,
      protocol: input.protocol,
      compatibility: input.compatibility ?? "standard",
      baseUrl: input.baseUrl,
      headers: input.headers ?? [],
      hasApiKey: Boolean(input.apiKey),
      enabled: input.enabled,
      modelCount: input.models?.length ?? 0,
      models: input.models ?? [],
      lastSyncedAt: null,
      lastError: null,
    };
  },
  async syncModelProvider() {
    throw new Error("Preview mode");
  },
  async removeModelProvider() {
    return false;
  },
  async getLocalApiGateway() {
    return structuredClone(previewLocalApiState);
  },
  async updateLocalApiGateway(input) {
    const enabled = input.enabled ?? previewLocalApiState.enabled;
    const port = input.port ?? previewLocalApiState.port;
    previewLocalApiState = {
      ...previewLocalApiState,
      enabled,
      port,
      running: enabled,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      token: input.rotateToken ? `rm_local_preview_${Date.now()}` : previewLocalApiState.token,
      lastError: null,
    };
    return structuredClone(previewLocalApiState);
  },
  async saveLocalApiGatewayRoute() {
    return previewApi.getLocalApiGateway();
  },
  async removeLocalApiGatewayRoute() {
    return previewApi.getLocalApiGateway();
  },
  async listLocalApiGatewayUsage() {
    return [];
  },
  async getLocalProjectChat(localProjectId, sessionId) {
    const chat = previewChats.find(
      (item) => item.localProjectId === localProjectId && (!sessionId || item.sessionId === sessionId),
    );
    return chat
      ? {
          sessionId: chat.sessionId,
          localProjectId: chat.localProjectId,
          messages: previewMessages.get(chat.sessionId) ?? [],
        }
      : null;
  },
  async listLocalProjectChats(localProjectId) {
    return previewChats.filter((chat) => chat.localProjectId === localProjectId);
  },
  async listRecentLocalChats(limit = 15) {
    return previewChats.slice(0, limit);
  },
  async createLocalProjectChat(localProjectId) {
    const now = new Date().toISOString();
    const chat = {
      sessionId: `local_chat_${Date.now()}`,
      localProjectId,
      title: tr("chat.agent.none"),
      createdAt: now,
      updatedAt: now,
    };
    previewChats = [chat, ...previewChats];
    previewMessages.set(chat.sessionId, []);
    return chat;
  },
  async renameLocalProjectChat(localProjectId, sessionId, title) {
    const current = previewChats.find((chat) => chat.localProjectId === localProjectId && chat.sessionId === sessionId);
    if (!current) throw new Error("Conversation not found");
    const chat = { ...current, title, updatedAt: new Date().toISOString() };
    previewChats = previewChats.map((item) => (item.sessionId === sessionId ? chat : item));
    return chat;
  },
  async deleteLocalProjectChat(_localProjectId, sessionId) {
    previewChats = previewChats.filter((chat) => chat.sessionId !== sessionId);
    previewMessages.delete(sessionId);
  },
  async moveLocalProjectChat(_localProjectId, sessionId, targetProjectId) {
    const current = previewChats.find((chat) => chat.sessionId === sessionId);
    if (!current) throw new Error("Conversation not found");
    const chat = { ...current, localProjectId: targetProjectId, updatedAt: new Date().toISOString() };
    previewChats = [chat, ...previewChats.filter((item) => item.sessionId !== sessionId)];
    return chat;
  },
  async truncateLocalProjectChat() {
    return 0;
  },
  async listAgentProfiles() {
    return getPreviewAgents();
  },
  async sendProjectMessage(input) {
    if (input.message.includes(tr("ui.3dbe385f959e"))) {
      window.setTimeout(() => {
        for (const listener of previewChatListeners) {
          listener({
            requestId: input.requestId,
            type: "error",
            message: tr("ui.204c8901fcc0"),
          });
        }
      }, 350);
      return;
    }
    const reply = input.contextFile
      ? [
          tr("ui.528782ef4260"),
          "",
          tr("ui.5e4b0b9a99c0", [input.contextFile.relativePath]),
          "",
          tr("ui.b6db4a318bdf"),
          tr("ui.8287c5725c6d"),
          tr("ui.fb96227d8005"),
        ].join("\n")
      : [
          tr("ui.cb57a456b580"),
          "",
          tr("ui.abd8143f7d1a"),
          "",
          tr("ui.072c3ae5089f"),
          tr("ui.01767ef880b1"),
          tr("ui.1834be3caac8"),
          "",
          "```text",
          "pnpm test",
          "✓ preview checks passed",
          "```",
        ].join("\n");
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "tool_started",
          toolCallId: "preview_project_read",
          toolName: "project_read_file",
          title: tr("ui.87e4a3b9a477"),
          startedAt: Date.now(),
          inputPreview: JSON.stringify({ path: "README.md" }, null, 2),
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
          title: tr("ui.87e4a3b9a477"),
          summary: tr("ui.b03291b988be"),
          endedAt: Date.now(),
          outputPreview: tr("ui.b03291b988be"),
        });
      }
    }, 180);
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "reasoning",
          content: tr("ui.87e4a3b9a477"),
        });
      }
    }, 220);
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "delta",
          content: reply,
        });
      }
    }, 250);
    window.setTimeout(() => {
      for (const listener of previewChatListeners) {
        listener({
          requestId: input.requestId,
          type: "complete",
          content: reply,
          responseMeta: {
            modelCode: input.model,
            inputTokens: 128,
            outputTokens: 64,
            totalTokens: 192,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            elapsedMs: 500,
          },
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
  },
};
function desktopBridgeUnavailable(): never {
  throw new Error(tr("ui.6572d9aa0f48"));
}
const unavailableApi: RouteMarketWorkApi = {
  onRuntimeError: () => () => undefined,
  getPreferences: async () => ({}),
  updatePreferences: async (patch) => patch,
  setLocale: async () => {},
  executeMenuCommand: async () => {},
  setTitleBarTheme: async () => {},
  setWorkbenchExpanded: async () => ({ expanded: false, addedWidth: 0 }),
  getState: async () => desktopBridgeUnavailable(),
  getAppInfo: async () => desktopBridgeUnavailable(),
  checkForUpdates: async () => desktopBridgeUnavailable(),
  listMarketplaceCatalog: async () => desktopBridgeUnavailable(),
  listDesktopExtensions: async () => desktopBridgeUnavailable(),
  refreshDesktopExtensions: async () => desktopBridgeUnavailable(),
  openDesktopExtensionPage: async () => desktopBridgeUnavailable(),
  pickDesktopExtensionFile: async () => desktopBridgeUnavailable(),
  listMarketplacePluginInstallations: async () => desktopBridgeUnavailable(),
  prepareMarketplacePluginInstall: async () => desktopBridgeUnavailable(),
  prepareLocalPluginInstall: async () => desktopBridgeUnavailable(),
  cancelMarketplacePluginInstall: async () => desktopBridgeUnavailable(),
  installMarketplacePlugin: async () => desktopBridgeUnavailable(),
  setMarketplacePluginEnabled: async () => desktopBridgeUnavailable(),
  removeMarketplacePlugin: async () => desktopBridgeUnavailable(),
  getLocalDataInfo: async () => desktopBridgeUnavailable(),
  listLocalDataScopes: async () => desktopBridgeUnavailable(),
  removeLocalDataScope: async () => desktopBridgeUnavailable(),
  showLocalData: async () => desktopBridgeUnavailable(),
  exportLocalData: async () => desktopBridgeUnavailable(),
  clearLocalData: async () => desktopBridgeUnavailable(),
  clearActivities: async () => desktopBridgeUnavailable(),
  signIn: async () => desktopBridgeUnavailable(),
  signOut: async () => desktopBridgeUnavailable(),
  switchSpace: async () => desktopBridgeUnavailable(),
  removeApprovalPolicy: async () => desktopBridgeUnavailable(),
  chooseProject: async () => desktopBridgeUnavailable(),
  chooseWorkflowOutputDirectory: async () => desktopBridgeUnavailable(),
  createProject: async () => desktopBridgeUnavailable(),
  renameProject: async () => desktopBridgeUnavailable(),
  openProjectFolder: async () => desktopBridgeUnavailable(),
  attachProjectFolder: async () => desktopBridgeUnavailable(),
  removeProjectFolder: async () => desktopBridgeUnavailable(),
  deleteProject: async () => desktopBridgeUnavailable(),
  getProjectContext: async () => desktopBridgeUnavailable(),
  listProjectSkills: async () => desktopBridgeUnavailable(),
  chooseAndInstallProjectSkill: async () => desktopBridgeUnavailable(),
  listDownloadableCloudSkills: async () => desktopBridgeUnavailable(),
  installCloudSkill: async () => desktopBridgeUnavailable(),
  removeInstalledProjectSkill: async () => desktopBridgeUnavailable(),
  getWorkflowNodeRegistry: async () => desktopBridgeUnavailable(),
  listProjectFiles: async () => desktopBridgeUnavailable(),
  searchProject: async () => desktopBridgeUnavailable(),
  readProjectFile: async () => desktopBridgeUnavailable(),
  readProjectAsset: async () => desktopBridgeUnavailable(),
  previewProjectArtifact: async () => desktopBridgeUnavailable(),
  chooseChatAttachments: async () => desktopBridgeUnavailable(),
  uploadChatAttachments: async () => desktopBridgeUnavailable(),
  discardChatAttachment: async () => desktopBridgeUnavailable(),
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
  getWorkflowBrowserState: async () => desktopBridgeUnavailable(),
  showWorkflowBrowser: async () => desktopBridgeUnavailable(),
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
  resumeDesktopWorkflowRun: async () => desktopBridgeUnavailable(),
  retryDesktopWorkflowRun: async () => desktopBridgeUnavailable(),
  openDesktopWorkflowArtifact: async () => desktopBridgeUnavailable(),
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
  listMediaModels: async () => desktopBridgeUnavailable(),
  listMediaInspiration: async () => desktopBridgeUnavailable(),
  listMediaInspirationTags: async () => desktopBridgeUnavailable(),
  generateMedia: async () => desktopBridgeUnavailable(),
  listModelProviders: async () => desktopBridgeUnavailable(),
  saveModelProvider: async () => desktopBridgeUnavailable(),
  syncModelProvider: async () => desktopBridgeUnavailable(),
  removeModelProvider: async () => desktopBridgeUnavailable(),
  getLocalApiGateway: async () => desktopBridgeUnavailable(),
  updateLocalApiGateway: async () => desktopBridgeUnavailable(),
  saveLocalApiGatewayRoute: async () => desktopBridgeUnavailable(),
  removeLocalApiGatewayRoute: async () => desktopBridgeUnavailable(),
  listLocalApiGatewayUsage: async () => desktopBridgeUnavailable(),
  getLocalProjectChat: async () => desktopBridgeUnavailable(),
  listLocalProjectChats: async () => desktopBridgeUnavailable(),
  listRecentLocalChats: async () => desktopBridgeUnavailable(),
  createLocalProjectChat: async () => desktopBridgeUnavailable(),
  renameLocalProjectChat: async () => desktopBridgeUnavailable(),
  deleteLocalProjectChat: async () => desktopBridgeUnavailable(),
  moveLocalProjectChat: async () => desktopBridgeUnavailable(),
  truncateLocalProjectChat: async () => desktopBridgeUnavailable(),
  sendProjectMessage: async () => desktopBridgeUnavailable(),
  stopProjectMessage: async () => desktopBridgeUnavailable(),
  onProjectChatEvent: () => () => undefined,
};
const api = window.routeMarketWork ?? (import.meta.env.DEV ? previewApi : unavailableApi);
export function App() {
  useLocale();
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
    approvalPolicies: [],
  });
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const [desktopExtensions, setDesktopExtensions] = useState<DesktopExtensionSummary[]>([]);
  const [extensionSelection, setExtensionSelection] = useState<{ pluginId: string; pageId: string } | null>(null);
  const [extensionPage, setExtensionPage] = useState<DesktopExtensionPage | null>(null);
  const [extensionLoading, setExtensionLoading] = useState(false);
  const [extensionError, setExtensionError] = useState<string | null>(null);
  const extensionRecoveryKeyRef = useRef("");
  const extensionOpenRequestsRef = useRef(new Map<string, Promise<void>>());
  const [settingsInitialView, setSettingsInitialView] = useState<SettingsView>("general");
  const [settingsToolsCategory, setSettingsToolsCategory] = useState<ToolsCategory | null>(null);
  const [workbenchPanel, setWorkbenchPanel] = useState<WorkbenchPanel>(null);
  const settingsReturnViewRef = useRef<{
    view: Exclude<WorkspaceView, "settings">;
    workbenchPanel: WorkbenchPanel;
  }>({ view: "chat", workbenchPanel: null });
  const [workbenchPanelWidth, setWorkbenchPanelWidth] = useState(720);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileTree | null>(null);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [workflowRegistry, setWorkflowRegistry] = useState<DesktopWorkflowNodeRegistry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<ProjectSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [assetPreview, setAssetPreview] = useState<ProjectArtifactPreview | null>(null);
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
    error: null,
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
  const [projectWorkflows, setProjectWorkflows] = useState<Record<string, DesktopWorkflowDraftSummary[]>>({});
  const [workflowDraftDirty, setWorkflowDraftDirty] = useState(false);
  const [workflowDraftHistory, setWorkflowDraftHistory] = useState(createWorkflowDraftHistory);
  const [workflowFitViewRevision, setWorkflowFitViewRevision] = useState(0);
  const [workflowSelectionRevision, setWorkflowSelectionRevision] = useState(0);
  const [workflowDraftBusy, setWorkflowDraftBusy] = useState(false);
  const [workflowRuns, setWorkflowRuns] = useState<DesktopWorkflowRun[]>([]);
  const [workflowRunInput, setWorkflowRunInput] = useState("{}");
  const [workflowRunBusy, setWorkflowRunBusy] = useState(false);
  const [workflowAddExecutor, setWorkflowAddExecutor] = useState("");
  const [includeFileContext, setIncludeFileContext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [authAction, setAuthAction] = useState<"sign-in" | "sign-out" | "switch-space" | null>(null);
  const [busyApprovalPolicyId, setBusyApprovalPolicyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [selectedModelCode, setSelectedModelCode] = useState("");
  const [executionEnvironment, setExecutionEnvironment] = useState<"auto" | "local" | "cloud">("auto");
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("agentic");
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(true);
  const [selectedProjectSkillId, setSelectedProjectSkillId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelCatalogRevision, setModelCatalogRevision] = useState(0);
  const [draft, setDraft] = useState("");
  const [pendingChatAttachments, setPendingChatAttachments] = useState<DesktopChatAttachment[]>([]);
  const [uploadingChatAttachments, setUploadingChatAttachments] = useState<DesktopChatAttachment[]>([]);
  const [chatAttachmentsBusy, setChatAttachmentsBusy] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [chatMessagesByProject, setChatMessagesByProject] = useState<Record<string, ChatMessage[]>>({});
  const [projectChats, setProjectChats] = useState<Record<string, LocalProjectChatSummary[]>>({});
  const [recentChats, setRecentChats] = useState<LocalProjectChatSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [headerChatMenuOpen, setHeaderChatMenuOpen] = useState(false);
  const [headerChatDialog, setHeaderChatDialog] = useState<HeaderChatDialog>(null);
  const [headerChatDialogValue, setHeaderChatDialogValue] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [adoptedAgentRevisions, setAdoptedAgentRevisions] = useState<Record<string, number>>({});
  const sessionIdsRef = useRef(new Map<string, string>());
  const pendingWorkflowSelectionRef = useRef<{ projectId: string; workflowId: string } | null>(null);
  const pendingChatAttachmentsRef = useRef<DesktopChatAttachment[]>([]);
  const stateRefreshEpochRef = useRef(0);
  const authTransitionRef = useRef(false);
  const activeRequestRef = useRef<{
    requestId: string;
    sessionId: string;
  } | null>(null);
  const browserRunRecoveryRef = useRef<string | null>(null);
  const abandonPendingChatAttachments = useCallback(() => {
    const abandoned = pendingChatAttachmentsRef.current;
    pendingChatAttachmentsRef.current = [];
    setPendingChatAttachments([]);
    if (activeRequestRef.current) return;
    for (const attachment of abandoned) {
      void api.discardChatAttachment(attachment.id).catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    if (!headerChatMenuOpen) return;
    const close = () => setHeaderChatMenuOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [headerChatMenuOpen]);
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserAddressRef = useRef<HTMLInputElement | null>(null);
  const browserBoundsSyncRef = useRef<(() => void) | null>(null);
  const requestBrowserBoundsSync = useCallback(() => browserBoundsSyncRef.current?.(), []);
  const selectedProject = useMemo(
    () => state.projects.find((project) => project.localProjectId === selectedProjectId) ?? null,
    [selectedProjectId, state.projects],
  );
  const selectedChatModel = useMemo(
    () => models.find((model) => model.code === selectedModelCode) ?? null,
    [models, selectedModelCode],
  );
  const selectedFolderAvailable = projectFolderAvailable(selectedProject);
  const selectedFolderStatus = projectFolderStatus(selectedProject);
  const agentWorkspace = useAgentWorkspace({
    api,
    active: workspaceView === "settings" || workspaceView === "chat",
    authStatus: state.authStatus,
    selectedProject,
    projectContext,
    models,
    modelsLoading,
    onChooseProject: () => void chooseProject(),
  });
  const chatMessages = selectedSessionId ? (chatMessagesByProject[selectedSessionId] ?? []) : [];
  const recentChatAttachments = useMemo(() => {
    const recent: DesktopChatAttachment[] = [];
    const seen = new Set<string>();
    for (let messageIndex = chatMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageAttachments = chatMessages[messageIndex]?.attachments ?? [];
      for (let attachmentIndex = messageAttachments.length - 1; attachmentIndex >= 0; attachmentIndex -= 1) {
        const attachment = messageAttachments[attachmentIndex];
        if (!attachment || seen.has(attachment.id)) continue;
        seen.add(attachment.id);
        recent.push(attachment);
        if (recent.length >= 6) return recent;
      }
    }
    return recent;
  }, [chatMessages]);
  const conversationSourcePaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      const message = chatMessages[index];
      const candidates = [
        ...(message.contextFile ? [message.contextFile] : []),
        ...(message.artifacts ?? []).map((artifact) => artifact.relativePath),
      ];
      for (const path of candidates) {
        if (!seen.has(path)) {
          seen.add(path);
          paths.push(path);
        }
      }
    }
    return paths;
  }, [chatMessages]);
  const editingProject = state.projects.find((project) => project.localProjectId === editingProjectId) ?? null;
  const selectedChatAgent = agentWorkspace.model.selectedAgent;
  const agentVersionKey = selectedChatAgent ? `${selectedProjectId ?? "general"}:${selectedChatAgent.id}` : null;
  const conversationAgentVersion = useMemo(
    () =>
      resolveConversationAgentVersion(
        chatMessages,
        selectedChatAgent,
        agentVersionKey ? adoptedAgentRevisions[agentVersionKey] : undefined,
      ),
    [adoptedAgentRevisions, agentVersionKey, chatMessages, selectedChatAgent],
  );
  const chatAgentSkills = useMemo(
    () =>
      resolveDesktopAgentSkillAvailability(selectedChatAgent?.skills ?? [], projectContext, {
        executionEnvironment:
          executionEnvironment === "cloud" || (executionEnvironment === "auto" && !selectedFolderAvailable)
            ? "cloud"
            : "local",
        localSkillToolsEnabled: agentWorkspace.model.localToolGroups.includes("skills"),
      }),
    [
      agentWorkspace.model.localToolGroups,
      executionEnvironment,
      projectContext,
      selectedChatAgent,
      selectedFolderAvailable,
    ],
  );
  useEffect(() => {
    abandonPendingChatAttachments();
    setEditingMessageId(null);
  }, [abandonPendingChatAttachments, selectedProjectId]);
  useEffect(() => {
    pendingChatAttachmentsRef.current = pendingChatAttachments;
  }, [pendingChatAttachments]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      Promise.all(
        state.projects.map(
          async (project) => [project.localProjectId, await api.listLocalProjectChats(project.localProjectId)] as const,
        ),
      ),
      Promise.all(
        state.projects.map(
          async (project) => [project.localProjectId, await api.listDesktopWorkflowDrafts(project.localProjectId)] as const,
        ),
      ),
      api.listRecentLocalChats(15),
    ])
      .then(([entries, workflowEntries, recent]) => {
        if (!active) return;
        setProjectChats(Object.fromEntries(entries));
        setProjectWorkflows(Object.fromEntries(workflowEntries));
        setRecentChats(recent);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [state.projects]);
  useEffect(() => {
    if (!selectedChatModel) return;
    const availableMode = resolveAvailableWebSearchMode(selectedChatModel, webSearchMode);
    if (availableMode !== webSearchMode) setWebSearchMode(availableMode);
  }, [selectedChatModel, webSearchMode]);
  useEffect(() => {
    if (!selectedProjectId && !selectedSessionId) return;
    const chatScope = selectedProjectId;
    const scopeKey = chatScope ?? "__general__";
    let active = true;
    void api
      .listLocalProjectChats(chatScope)
      .then((chats) => {
        if (!active) return null;
        if (chatScope) setProjectChats((current) => ({ ...current, [chatScope]: chats }));
        const nextSessionId =
          selectedSessionId && chats.some((chat) => chat.sessionId === selectedSessionId) ? selectedSessionId : null;
        setSelectedSessionId(nextSessionId);
        return nextSessionId ? api.getLocalProjectChat(chatScope, nextSessionId) : null;
      })
      .then((chat) => {
        if (!active || !chat) return;
        sessionIdsRef.current.set(scopeKey, chat.sessionId);
        const hydratedMessages = chat.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
          sentAt: message.sentAt,
          ...(message.contextFile ? { contextFile: message.contextFile } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          ...(message.artifacts?.length ? { artifacts: message.artifacts } : {}),
          ...(message.tools?.length ? { tools: message.tools } : {}),
          ...(message.responseMeta ? { responseMeta: message.responseMeta } : {}),
          ...(message.stopped ? { stopped: true } : {}),
          ...(message.failed ? { failed: true } : {}),
          ...(message.agentId ? { agentId: message.agentId } : {}),
          ...(message.agentRevision ? { agentRevision: message.agentRevision } : {}),
          ...(message.agentName ? { agentName: message.agentName } : {}),
          ...("agentAvatarUrl" in message ? { agentAvatarUrl: message.agentAvatarUrl } : {}),
        }));
        setChatMessagesByProject((current) => {
          const existingMessages = current[chat.sessionId] ?? [];
          if (
            activeRequestRef.current?.sessionId === chat.sessionId ||
            (existingMessages.length > 0 && hydratedMessages.length === 0)
          ) {
            return current;
          }
          return { ...current, [chat.sessionId]: hydratedMessages };
        });
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : tr("ui.07b2f6b8bef1"));
      });
    return () => {
      active = false;
    };
  }, [selectedProjectId, selectedSessionId]);
  const hasFileChanges = Boolean(readResult && (newFileDraft || fileDraft !== readResult.text));
  const selectedProcess = processes.find((process) => process.processId === selectedProcessId) ?? processes[0] ?? null;
  const visibleApprovals = state.approvals.filter(
    (approval) => !approval.projectId || approval.projectId === selectedProjectId,
  );
  const visibleApprovalPolicies = state.approvalPolicies.filter((policy) => policy.projectId === selectedProjectId);
  const selectedMcpServer =
    mcpServers.find((server) => server.serverId === selectedMcpServerId) ?? mcpServers[0] ?? null;
  const selectedMcpTool =
    selectedMcpServer?.tools.find((tool) => tool.name === selectedMcpToolName) ?? selectedMcpServer?.tools[0] ?? null;
  const selectedWorkflowRun = workflowRuns.find((run) => run.workflowId === workflowDraft?.workflowId) ?? null;
  const activeWorkflowBrowserId =
    workspaceView === "workflow" && workflowPanel === "canvas"
      ? (workflowDraft?.workflowId ?? null)
      : null;
  const visibleWorkflowDefinitions = useMemo(() => {
    const query = workflowSearch.trim().toLocaleLowerCase();
    const definitions = (workflowRegistry?.definitions ?? []).map(localizeWorkflowNodeDefinition);
    return query
      ? definitions.filter((definition) =>
          `${definition.title} ${definition.executorKey} ${definition.description}`.toLocaleLowerCase().includes(query),
        )
      : definitions;
  }, [workflowRegistry, workflowSearch]);
  const refreshState = useCallback(async () => {
    const requestEpoch = stateRefreshEpochRef.current;
    const nextState = await api.getState();
    if (authTransitionRef.current || requestEpoch !== stateRefreshEpochRef.current) return nextState;
    setState(nextState);
    setConnectionError(null);
    setStateLoaded(true);
    setSelectedProjectId((current) =>
      current === null
        ? null
        : nextState.projects.some((project) => project.localProjectId === current)
          ? current
          : (nextState.projects[0]?.localProjectId ?? null),
    );
    return nextState;
  }, []);
  const handleConnectionError = useCallback((nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : tr("ui.c8cd9b82cf2e");
    setState((current) => withWorkerOffline(current, message));
    setStateLoaded(true);
    setConnectionError(message);
  }, []);
  useEffect(() => {
    void refreshState().catch(handleConnectionError);
    const timer = window.setInterval(() => {
      void refreshState().catch(handleConnectionError);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [handleConnectionError, refreshState]);
  useEffect(() => {
    void api.refreshDesktopExtensions().then(setDesktopExtensions).catch((nextError) => {
      setExtensionError(nextError instanceof Error ? nextError.message : String(nextError));
    });
  }, []);

  const openDesktopExtension = useCallback(async (pluginId: string, pageId: string) => {
    const requestKey = `${pluginId}:${pageId}`;
    const existingRequest = extensionOpenRequestsRef.current.get(requestKey);
    if (existingRequest) return existingRequest;
    const request = (async () => {
      setExtensionSelection({ pluginId, pageId });
      setWorkspaceView(`plugin:${pluginId}:${pageId}`);
      setWorkbenchPanel(null);
      setExtensionPage(null);
      setExtensionError(null);
      setExtensionLoading(true);
      try {
        const page = await api.openDesktopExtensionPage(pluginId, pageId);
        setExtensionPage(page);
        setDesktopExtensions(await api.listDesktopExtensions());
      } catch (nextError) {
        setExtensionError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setExtensionLoading(false);
      }
    })();
    extensionOpenRequestsRef.current.set(requestKey, request);
    try {
      await request;
    } finally {
      if (extensionOpenRequestsRef.current.get(requestKey) === request) {
        extensionOpenRequestsRef.current.delete(requestKey);
      }
    }
  }, []);
  useEffect(() => {
    if (!extensionSelection || !workspaceView.startsWith("plugin:")) return;
    let disposed = false;
    let inspecting = false;
    const inspectRuntime = async () => {
      if (inspecting) return;
      inspecting = true;
      try {
        const extensions = await api.listDesktopExtensions();
        if (disposed) return;
        setDesktopExtensions(extensions);
        const selected = extensions.find((item) => item.pluginId === extensionSelection.pluginId);
        if (selected?.runtimeStatus === "running") {
          extensionRecoveryKeyRef.current = "";
          return;
        }
        if (!selected || extensionLoading || (selected.runtimeStatus !== "failed" && selected.runtimeStatus !== "stopped")) return;
        const recoveryKey = `${selected.pluginId}:${selected.runtimeStatus}:${selected.runtimeError ?? ""}`;
        if (extensionRecoveryKeyRef.current === recoveryKey) return;
        extensionRecoveryKeyRef.current = recoveryKey;
        await openDesktopExtension(extensionSelection.pluginId, extensionSelection.pageId);
      } catch (nextError) {
        if (!disposed) setExtensionError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        inspecting = false;
      }
    };
    void inspectRuntime();
    const timer = window.setInterval(() => void inspectRuntime(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [extensionLoading, extensionSelection, openDesktopExtension, workspaceView]);
  useEffect(() => {
    const unsubscribe = api.onProjectChatEvent((event) => {
      const activeRequest = activeRequestRef.current;
      if (!activeRequest || event.requestId !== activeRequest.requestId) return;
      const sessionId = activeRequest.sessionId;
      if (event.type === "error") {
        setChatMessagesByProject((current) =>
          updateAssistantMessage(current, sessionId, event.requestId, (message) => ({
            ...message,
            content: event.content || message.content || tr("ui.027658a32984", [event.message]),
            failed: true,
          })),
        );
        activeRequestRef.current = null;
        setActiveRequestId(null);
        return;
      }
      if (event.type === "tool_started" || event.type === "tool_completed" || event.type === "tool_error") {
        setChatMessagesByProject((current) =>
          updateAssistantMessage(current, sessionId, event.requestId, (message) => ({
            ...message,
            tools: updateChatToolActivity(message.tools ?? [], event),
          })),
        );
        return;
      }
      if (event.type === "artifacts") {
        setChatMessagesByProject((current) =>
          updateAssistantMessage(current, sessionId, event.requestId, (message) => {
            const artifacts = new Map((message.artifacts ?? []).map((artifact) => [artifact.relativePath, artifact]));
            for (const artifact of event.artifacts) artifacts.set(artifact.relativePath, artifact);
            return { ...message, artifacts: [...artifacts.values()] };
          }),
        );
        return;
      }
      if (event.type === "reasoning") {
        setChatMessagesByProject((current) =>
          updateAssistantMessage(current, sessionId, event.requestId, (message) => ({
            ...message,
            reasoning: event.content,
          })),
        );
        return;
      }
      setChatMessagesByProject((current) =>
        updateAssistantMessage(current, sessionId, event.requestId, (message) => ({
          ...message,
          content: event.content,
          stopped: event.type === "stopped",
          ...(event.type === "complete" ? { responseMeta: event.responseMeta } : {}),
        })),
      );
      if (event.type === "complete" || event.type === "stopped") {
        activeRequestRef.current = null;
        setActiveRequestId(null);
      }
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    const listener = (event: Event) => {
      const relativePath = (event as CustomEvent<unknown>).detail;
      if (typeof relativePath === "string" && relativePath) void openChatArtifact(relativePath);
    };
    window.addEventListener("routemarket:open-chat-artifact", listener);
    return () => window.removeEventListener("routemarket:open-chat-artifact", listener);
  }, [selectedProjectId]);
  useEffect(() => {
    return api.onDesktopWorkflowRunEvent((event) => {
      setWorkflowRuns((current) => upsertWorkflowRun(current, event.run));
      if (workflowRunNeedsBrowserTakeover(event.run)) {
        const isSelectedWorkflow =
          selectedProjectId === event.run.localProjectId &&
          workflowDraft?.workflowId === event.run.workflowId;
        if (workflowDraftDirty && !isSelectedWorkflow) return;
        if (!isSelectedWorkflow) {
          pendingWorkflowSelectionRef.current = {
            projectId: event.run.localProjectId,
            workflowId: event.run.workflowId,
          };
          setWorkflowSelectionRevision((current) => current + 1);
          setSelectedProjectId(event.run.localProjectId);
          setSelectedSessionId(null);
        }
        setWorkflowPanel("canvas");
        setWorkspaceView("workflow");
        setBrowserScreenshot(null);
        setWorkbenchPanel("browser");
      }
    });
  }, [selectedProjectId, workflowDraft?.workflowId, workflowDraftDirty]);
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
    void Promise.all([api.listProjectFiles(selectedProjectId), api.getProjectContext(selectedProjectId)])
      .then(([tree, context]) => {
        if (active) {
          setProjectFiles(tree);
          setProjectContext(context);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : tr("ui.72911c630179"));
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
    const remembered = selectedProjectId ? readProjectModelPreference(selectedProjectId) : null;
    const next =
      remembered && models.some((model) => model.code === remembered)
        ? remembered
        : preferred && models.some((model) => model.code === preferred)
          ? preferred
          : null;
    if (next) setSelectedModelCode(next);
  }, [models, projectContext, selectedProjectId]);
  function selectChatModel(modelCode: string) {
    setSelectedModelCode(modelCode);
    if (selectedProjectId) writeProjectModelPreference(selectedProjectId, modelCode);
  }
  useEffect(() => {
    setSelectedProjectSkillId((current) =>
      current && projectContext?.skills.some((skill) => skill.id === current) ? current : "",
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
      void api
        .searchProject(selectedProjectId, query)
        .then((result) => {
          if (active) setSearchResult(result);
        })
        .catch((nextError) => {
          if (active) setError(nextError instanceof Error ? nextError.message : tr("ui.f72d26a7c6e3"));
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
    const projectItems = selectedProjectId ? items.filter((item) => item.localProjectId === selectedProjectId) : [];
    setProcesses(projectItems);
    setSelectedProcessId((current) =>
      current && projectItems.some((item) => item.processId === current)
        ? current
        : (projectItems[0]?.processId ?? null),
    );
  }, [selectedProjectId]);
  useEffect(() => {
    let active = true;
    const expanded = Boolean(workbenchPanel && workspaceSupportsWorkbench(workspaceView));
    void api
      .setWorkbenchExpanded(expanded, 720)
      .then((result) => {
        if (!active) return;
        if (expanded && result.addedWidth >= 420) {
          setWorkbenchPanelWidth(Math.max(420, Math.min(760, result.addedWidth)));
        }
      })
      .catch(() => {
        if (active && expanded) setWorkbenchPanelWidth(720);
      });
    return () => {
      active = false;
    };
  }, [workbenchPanel, workspaceView]);
  function beginWorkbenchResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!workbenchPanel) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workbenchPanelWidth;
    const resize = (moveEvent: PointerEvent) => {
      const maximum = Math.max(420, Math.min(900, window.innerWidth - 640));
      setWorkbenchPanelWidth(Math.max(420, Math.min(maximum, startWidth + startX - moveEvent.clientX)));
    };
    const finish = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      document.body.classList.remove("resizing-workbench");
    };
    document.body.classList.add("resizing-workbench");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish, { once: true });
  }
  useEffect(() => {
    if (workbenchPanel !== "terminal") return;
    void refreshProcesses().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : tr("ui.8186582b7105"));
    });
    const timer = window.setInterval(() => {
      void refreshProcesses().catch(() => undefined);
    }, 800);
    return () => window.clearInterval(timer);
  }, [refreshProcesses, workbenchPanel]);
  useEffect(() => {
    if (
      workbenchPanel !== "browser" ||
      !workspaceSupportsWorkbench(workspaceView) ||
      browserMode !== "managed" ||
      !selectedProjectId
    ) {
      void api.hideBrowser().catch(() => undefined);
      if (!selectedProjectId) setBrowserState(null);
      return;
    }
    if (browserScreenshot) {
      void api.hideBrowser();
      return;
    }
    let active = true;
    let showStarted = false;
    setBrowserState(null);
    let boundsFrame: number | null = null;
    const syncBounds = () => {
      const element = browserViewportRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const bounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      if (showStarted) {
        void api.setBrowserBounds(bounds).catch(() => undefined);
        return;
      }
      showStarted = true;
      const showPromise = activeWorkflowBrowserId
        ? api.showWorkflowBrowser(selectedProjectId, activeWorkflowBrowserId, bounds)
        : api.showBrowser(selectedProjectId, bounds);
      void showPromise
        .then((state) => {
          if (active) setBrowserState(state);
        })
        .catch((nextError) => {
          showStarted = false;
          if (active) setError(nextError instanceof Error ? nextError.message : tr("ui.cb4d258ff4ec"));
        });
    };
    const queueBoundsSync = () => {
      if (boundsFrame !== null) window.cancelAnimationFrame(boundsFrame);
      boundsFrame = window.requestAnimationFrame(() => {
        boundsFrame = null;
        syncBounds();
      });
    };
    browserBoundsSyncRef.current = queueBoundsSync;
    queueBoundsSync();
    const observer = new ResizeObserver(queueBoundsSync);
    if (browserViewportRef.current) observer.observe(browserViewportRef.current);
    window.addEventListener("resize", queueBoundsSync);
    const timer = window.setInterval(() => {
      syncBounds();
      const statePromise = activeWorkflowBrowserId
        ? api.getWorkflowBrowserState(selectedProjectId, activeWorkflowBrowserId)
        : api.getBrowserState(selectedProjectId);
      void statePromise
        .then((state) => {
          if (!active) return;
          setBrowserState(state);
          if (document.activeElement !== browserAddressRef.current && state.url !== "about:blank") {
            setBrowserAddress(state.url);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      active = false;
      if (browserBoundsSyncRef.current === queueBoundsSync) browserBoundsSyncRef.current = null;
      if (boundsFrame !== null) window.cancelAnimationFrame(boundsFrame);
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("resize", queueBoundsSync);
      void api.hideBrowser().catch(() => undefined);
    };
  }, [
    activeWorkflowBrowserId,
    browserMode,
    browserScreenshot,
    selectedProjectId,
    workbenchPanel,
    workspaceView,
  ]);

  useEffect(() => {
    if (
      workspaceView !== "workflow" ||
      workflowPanel !== "canvas" ||
      !shouldRevealWorkflowBrowser(selectedWorkflowRun)
    ) {
      return;
    }
    setBrowserScreenshot(null);
    setWorkbenchPanel("browser");
  }, [selectedWorkflowRun, workflowPanel, workspaceView]);

  useEffect(() => {
    const resumeUrl = workflowRunBrowserResumeUrl(selectedWorkflowRun);
    if (
      workspaceView !== "workflow" ||
      workflowPanel !== "canvas" ||
      workbenchPanel !== "browser" ||
      browserMode !== "managed" ||
      !selectedProjectId ||
      !activeWorkflowBrowserId ||
      !selectedWorkflowRun ||
      browserState?.url !== "about:blank" ||
      !resumeUrl
    ) {
      return;
    }
    const recoveryKey = `${selectedWorkflowRun.runId}:${resumeUrl}`;
    if (browserRunRecoveryRef.current === recoveryKey) return;
    browserRunRecoveryRef.current = recoveryKey;
    void api
      .navigateBrowser(selectedProjectId, resumeUrl, browserState.activePageId)
      .then(() => api.setBrowserTakeover(selectedProjectId, true, browserState.activePageId))
      .then((state) => {
        setBrowserState(state);
        setBrowserAddress(state.url);
      })
      .catch((nextError) => {
        browserRunRecoveryRef.current = null;
        setError(nextError instanceof Error ? nextError.message : tr("ui.79ae38b31aee"));
      });
  }, [
    browserMode,
    activeWorkflowBrowserId,
    browserState?.activePageId,
    browserState?.url,
    selectedProjectId,
    selectedWorkflowRun,
    workbenchPanel,
    workflowPanel,
    workspaceView,
  ]);
  const refreshMcpServers = useCallback(async () => {
    const servers = await api.listMcpServers();
    setMcpServers(servers);
    setSelectedMcpServerId((current) =>
      current && servers.some((server) => server.serverId === current) ? current : (servers[0]?.serverId ?? null),
    );
  }, []);
  useEffect(() => {
    if (workspaceView !== "settings" || settingsToolsCategory !== "mcp") return;
    void refreshMcpServers().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : tr("ui.9a7446f44940"));
    });
    const timer = window.setInterval(() => void refreshMcpServers().catch(() => undefined), 1000);
    return () => window.clearInterval(timer);
  }, [refreshMcpServers, settingsToolsCategory, workspaceView]);
  useEffect(() => {
    if (workspaceView !== "workflow" || !selectedProjectId) return;
    let active = true;
    void api
      .getWorkflowNodeRegistry(selectedProjectId)
      .then((registry) => {
        if (active) setWorkflowRegistry(registry);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : tr("ui.aa882d2a9e8e"));
      });
    return () => {
      active = false;
    };
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.87f33e7aa952"));
    });
  }, [refreshLocalTriggers, workflowPanel, workspaceView]);
  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "connectors") return;
    void api
      .listNativeAppConnectors()
      .then(setNativeConnectors)
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : tr("ui.83f9733a7256"));
      });
  }, [workflowPanel, workspaceView]);
  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "canvas" || !selectedProjectId) return;
    let active = true;
    setWorkflowDraftBusy(true);
    void api
      .listDesktopWorkflowDrafts(selectedProjectId)
      .then(async (summaries) => {
        if (!active) return;
        const requestedSelection = pendingWorkflowSelectionRef.current;
        const selectedSummary =
          (requestedSelection?.projectId === selectedProjectId
            ? summaries.find((summary) => summary.workflowId === requestedSelection.workflowId)
            : undefined) ?? summaries[0];
        pendingWorkflowSelectionRef.current = null;
        const draft = selectedSummary
          ? await api.getDesktopWorkflowDraft(selectedProjectId, selectedSummary.workflowId)
          : null;
        if (!active) return;
        const now = new Date().toISOString();
        setWorkflowDrafts(summaries);
        setProjectWorkflows((current) => ({ ...current, [selectedProjectId]: summaries }));
        setWorkflowDraft(
          draft ?? {
            workflowId: `workflow_${crypto.randomUUID().replaceAll("-", "")}`,
            localProjectId: selectedProjectId,
            kind: "workflow",
            name: tr("ui.764827043646"),
            nodes: [],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        );
        setWorkflowDraftDirty(false);
        setWorkflowDraftHistory(createWorkflowDraftHistory());
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : tr("ui.58ae91ecd6a0"));
      })
      .finally(() => {
        if (active) setWorkflowDraftBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selectedProjectId, workflowPanel, workflowSelectionRevision, workspaceView]);
  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "canvas") return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || isEditableKeyboardTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        if (!workflowDraftHistory.future.length) return;
        event.preventDefault();
        redoWorkflowDraft();
      } else if (key === "z") {
        if (!workflowDraftHistory.past.length) return;
        event.preventDefault();
        undoWorkflowDraft();
      } else if (key === "y") {
        if (!workflowDraftHistory.future.length) return;
        event.preventDefault();
        redoWorkflowDraft();
      }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [workflowDraft, workflowDraftBusy, workflowDraftDirty, workflowDraftHistory, workflowPanel, workspaceView]);
  useEffect(() => {
    if (workspaceView !== "workflow" || workflowPanel !== "canvas" || !selectedProjectId) {
      return;
    }
    let active = true;
    void api
      .listDesktopWorkflowRuns(selectedProjectId)
      .then((runs) => {
        if (active) setWorkflowRuns(runs);
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : tr("ui.956fab96cd92"));
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
    void api
      .listChatModels()
      .then((nextModels) => {
        if (!active) return;
        setModels(nextModels);
        setSelectedModelCode((current) =>
          nextModels.some((model) => model.code === current) ? current : (nextModels[0]?.code ?? ""),
        );
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : tr("ui.fdbed086573f"));
        }
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [state.authStatus, modelCatalogRevision]);
  async function signIn(intent: "login" | "register" = "login") {
    setAuthAction("sign-in");
    setError(null);
    try {
      setState(await api.signIn(intent));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.95760e67629a"));
    } finally {
      setAuthAction(null);
    }
  }
  async function signOut() {
    const transitionEpoch = ++stateRefreshEpochRef.current;
    authTransitionRef.current = true;
    setAuthAction("sign-out");
    setError(null);
    setConnectionError(null);
    setState((current) => signedOutWorkState(current));
    setSelectedProjectId(null);
    setSelectedSessionId(null);
    setRecentChats([]);
    setProjectChats({});
    setChatMessagesByProject({});
    setModels([]);
    setPendingChatAttachments([]);
    pendingChatAttachmentsRef.current = [];
    sessionIdsRef.current.clear();
    setWorkspaceView("chat");
    setWorkbenchPanel(null);
    if (activeRequestId) {
      await api.stopProjectMessage(activeRequestId).catch(() => undefined);
    }
    await agentWorkspace.stopActive().catch(() => undefined);
    try {
      const nextState = await api.signOut();
      if (transitionEpoch === stateRefreshEpochRef.current) {
        setState(signedOutWorkState(nextState));
      }
      activeRequestRef.current = null;
      setActiveRequestId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.d6f42c53a90f"));
      setState((current) => signedOutWorkState(current));
    } finally {
      if (transitionEpoch === stateRefreshEpochRef.current) {
        authTransitionRef.current = false;
        stateRefreshEpochRef.current += 1;
        setAuthAction(null);
      }
    }
  }
  async function switchSpace(spaceId: string): Promise<boolean> {
    if (spaceId === state.account?.activeSpaceId) return true;
    if (activeRequestId) await api.stopProjectMessage(activeRequestId).catch(() => undefined);
    await agentWorkspace.stopActive().catch(() => undefined);
    setAuthAction("switch-space");
    setError(null);
    try {
      const nextState = await api.switchSpace(spaceId);
      setState(nextState);
      activeRequestRef.current = null;
      setActiveRequestId(null);
      setSelectedProjectId(null);
      setSelectedSessionId(null);
      setRecentChats([]);
      setProjectChats({});
      setChatMessagesByProject({});
      setPendingChatAttachments([]);
      pendingChatAttachmentsRef.current = [];
      sessionIdsRef.current.clear();
      setModels([]);
      setModelCatalogRevision((value) => value + 1);
      setWorkspaceView("chat");
      setWorkbenchPanel(null);
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.6a04d3f61cac"));
      return false;
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.f5f1fed66061"));
    } finally {
      setBusyApprovalPolicyId(null);
    }
  }
  function chooseProject() {
    setError(null);
    setProjectDialogOpen(true);
  }
  function upsertRecentChat(chat: LocalProjectChatSummary) {
    setRecentChats((current) =>
      [chat, ...current.filter((item) => item.sessionId !== chat.sessionId)]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 15),
    );
  }
  async function createProjectChat(localProjectId: string | null) {
    setError(null);
    try {
      const chat = await api.createLocalProjectChat(localProjectId);
      if (localProjectId) {
        setProjectChats((current) => ({ ...current, [localProjectId]: [chat, ...(current[localProjectId] ?? [])] }));
      }
      upsertRecentChat(chat);
      setSelectedProjectId(localProjectId);
      setSelectedSessionId(chat.sessionId);
      sessionIdsRef.current.set(localProjectId ?? "__general__", chat.sessionId);
      setChatMessagesByProject((current) => ({ ...current, [chat.sessionId]: [] }));
      setWorkspaceView("chat");
      setWorkbenchPanel(null);
      return chat;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.2ac734e987b3"));
      return null;
    }
  }
  function prepareProjectChat(localProjectId: string | null) {
    abandonPendingChatAttachments();
    setSelectedProjectId(localProjectId);
    setSelectedSessionId(null);
    sessionIdsRef.current.delete(localProjectId ?? "__general__");
    setDraft("");
    setEditingMessageId(null);
    setWorkspaceView("chat");
    setWorkbenchPanel(null);
    setError(null);
  }
  function selectProjectChat(localProjectId: string | null, sessionId: string) {
    abandonPendingChatAttachments();
    setSelectedProjectId(localProjectId);
    setSelectedSessionId(sessionId);
    sessionIdsRef.current.set(localProjectId ?? "__general__", sessionId);
    setWorkspaceView("chat");
    setWorkbenchPanel(null);
    setError(null);
  }
  async function renameProjectChat(localProjectId: string | null, sessionId: string, title: string) {
    setError(null);
    try {
      const chat = await api.renameLocalProjectChat(localProjectId, sessionId, title);
      if (localProjectId) {
        setProjectChats((current) => ({
          ...current,
          [localProjectId]: (current[localProjectId] ?? []).map((item) => (item.sessionId === sessionId ? chat : item)),
        }));
      }
      upsertRecentChat(chat);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("chat.rename.error"));
    }
  }
  async function deleteProjectChat(localProjectId: string | null, sessionId: string) {
    setError(null);
    try {
      await api.deleteLocalProjectChat(localProjectId, sessionId);
      const nextChats = localProjectId
        ? (projectChats[localProjectId] ?? []).filter((item) => item.sessionId !== sessionId)
        : [];
      if (localProjectId) setProjectChats((current) => ({ ...current, [localProjectId]: nextChats }));
      const nextRecent = recentChats.filter((item) => item.sessionId !== sessionId);
      setRecentChats(nextRecent);
      setChatMessagesByProject((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      if (selectedSessionId === sessionId) {
        const nextChat = nextRecent[0] ?? null;
        setSelectedProjectId(nextChat?.localProjectId ?? null);
        setSelectedSessionId(nextChat?.sessionId ?? null);
        sessionIdsRef.current.delete(localProjectId ?? "__general__");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("chat.delete.error"));
    }
  }
  async function moveProjectChat(localProjectId: string | null, sessionId: string, targetProjectId: string | null) {
    setError(null);
    try {
      const moved = await api.moveLocalProjectChat(localProjectId, sessionId, targetProjectId);
      setProjectChats((current) => {
        const next = { ...current };
        if (localProjectId)
          next[localProjectId] = (next[localProjectId] ?? []).filter((item) => item.sessionId !== sessionId);
        if (targetProjectId)
          next[targetProjectId] = [
            moved,
            ...(next[targetProjectId] ?? []).filter((item) => item.sessionId !== sessionId),
          ];
        return next;
      });
      upsertRecentChat(moved);
      if (selectedSessionId === sessionId) {
        setSelectedProjectId(targetProjectId);
        sessionIdsRef.current.delete(localProjectId ?? "__general__");
        sessionIdsRef.current.set(targetProjectId ?? "__general__", sessionId);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("chat.move.error"));
    }
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.3b258a7b0062"));
    } finally {
      setProjectActionBusy(false);
    }
  }
  async function renameProject(localProjectId: string, displayName: string) {
    setProjectActionBusy(true);
    setError(null);
    try {
      const renamed = await api.renameProject(localProjectId, displayName);
      setState((current) => ({
        ...current,
        projects: current.projects.map((project) => (project.localProjectId === localProjectId ? renamed : project)),
      }));
      setEditingProjectId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.3b258a7b0062"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.bcaaae47ab3a"));
    }
  }
  async function removeProjectFolder(localProjectId: string, folderId: string) {
    setProjectActionBusy(true);
    setError(null);
    try {
      const updated = await api.removeProjectFolder(localProjectId, folderId);
      setState((current) => ({
        ...current,
        projects: current.projects.map((project) => (project.localProjectId === localProjectId ? updated : project)),
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.bcaaae47ab3a"));
    } finally {
      setProjectActionBusy(false);
    }
  }
  async function deleteProject(localProjectId: string) {
    setError(null);
    try {
      if (!(await api.deleteProject(localProjectId))) return;
      const nextState = await refreshState();
      if (selectedProjectId === localProjectId) {
        setSelectedProjectId(nextState.projects[0]?.localProjectId ?? null);
      }
      setChatMessagesByProject((current) => {
        const next = { ...current };
        for (const chat of projectChats[localProjectId] ?? []) delete next[chat.sessionId];
        return next;
      });
      setRecentChats((current) => current.filter((chat) => chat.localProjectId !== localProjectId));
      sessionIdsRef.current.delete(localProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.45fc995a769d"));
    }
  }
  async function openProjectFolder(localProjectId: string) {
    setError(null);
    try {
      await api.openProjectFolder(localProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.72911c630179"));
    }
  }
  async function refreshProjectFiles() {
    if (!selectedProject) return;
    setTreeLoading(true);
    setError(null);
    try {
      setProjectFiles(await api.listProjectFiles(selectedProject.localProjectId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.72911c630179"));
    } finally {
      setTreeLoading(false);
    }
  }
  async function readProjectFile(relativePath: string, selectedSheetId?: string, pageNumber?: number) {
    if (!selectedProject) return;
    setSelectedFilePath(relativePath);
    setLoading(true);
    setError(null);
    setAssetPreview(null);
    setFileVersions([]);
    setSelectedFileVersion(null);
    try {
      if (isPreviewableArtifact(relativePath)) {
        const preview = await api.previewProjectArtifact(
          selectedProject.localProjectId,
          relativePath,
          selectedSheetId,
          pageNumber,
        );
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.91b329c6465f"));
      await refreshState();
    } finally {
      setLoading(false);
    }
  }
  async function openChatArtifact(relativePath: string) {
    setWorkspaceView("chat");
    setWorkbenchPanel("files");
    await Promise.all([refreshProjectFiles(), readProjectFile(relativePath)]);
  }
  function selectProjectFile(relativePath: string) {
    if (readResult && hasFileChanges && relativePath !== selectedFilePath && !window.confirm(tr("ui.eec4753b4f44"))) {
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
    if (hasFileChanges && !window.confirm(tr("ui.bdf77cb7d7ad"))) {
      return;
    }
    const value = window.prompt(tr("ui.c1e7a0ee4c1b"));
    const relativePath = value?.trim().replaceAll("\\", "/");
    if (!relativePath) return;
    setSelectedFilePath(relativePath);
    setReadResult({
      uri: `project://${selectedProject.localProjectId}/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
      text: "",
      bytesRead: 0,
      truncated: false,
      encoding: "utf8",
      sha256: `sha256:${"0".repeat(64)}`,
    });
    setFileDraft("");
    setNewFileDraft(true);
    setFileVersions([]);
    setSelectedFileVersion(null);
    setWorkspaceView("chat");
    setWorkbenchPanel("files");
    setError(null);
  }
  async function saveProjectFile() {
    if (!selectedProject || !selectedFilePath || !readResult || savingFile) return;
    setSavingFile(true);
    setError(null);
    try {
      const result = newFileDraft
        ? await api.createProjectFile(selectedProject.localProjectId, selectedFilePath, fileDraft)
        : await api.writeProjectFile(selectedProject.localProjectId, selectedFilePath, fileDraft, readResult.sha256);
      setReadResult(result);
      setFileDraft(result.text);
      setNewFileDraft(false);
      setWorkspaceView("chat");
      setWorkbenchPanel("files");
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.e0d2c799f161"));
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
      setSelectedFileVersion(
        first ? await api.readProjectFileVersion(selectedProjectId, selectedFilePath, first.versionId) : null,
      );
      setWorkspaceView("versions");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.2dc5d53582f7"));
    } finally {
      setFileVersionBusy(false);
    }
  }
  async function selectFileVersion(versionId: string) {
    if (!selectedProjectId || !selectedFilePath || fileVersionBusy) return;
    setFileVersionBusy(true);
    setError(null);
    try {
      setSelectedFileVersion(await api.readProjectFileVersion(selectedProjectId, selectedFilePath, versionId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.11f2c6bad01f"));
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
        selectedFileVersion.versionId,
      );
      setReadResult(result);
      setFileDraft(result.text);
      setNewFileDraft(false);
      setWorkspaceView("chat");
      setWorkbenchPanel("files");
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.c5d444f7eb1e"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.cb3b73357322"));
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
      const result = await api.startProcess(selectedProject.localProjectId, command.executable, command.args);
      setProcessCommand("");
      await refreshProcesses();
      setSelectedProcessId(result.processId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.2eef8bdc23bd"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.204ef28f44d6"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.79ae38b31aee"));
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
        current && targets.some((target) => target.targetId === current) ? current : (targets[0]?.targetId ?? ""),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.ebf8ac6765be"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.e05c5b950bbf"));
    } finally {
      setBrowserBusy(false);
    }
  }
  async function runBrowserNavigation(action: "back" | "forward" | "reload") {
    if (!selectedProjectId) return;
    setError(null);
    try {
      const state =
        action === "back"
          ? await api.browserBack(selectedProjectId)
          : action === "forward"
            ? await api.browserForward(selectedProjectId)
            : await api.reloadBrowser(selectedProjectId);
      setBrowserState(state);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.603bb36cdf86"));
    }
  }
  async function toggleBrowserTakeover() {
    if (!browserState || !selectedProjectId) return;
    try {
      setBrowserState(await api.setBrowserTakeover(selectedProjectId, !browserState.userTakeover));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.925bd5f2c28f"));
    }
  }
  async function captureBrowserScreenshot() {
    if (browserMode === "managed" && !selectedProjectId) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const screenshot =
        browserMode === "attached"
          ? await api.screenshotAttachedBrowser()
          : await api.screenshotBrowser(selectedProjectId!);
      if (browserMode === "managed") await api.hideBrowser();
      setBrowserScreenshot(screenshot);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.bb56fd7a9746"));
    } finally {
      setBrowserBusy(false);
    }
  }
  async function retryManagedBrowserOperation(operationId: string) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      setBrowserState(await api.retryBrowserOperation(selectedProjectId, operationId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.5857d6ec0708"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.5b0331940091"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.9496fc31b773"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.27451fb2ca79"));
    } finally {
      setBrowserBusy(false);
    }
  }
  async function createManagedBrowserProfile(input: Parameters<RouteMarketWorkApi["createBrowserProfile"]>[1]) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      const state = await api.createBrowserProfile(selectedProjectId, input);
      setBrowserState(state);
      setBrowserAddress("https://example.com");
      setBrowserScreenshot(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.32e03f18c633"));
    } finally {
      setBrowserBusy(false);
    }
  }
  async function updateManagedBrowserProfile(
    profileId: string,
    input: Parameters<RouteMarketWorkApi["updateBrowserProfile"]>[2],
  ) {
    if (!selectedProjectId || browserBusy) return;
    setBrowserBusy(true);
    setError(null);
    try {
      setBrowserState(await api.updateBrowserProfile(selectedProjectId, profileId, input));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.86da85565178"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.d81a93e74922"));
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
        ...(workflowDraft?.kind === "workflow" ? { workflowId: workflowDraft.workflowId } : {}),
        name: triggerName.trim(),
        kind: triggerKind,
        enabled: true,
        ...(triggerKind === "file_changed" || triggerKind === "folder_added"
          ? { relativePath: triggerValue.trim() || "." }
          : triggerKind === "schedule"
            ? { intervalMinutes: Number(triggerValue) }
            : { accelerator: triggerValue.trim() }),
      });
      setTriggerName("");
      await refreshLocalTriggers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.efc43337d4c6"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.3aa399dbbf8c"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.f9415727ca71"));
    } finally {
      setTriggerBusy(false);
    }
  }
  async function toggleLocalTrigger(trigger: LocalTriggerSummary) {
    if (triggerBusy) return;
    setTriggerBusy(true);
    setError(null);
    try {
      await api.saveLocalTrigger(
        {
          localProjectId: trigger.localProjectId,
          ...(trigger.workflowId ? { workflowId: trigger.workflowId } : {}),
          name: trigger.name,
          kind: trigger.kind,
          enabled: !trigger.enabled,
          ...(trigger.relativePath ? { relativePath: trigger.relativePath } : {}),
          ...(trigger.intervalMinutes ? { intervalMinutes: trigger.intervalMinutes } : {}),
          ...(trigger.accelerator ? { accelerator: trigger.accelerator } : {}),
        },
        trigger.triggerId,
      );
      await refreshLocalTriggers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.b4bf266962bb"));
    } finally {
      setTriggerBusy(false);
    }
  }
  async function openNativeConnector(connector: NativeAppConnectorSummary) {
    if (!selectedProjectId || !connector.available || connectorBusyId) return;
    setConnectorBusyId(connector.connectorId);
    setError(null);
    try {
      const relativePath =
        connector.connectorId === "vscode" ? (selectedFilePath ?? undefined) : (selectedFilePath ?? undefined);
      if (connector.connectorId !== "vscode" && !relativePath) {
        throw new Error(tr("ui.19965a6b30d1", [connector.name]));
      }
      await api.openNativeAppConnector(connector.connectorId, selectedProjectId, relativePath);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.ca62707664e4"));
    } finally {
      setConnectorBusyId(null);
    }
  }
  function updateWorkflowDraft(mutator: (draft: DesktopWorkflowDraft) => DesktopWorkflowDraft) {
    if (!workflowDraft) return;
    const next = mutator(workflowDraft);
    if (next === workflowDraft) return;
    setWorkflowDraftHistory((current) => recordWorkflowDraftHistory(current, workflowDraft, workflowDraftDirty));
    setWorkflowDraft(next);
    setWorkflowDraftDirty(true);
  }
  function undoWorkflowDraft() {
    if (!workflowDraft || workflowDraftBusy) return;
    const step = undoWorkflowDraftHistory(workflowDraftHistory, workflowDraft, workflowDraftDirty);
    if (!step) return;
    setWorkflowDraftHistory(step.history);
    setWorkflowDraft(step.draft);
    setWorkflowDraftDirty(step.dirty);
  }
  function redoWorkflowDraft() {
    if (!workflowDraft || workflowDraftBusy) return;
    const step = redoWorkflowDraftHistory(workflowDraftHistory, workflowDraft, workflowDraftDirty);
    if (!step) return;
    setWorkflowDraftHistory(step.history);
    setWorkflowDraft(step.draft);
    setWorkflowDraftDirty(step.dirty);
  }
  function addWorkflowNode(options?: {
    executorKey?: string;
    position?: { x: number; y: number };
  }): string | null {
    const executorKey = options?.executorKey ?? workflowAddExecutor;
    const definition = workflowRegistry?.definitions.find((item) => item.executorKey === executorKey);
    if (!definition || !workflowDraft) return null;
    const index = workflowDraft.nodes.length;
    const nodeId = `node_${crypto.randomUUID().replaceAll("-", "")}`;
    updateWorkflowDraft((draft) => ({
      ...draft,
      nodes: [
        ...draft.nodes,
        {
          nodeId,
          executorKey: definition.executorKey,
          title: definition.title,
          executionTarget: definition.executionTarget,
          x: options?.position?.x ?? 48 + (index % 3) * 250,
          y: options?.position?.y ?? 70 + Math.floor(index / 3) * 150,
          config: {},
          definitionSnapshot: definition,
        },
      ],
    }));
    setWorkflowAddExecutor("");
    return nodeId;
  }
  function removeWorkflowNode(nodeId: string) {
    removeWorkflowNodes([nodeId]);
  }
  function removeWorkflowNodes(nodeIds: string[]) {
    if (!workflowDraft) return;
    const next = removeWorkflowDraftNodes(workflowDraft, nodeIds);
    if (next !== workflowDraft) updateWorkflowDraft(() => next);
  }
  function duplicateWorkflowNodes(nodeIds: string[]): string[] {
    if (!workflowDraft) return [];
    const duplicated = duplicateWorkflowDraftNodes(
      workflowDraft,
      nodeIds,
      (kind) => `${kind}_${crypto.randomUUID().replaceAll("-", "")}`,
    );
    if (duplicated.draft !== workflowDraft) {
      updateWorkflowDraft(() => duplicated.draft);
    }
    return duplicated.nodeIds;
  }
  function autoLayoutWorkflow() {
    if (!workflowDraft) return;
    const next = layoutWorkflowDraft(workflowDraft);
    if (next !== workflowDraft) {
      updateWorkflowDraft(() => next);
      setWorkflowFitViewRevision((current) => current + 1);
    }
  }
  function moveWorkflowNodes(
    positions: Array<{
      nodeId: string;
      x: number;
      y: number;
    }>,
  ) {
    if (!workflowDraft) return;
    const next = moveWorkflowDraftNodes(workflowDraft, positions);
    if (next !== workflowDraft) updateWorkflowDraft(() => next);
  }
  function updateWorkflowNodeConfig(nodeId: string, config: Record<string, unknown>) {
    updateWorkflowDraft((draft) => ({
      ...draft,
      nodes: draft.nodes.map((node) => (node.nodeId === nodeId ? { ...node, config } : node)),
    }));
  }
  async function createWorkflowFromSkill(skillId: string, values: Record<string, string>) {
    if (!selectedProjectId || !workflowRegistry) return;
    if (workflowDraftDirty && !window.confirm(tr("ui.a1c01065cd7d"))) {
      return;
    }
    setWorkflowDraftBusy(true);
    try {
      const skill = workflowSkillById(skillId);
      const draft = skill.createDraft({
        localProjectId: selectedProjectId,
        definitions: workflowRegistry.definitions,
        values,
      });
      const saved = await api.saveDesktopWorkflowDraft(draft);
      const trigger = skill.createTrigger?.({
        localProjectId: selectedProjectId,
        draft: saved,
        values,
      });
      if (trigger) await api.saveLocalTrigger(trigger);
      setWorkflowDraft(saved);
      const summaries = await api.listDesktopWorkflowDrafts(selectedProjectId);
      setWorkflowDrafts(summaries);
      setProjectWorkflows((current) => ({ ...current, [selectedProjectId]: summaries }));
      if (trigger) await refreshLocalTriggers();
      setWorkflowDraftHistory(createWorkflowDraftHistory());
      setWorkflowDraftDirty(false);
      setWorkflowRunInput("{}");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.30c238d1d098"));
    } finally {
      setWorkflowDraftBusy(false);
    }
  }
  function connectWorkflowNodes(
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortId?: string,
    targetPortId?: string,
  ) {
    if (!workflowDraft) return;
    const next = connectWorkflowDraftNodes(
      workflowDraft,
      sourceNodeId,
      targetNodeId,
      `edge_${crypto.randomUUID().replaceAll("-", "")}`,
      sourcePortId,
      targetPortId,
    );
    if (next !== workflowDraft) updateWorkflowDraft(() => next);
  }
  function removeWorkflowEdges(edgeIds: string[]) {
    if (!workflowDraft) return;
    const next = removeWorkflowDraftEdges(workflowDraft, edgeIds);
    if (next !== workflowDraft) updateWorkflowDraft(() => next);
  }
  async function saveWorkflowDraft() {
    if (!workflowDraft || workflowDraftBusy) return;
    setWorkflowDraftBusy(true);
    setError(null);
    try {
      const saved = await api.saveDesktopWorkflowDraft(workflowDraft);
      setWorkflowDraft(saved);
      const summaries = await api.listDesktopWorkflowDrafts(saved.localProjectId);
      setWorkflowDrafts(summaries);
      setProjectWorkflows((current) => ({ ...current, [saved.localProjectId]: summaries }));
      setWorkflowRegistry(await api.getWorkflowNodeRegistry(saved.localProjectId));
      setWorkflowDraftHistory(createWorkflowDraftHistory());
      setWorkflowDraftDirty(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.35d3bfe1137d"));
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
      setProjectWorkflows((current) => ({ ...current, [selectedProjectId]: summaries }));
      setWorkflowRegistry(await api.getWorkflowNodeRegistry(selectedProjectId));
      const next = summaries[0] ? await api.getDesktopWorkflowDraft(selectedProjectId, summaries[0].workflowId) : null;
      const now = new Date().toISOString();
      setWorkflowDraft(
        next ?? {
          workflowId: `workflow_${crypto.randomUUID().replaceAll("-", "")}`,
          localProjectId: selectedProjectId,
          kind: "workflow",
          name: tr("ui.764827043646"),
          nodes: [],
          edges: [],
          createdAt: now,
          updatedAt: now,
        },
      );
      setWorkflowDraftHistory(createWorkflowDraftHistory());
      setWorkflowDraftDirty(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.61244506e19a"));
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
        throw new Error(tr("ui.31bed9f45c64"));
      }
      const run = await api.runDesktopWorkflow(
        selectedProjectId,
        workflowDraft.workflowId,
        input as Record<string, unknown>,
      );
      setWorkflowRuns((current) => upsertWorkflowRun(current, run));
      if (workflowDraft.nodes.some((node) => node.executorKey.startsWith("local.browser."))) {
        setBrowserScreenshot(null);
        setWorkbenchPanel("browser");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.5d3304ac12b8"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.73b2ccf09a9e"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.413ff0e05cd2"));
    } finally {
      setWorkflowRunBusy(false);
    }
  }
  async function resumeWorkflowRun() {
    if (!selectedWorkflowRun || selectedWorkflowRun.status !== "waiting_for_user" || workflowRunBusy) {
      return;
    }
    setWorkflowRunBusy(true);
    setError(null);
    try {
      const run = await api.resumeDesktopWorkflowRun(selectedWorkflowRun.runId);
      setWorkflowRuns((current) => upsertWorkflowRun(current, run));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.a26d360b8dc5"));
    } finally {
      setWorkflowRunBusy(false);
    }
  }
  async function openWorkflowArtifact(action: "open" | "reveal") {
    if (!selectedWorkflowRun || workflowRunBusy) return;
    setWorkflowRunBusy(true);
    setError(null);
    try {
      await api.openDesktopWorkflowArtifact(selectedWorkflowRun.runId, action);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.fa08b301d24b"));
    } finally {
      setWorkflowRunBusy(false);
    }
  }
  async function selectWorkflowDraft(workflowId: string) {
    if (!selectedProjectId || workflowDraftBusy || workflowId === workflowDraft?.workflowId) return;
    if (workflowDraftDirty && !window.confirm(tr("ui.83d78f6a8f78"))) return;
    setWorkflowDraftBusy(true);
    setError(null);
    try {
      setWorkflowDraft(await api.getDesktopWorkflowDraft(selectedProjectId, workflowId));
      setWorkflowDraftHistory(createWorkflowDraftHistory());
      setWorkflowDraftDirty(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.3dd5c789971e"));
    } finally {
      setWorkflowDraftBusy(false);
    }
  }
  function createWorkflowDraft(kind: DesktopWorkflowDraft["kind"]) {
    if (!selectedProjectId) return;
    if (workflowDraftDirty && !window.confirm(tr("ui.1e44d6b7c346"))) return;
    const now = new Date().toISOString();
    setWorkflowDraft({
      workflowId: `${kind === "local_action" ? "action" : "workflow"}_${crypto.randomUUID().replaceAll("-", "")}`,
      localProjectId: selectedProjectId,
      kind,
      name: kind === "local_action" ? tr("ui.fa3074b7df4e") : tr("ui.764827043646"),
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
    });
    setWorkflowDraftHistory(createWorkflowDraftHistory());
    setWorkflowDraftDirty(true);
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
        ...(command
          ? { command: command.executable, args: command.args }
          : {
              args: [],
              url: mcpCommand.trim(),
            }),
        localProjectId: selectedProjectId,
      });
      setMcpName("");
      setMcpCommand("");
      await refreshMcpServers();
      setSelectedMcpServerId(server.serverId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.4cf38df3896d"));
    } finally {
      setMcpBusy(false);
    }
  }
  async function installFeaturedMcp(name: string, url: string) {
    if (mcpBusy || mcpServers.some((server) => server.url === url)) return;
    setMcpBusy(true);
    setError(null);
    try {
      const server = await api.installMcpServer({
        name,
        transport: "streamable-http",
        args: [],
        url,
        localProjectId: selectedProjectId,
      });
      await refreshMcpServers();
      setSelectedMcpServerId(server.serverId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.4cf38df3896d"));
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
      setError(nextError instanceof Error ? nextError.message : tr("ui.3d00cf3cbe32"));
    } finally {
      setMcpBusy(false);
    }
  }
  async function removeLocalMcp() {
    if (!selectedMcpServer || mcpBusy) return;
    if (!window.confirm(tr("ui.ee7444866a65", [selectedMcpServer.name]))) return;
    setMcpBusy(true);
    setError(null);
    try {
      await api.removeMcpServer(selectedMcpServer.serverId);
      setMcpResult("");
      await refreshMcpServers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.5866082717d2"));
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
        throw new Error(tr("ui.959e6e423525"));
      }
      const result = await api.callMcpTool(
        selectedMcpServer.serverId,
        selectedMcpTool.name,
        parsed as Record<string, unknown>,
      );
      setMcpResult(JSON.stringify(result, null, 2));
      await refreshState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.f96ff9cd1312"));
    } finally {
      setMcpBusy(false);
    }
  }
  async function sendMessage(messageOverride?: string, attachmentOverride?: DesktopChatAttachment[]) {
    const message = (messageOverride ?? draft).trim();
    const attachments = attachmentOverride ?? pendingChatAttachments;
    const selectedAgent = agentWorkspace.model.selectedAgent;
    if ((!message && !attachments.length) || !selectedModelCode || activeRequestId) return;
    if (state.authStatus !== "signed_in") {
      setError(tr("ui.14b469c15fbf"));
      return;
    }
    let sessionId = selectedSessionId;
    if (!sessionId) {
      const chat = await createProjectChat(selectedProjectId);
      if (!chat) return;
      sessionId = chat.sessionId;
    }
    const selectedSkill = projectContext?.skills.find((skill) => skill.id === selectedProjectSkillId);
    let projectSkill: ProjectChatRequest["projectSkill"];
    if (selectedSkill && selectedProject) {
      try {
        const skillFile = await api.readProjectFile(selectedProject.localProjectId, selectedSkill.relativePath);
        projectSkill = {
          id: selectedSkill.id,
          name: selectedSkill.name,
          relativePath: selectedSkill.relativePath,
          text: skillFile.text.slice(0, 64000),
          truncated: skillFile.truncated || skillFile.text.length > 64000,
        };
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : tr("ui.2ac734e987b3"));
        return;
      }
    }
    let requestMessages = chatMessages;
    if (editingMessageId) {
      try {
        requestMessages = messagesForEditedUserResend(requestMessages, editingMessageId);
      } catch {
        setEditingMessageId(null);
        setError(tr("ui.208939b7664e"));
        return;
      }
      setEditingMessageId(null);
    }
    const activeAgentVersion = resolveConversationAgentVersion(
      requestMessages,
      selectedAgent,
      agentVersionKey ? adoptedAgentRevisions[agentVersionKey] : undefined,
    );
    const requestId = `work_chat_${crypto.randomUUID().replaceAll("-", "")}`;
    sessionIdsRef.current.set(selectedProjectId ?? "__general__", sessionId);
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user:${requestId}`,
      role: "user",
      content: message,
      sentAt,
      ...(attachments.length ? { attachments } : {}),
      ...(includeFileContext && selectedFilePath ? { contextFile: selectedFilePath } : {}),
    };
    const assistantMessage: ChatMessage = {
      id: `assistant:${requestId}`,
      role: "assistant",
      content: "",
      sentAt,
      ...(selectedAgent && activeAgentVersion
        ? {
            agentId: selectedAgent.id,
            agentRevision: activeAgentVersion.activeRevision,
            agentName: activeAgentVersion.name,
            agentAvatarUrl: activeAgentVersion.avatarUrl,
          }
        : {}),
    };
    setChatMessagesByProject((current) => ({
      ...current,
      [sessionId]: [...requestMessages, userMessage, assistantMessage],
    }));
    if (selectedProject) {
      setProjectChats((current) => ({
        ...current,
        [selectedProject.localProjectId]: (current[selectedProject.localProjectId] ?? []).map((chat) =>
          chat.sessionId === sessionId
            ? { ...chat, title: message.trim().slice(0, 80) || chat.title, updatedAt: sentAt }
            : chat,
        ),
      }));
    }
    setRecentChats((current) =>
      current
        .map((chat) =>
          chat.sessionId === sessionId
            ? { ...chat, title: message.trim().slice(0, 80) || chat.title, updatedAt: sentAt }
            : chat,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    setDraft("");
    setPendingChatAttachments([]);
    setError(null);
    activeRequestRef.current = {
      requestId,
      sessionId,
    };
    setActiveRequestId(requestId);
    try {
      await api.sendProjectMessage({
        requestId,
        sessionId,
        sentAt,
        model: selectedModelCode,
        webSearchMode,
        modelSupportsTools: selectedChatModel?.supportsTools === true,
        modelSupportsVision: selectedChatModel?.supportsVision === true,
        preferredChatProtocol: selectedChatModel?.preferredChatProtocol ?? null,
        ...(deepThinkingEnabled &&
        selectedChatModel?.preferredChatProtocol === "openai_responses" &&
        selectedChatModel.supportsReasoningSummary
          ? { reasoningSummary: "auto" as const, reasoningEffort: "high" as const }
          : {}),
        message,
        ...(attachments.length ? { attachments } : {}),
        ...(selectedProject
          ? {
              project: {
                localProjectId: selectedProject.localProjectId,
                displayName: selectedProject.displayName,
                hasFolder: selectedFolderAvailable,
              },
            }
          : {}),
        ...(projectContext ? { projectContext } : {}),
        ...(projectSkill ? { projectSkill } : {}),
        ...(selectedAgent && activeAgentVersion
          ? {
              agent: {
                agentId: selectedAgent.id,
                agentRevision: activeAgentVersion.activeRevision,
                executionEnvironment,
                agentName: activeAgentVersion.name,
                agentAvatarUrl: activeAgentVersion.avatarUrl,
                localToolGroups: agentWorkspace.model.localToolGroups,
                maxToolRounds: agentWorkspace.model.maxToolRounds,
              },
            }
          : {}),
        ...(selectedProject && includeFileContext && selectedFilePath && readResult
          ? {
              contextFile: {
                relativePath: selectedFilePath,
                uri: readResult.uri,
                text: readResult.text,
                truncated: readResult.truncated,
              },
            }
          : {}),
      });
    } catch (nextError) {
      const messageText = nextError instanceof Error ? nextError.message : tr("ui.782a72701540");
      setChatMessagesByProject((current) =>
        updateAssistantMessage(current, sessionId, requestId, (assistant) => ({
          ...assistant,
          content: tr("ui.027658a32984", [messageText]),
        })),
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
      if (prior?.role === "user" && (prior.content.trim() || prior.attachments?.length)) {
        void sendMessage(prior.content, prior.attachments);
        return;
      }
    }
  }
  async function chooseChatAttachments() {
    if (activeRequestId || chatAttachmentsBusy) return;
    setError(null);
    setChatAttachmentsBusy(true);
    try {
      const selected = await api.chooseChatAttachments(Math.max(0, 6 - pendingChatAttachments.length));
      if (!selected.length) return;
      setPendingChatAttachments((current) => {
        return [...current, ...selected].slice(0, 6);
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.f8b7fe595ddd"));
    } finally {
      setChatAttachmentsBusy(false);
    }
  }
  async function uploadChatAttachmentFiles(files: File[]) {
    if (activeRequestId || chatAttachmentsBusy || !files.length) return;
    const current = pendingChatAttachmentsRef.current;
    const remaining = Math.max(0, 6 - current.length);
    if (!remaining || files.length > remaining) {
      setError(tr("ui.2a2ef22d4f76", [remaining]));
      return;
    }
    const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
    if (oversized) {
      setError(tr("chat.attachments.fileTooLarge", [oversized.name, 20]));
      return;
    }
    const totalSize = current.reduce((sum, attachment) => sum + attachment.size, 0) +
      files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 60 * 1024 * 1024) {
      setError(tr("ui.477505da461e"));
      return;
    }
    setError(null);
    setChatAttachmentsBusy(true);
    const stagingAttachments = files.map((file, index): DesktopChatAttachment => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      return {
        id: `attachment_uploading_${Date.now()}_${index}`,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        kind: file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("audio/")
            ? "audio"
            : file.type.startsWith("video/")
              ? "video"
              : "file",
        textExcerpt: null,
        assetId: "",
        downloadUrl: previewUrl ?? "",
        previewUrl
      };
    });
    setUploadingChatAttachments(stagingAttachments);
    try {
      const uploads = await Promise.all(files.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        size: file.size,
        bytes: new Uint8Array(await file.arrayBuffer())
      })));
      const selected = await api.uploadChatAttachments(uploads);
      if (!selected.length) return;
      setPendingChatAttachments((attachments) => [...attachments, ...selected].slice(0, 6));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.f8b7fe595ddd"));
    } finally {
      for (const attachment of stagingAttachments) {
        if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
      }
      setUploadingChatAttachments([]);
      setChatAttachmentsBusy(false);
    }
  }
  async function removeChatAttachment(attachmentId: string) {
    setPendingChatAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    try {
      await api.discardChatAttachment(attachmentId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.c9af3c785b2d"));
    }
  }
  function chooseRecentChatAttachment(attachment: DesktopChatAttachment) {
    if (activeRequestId) return;
    setPendingChatAttachments((current) => {
      if (current.some((item) => item.id === attachment.id)) return current;
      return [...current, attachment].slice(0, 6);
    });
  }
  async function clearChatAttachments() {
    const current = pendingChatAttachmentsRef.current;
    setPendingChatAttachments([]);
    const results = await Promise.allSettled(current.map((attachment) => api.discardChatAttachment(attachment.id)));
    const rejection = results.find((result) => result.status === "rejected");
    if (rejection?.status === "rejected") {
      setError(rejection.reason instanceof Error ? rejection.reason.message : tr("ui.c9af3c785b2d"));
    }
  }
  async function stopMessage() {
    if (!activeRequestId) return;
    await api.stopProjectMessage(activeRequestId);
  }
  function renderFilesWorkbench() {
    const conversationFilesActive = visibleWorkbenchPanel === "conversation-files";
    const conversationPathSet = new Set(conversationSourcePaths);
    const scopedSearchResult = conversationFilesActive && searchResult
      ? {
          ...searchResult,
          matches: searchResult.matches.filter((match) => conversationPathSet.has(match.relativePath)),
          filesScanned: conversationPathSet.size
        }
      : searchResult;
    return (
      <FilesPage
        model={{
          selectedProject,
          navigatorTitle: conversationFilesActive ? tr("output.conversationFiles") : undefined,
          navigatorSubtitle: conversationFilesActive
            ? (selectedChatTitle ?? tr("output.currentConversation"))
            : undefined,
          projectFiles: conversationFilesActive
            ? buildConversationFileTree(projectFiles, conversationSourcePaths)
            : projectFiles,
          treeLoading,
          searchQuery,
          searchResult: scopedSearchResult,
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
          error,
        }}
        actions={{
          onChooseProject: () => void chooseProject(),
          onRefreshFiles: () => void refreshProjectFiles(),
          onCreateFile: prepareNewProjectFile,
          onSearch: setSearchQuery,
          onSelectFile: selectProjectFile,
          onSelectSheet: (sheetId) => {
            if (selectedFilePath) void readProjectFile(selectedFilePath, sheetId);
          },
          onSelectPdfPage: (pageNumber) => {
            if (selectedFilePath) void readProjectFile(selectedFilePath, undefined, pageNumber);
          },
          onExportFile: () => void exportSelectedProjectFile(),
          onOpenVersions: () => void openFileVersions(),
          onReviewChanges: reviewProjectFileChanges,
          onDraftChange: setFileDraft,
          onDismissError: () => setError(null),
        }}
      />
    );
  }
  function renderTerminalWorkbench() {
    return (
      <section className="terminal-pane">
        <div className="terminal-toolbar">
          <div className="terminal-command">
            <span>$</span>
            <input
              value={processCommand}
              placeholder={tr("ui.f1dfc3dce904")}
              aria-label={tr("ui.64e5f7ae3d63")}
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
              {processBusy ? <LoaderCircle className="spin" size={14} /> : <SquareTerminal size={14} />}{" "}
              {tr("ui.0c3acd446f19")}
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
                <small>
                  {process.status}
                  {process.exitCode === null ? "" : ` · ${process.exitCode}`}
                </small>
              </button>
            ))}
            {processes.length === 0 && <div className="process-empty">{tr("ui.3ae4096d7128")}</div>}
          </div>
          <div className="terminal-output">
            <div className="terminal-output-header">
              <span>
                {selectedProcess ? [selectedProcess.executable, ...selectedProcess.args].join(" ") : "Terminal"}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={!selectedProcess || selectedProcess.status !== "running" || processBusy}
                onClick={() => void stopProjectProcess()}
              >
                <Square size={12} fill="currentColor" />
                {tr("ui.a17f70a8d3d6")}
              </button>
            </div>
            <pre>
              {selectedProcess
                ? `${selectedProcess.stdout}${selectedProcess.stderr ? `\n[stderr]\n${selectedProcess.stderr}` : ""}`
                : tr("ui.db4e0ec0994f")}
            </pre>
            {selectedProcess?.outputTruncated && <span className="output-truncated">{tr("ui.0c76fca6a0ae")}</span>}
          </div>
        </div>
      </section>
    );
  }
  function renderBrowserWorkbench() {
    return (
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
          error,
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
          onUpdateProfile: (profileId, input) => void updateManagedBrowserProfile(profileId, input),
          onDeleteProfile: (profileId) => void deleteManagedBrowserProfile(profileId),
          onCaptureScreenshot: () => void captureBrowserScreenshot(),
          onRetryOperation: (operationId) => void retryManagedBrowserOperation(operationId),
          onCloseScreenshot: () => setBrowserScreenshot(null),
          onAttachedEndpointChange: setAttachedEndpoint,
          onDiscoverAttachedTargets: () => void discoverAttachedTargets(),
          onSelectedAttachedTargetChange: setSelectedAttachedTargetId,
          onToggleAttachedConnection: () => void toggleAttachedConnection(),
          onDismissError: () => setError(null),
          onViewportLayoutChange: requestBrowserBoundsSync,
        }}
        viewportRef={browserViewportRef}
        addressRef={browserAddressRef}
      />
    );
  }
  if (!stateLoaded || state.authStatus !== "signed_in") {
    return (
      <AuthGate
        api={api}
        loading={!stateLoaded}
        state={state}
        busy={authAction !== null}
        connectionError={connectionError ?? error}
        onSignIn={() => void signIn("login")}
        onRegister={() => void signIn("register")}
        onCancel={() => void signOut()}
      />
    );
  }
  const selectedChat = selectedSessionId
    ? (recentChats.find((chat) => chat.sessionId === selectedSessionId) ??
      (selectedProjectId
        ? projectChats[selectedProjectId]?.find((chat) => chat.sessionId === selectedSessionId)
        : null))
    : null;
  const selectedChatTitle = selectedChat?.title ?? null;
  const visibleWorkbenchPanel = workspaceSupportsWorkbench(workspaceView) ? workbenchPanel : null;
  const workbenchTitle =
    visibleWorkbenchPanel === "conversation-files"
      ? (selectedFilePath ?? tr("output.conversationFiles"))
      : visibleWorkbenchPanel === "files"
      ? (selectedFilePath ?? tr("workbench.files"))
      : visibleWorkbenchPanel === "terminal"
        ? selectedProcess
          ? [selectedProcess.executable, ...selectedProcess.args].join(" ")
          : tr("workbench.terminal")
        : tr("workbench.browser");
  function toggleSettings() {
    if (workspaceView === "settings") {
      const previous = settingsReturnViewRef.current;
      setWorkspaceView(previous.view);
      setWorkbenchPanel(previous.view === "chat" ? previous.workbenchPanel : null);
      return;
    }
    settingsReturnViewRef.current = { view: workspaceView, workbenchPanel };
    setSettingsInitialView("general");
    setWorkspaceView("settings");
    setWorkbenchPanel(null);
  }
  function openModelProviders() {
    if (workspaceView !== "settings") {
      settingsReturnViewRef.current = { view: workspaceView, workbenchPanel };
    }
    setSettingsInitialView("providers");
    setWorkspaceView("settings");
    setWorkbenchPanel(null);
  }
  function openToolsAndExtensions() {
    if (workspaceView !== "settings") {
      settingsReturnViewRef.current = { view: workspaceView, workbenchPanel };
    }
    setSettingsInitialView("extensions");
    setWorkspaceView("settings");
    setWorkbenchPanel(null);
  }
  const projectSkillActions =
    selectedProjectId && selectedFolderAvailable
      ? {
          localProjectId: selectedProjectId,
          list: () => api.listProjectSkills(selectedProjectId),
          listCloud: () => api.listDownloadableCloudSkills(),
          install: (importKind: LocalSkillImportKind) =>
            api.chooseAndInstallProjectSkill(selectedProjectId, importKind),
          installCloud: (skillId: string, versionId: string) =>
            api.installCloudSkill(selectedProjectId, skillId, versionId),
          remove: (skillId: string) => api.removeInstalledProjectSkill(selectedProjectId, skillId),
          onChanged: async () => {
            const context = await api.getProjectContext(selectedProjectId);
            setProjectContext(context);
          },
        }
      : null;
  function selectCreationMode(mode: Extract<WorkspaceView, "chat" | "image" | "video" | "audio">) {
    if (mode === "chat") {
      prepareProjectChat(null);
      return;
    }
    setWorkspaceView(mode);
    setWorkbenchPanel(null);
  }
  return (
    <div
      className={`app-shell ${visibleWorkbenchPanel ? "has-workbench" : ""}`}
      style={
        visibleWorkbenchPanel ? ({ "--workbench-panel-width": `${workbenchPanelWidth}px` } as CSSProperties) : undefined
      }
    >
      <AppTitleBar
        api={api}
        model={{ title: "", canOpenProjectFolder: Boolean(selectedProject && selectedFolderAvailable) }}
        actions={{
          onNewChat: () => prepareProjectChat(null),
          onNewProject: chooseProject,
          onOpenProjectFolder: () => {
            if (selectedProject) void openProjectFolder(selectedProject.localProjectId);
          },
          onToggleRail: () => window.dispatchEvent(new Event("routemarket:toggle-rail")),
          onOpenFiles: () => {
            if (selectedProject) {
              setWorkspaceView("chat");
              setWorkbenchPanel("files");
            }
          },
          onOpenTerminal: () => {
            if (selectedProject) {
              setWorkspaceView("chat");
              setWorkbenchPanel("terminal");
            }
          },
          onOpenBrowser: () => {
            if (selectedProject) {
              setWorkspaceView("chat");
              setWorkbenchPanel("browser");
            }
          },
          onOpenSettings: toggleSettings,
          onCheckUpdates: () => {
            void api.checkForUpdates();
          },
        }}
      />
      <AppRail
        activeView={workspaceView}
        state={state}
        extensions={desktopExtensions}
        selectedProjectId={selectedProjectId}
        selectedSessionId={selectedSessionId}
        selectedWorkflowId={workflowDraft?.workflowId ?? null}
        projectChats={projectChats}
        projectWorkflows={projectWorkflows}
        recentChats={recentChats}
        authBusy={authAction !== null}
        onSelect={(view) => {
          if (view === "settings") {
            toggleSettings();
            return;
          }
          setWorkspaceView(view);
          if (!workspaceSupportsWorkbench(view)) setWorkbenchPanel(null);
        }}
        onSelectExtension={(pluginId, pageId) => void openDesktopExtension(pluginId, pageId)}
        onOpenTools={openToolsAndExtensions}
        onCreateProject={chooseProject}
        onCreateChat={prepareProjectChat}
        onSelectChat={selectProjectChat}
        onSelectWorkflow={(projectId, workflowId) => {
          if (workflowDraftDirty && !window.confirm(tr("ui.83d78f6a8f78"))) return;
          if (projectId === selectedProjectId && workspaceView === "workflow" && workflowPanel === "canvas") {
            void selectWorkflowDraft(workflowId);
            return;
          }
          pendingWorkflowSelectionRef.current = { projectId, workflowId };
          setSelectedProjectId(projectId);
          setSelectedSessionId(null);
          setWorkflowPanel("canvas");
          setWorkspaceView("workflow");
          setError(null);
        }}
        onRenameChat={(projectId, sessionId, title) => void renameProjectChat(projectId, sessionId, title)}
        onMoveChat={(projectId, sessionId, targetProjectId) =>
          void moveProjectChat(projectId, sessionId, targetProjectId)
        }
        onDeleteChat={(projectId, sessionId) => void deleteProjectChat(projectId, sessionId)}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setSelectedSessionId(null);
          setWorkspaceView("chat");
          setError(null);
        }}
        onAttachProjectFolder={(projectId) => void attachProjectFolder(projectId)}
        onOpenProjectFolder={(projectId) => void openProjectFolder(projectId)}
        onEditProject={setEditingProjectId}
        onDeleteProject={(projectId) => void deleteProject(projectId)}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        onSwitchSpace={switchSpace}
        onUpgrade={() => void api.executeMenuCommand("openPlanUpgrade")}
        onTopUpCredits={() => void api.executeMenuCommand("openCreditsTopUp")}
        onOpenCreditsUsage={() => void api.executeMenuCommand("openCreditsUsage")}
        onOpenAccountCenter={() => void api.executeMenuCommand("openAccountCenter")}
      />
      <main
        className={`workspace ${workspaceView === "settings" || workspaceView === "image" || workspaceView === "video" || workspaceView === "audio" || workspaceView.startsWith("plugin:") ? "workspace-app-view" : ""}`}
      >
        {workspaceView !== "settings" &&
          workspaceView !== "image" &&
          workspaceView !== "video" &&
          workspaceView !== "audio" &&
          !workspaceView.startsWith("plugin:") && (
            <header className="workspace-header">
              {workspaceView === "chat" ? (
                <div className="workspace-conversation-title" onPointerDown={(event) => event.stopPropagation()}>
                  <span title={selectedChatTitle ?? tr("nav.newChat")}>{selectedChatTitle ?? tr("nav.newChat")}</span>
                  {selectedChat && (
                    <button
                      className="workspace-conversation-menu-trigger"
                      type="button"
                      aria-label={tr("chat.menu")}
                      aria-haspopup="menu"
                      aria-expanded={headerChatMenuOpen}
                      onClick={() => setHeaderChatMenuOpen((current) => !current)}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                  {selectedChat && headerChatMenuOpen && (
                    <div className="workspace-conversation-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setHeaderChatMenuOpen(false);
                          setHeaderChatDialogValue(selectedChat.title);
                          setHeaderChatDialog("rename");
                        }}
                      >
                        <Pencil size={14} />
                        {tr("chat.rename")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setHeaderChatMenuOpen(false);
                          setHeaderChatDialogValue(selectedChat.localProjectId ?? "__general__");
                          setHeaderChatDialog("move");
                        }}
                      >
                        <MoveRight size={14} />
                        {tr("chat.move")}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setHeaderChatMenuOpen(false);
                          setHeaderChatDialog("delete");
                        }}
                      >
                        <Trash2 size={14} />
                        {tr("chat.delete")}
                      </button>
                    </div>
                  )}
                </div>
              ) : workspaceView === "workflow" ? (
                <div className="workspace-workflow-heading" onPointerDown={(event) => event.stopPropagation()}>
                  <input
                    className="workspace-workflow-title-input"
                    value={workflowDraft?.name ?? tr("ui.cc19798b0c12")}
                    aria-label={tr("ui.2c447fbe91b7")}
                    disabled={!workflowDraft || workflowDraftBusy}
                    onChange={(event) => updateWorkflowDraft((draft) => ({ ...draft, name: event.target.value }))}
                  />
                  {workflowDraft && (
                    <>
                      <span className="workspace-workflow-meta">
                        {workflowDraft.nodes.length}{tr("ui.67ff2a2cd962")}{workflowDraft.edges.length}{tr("ui.99276b8f6d58")}
                      </span>
                      <span
                        className={`workspace-workflow-save-state${workflowDraftDirty ? " dirty" : ""}`}
                        title={workflowDraftDirty
                          ? tr("ui.7fbaa2eee695")
                          : workflowDraft.updatedAt
                            ? tr("ui.5ef815d634c4", [new Date(workflowDraft.updatedAt).toLocaleString()])
                            : tr("ui.8107ccd58593")}
                        aria-label={workflowDraftDirty ? tr("ui.7fbaa2eee695") : tr("ui.8107ccd58593")}
                      />
                      <div className="workspace-workflow-history">
                        <button
                          type="button"
                          title={tr("ui.3fe650dc6ef0")}
                          aria-label={tr("ui.9fcefd8dc81e")}
                          disabled={!workflowDraftHistory.past.length || workflowDraftBusy}
                          onClick={undoWorkflowDraft}
                        >
                          <Undo2 size={15} />
                        </button>
                        <button
                          type="button"
                          title={tr("ui.60df20024887")}
                          aria-label={tr("ui.1238f0d36361")}
                          disabled={!workflowDraftHistory.future.length || workflowDraftBusy}
                          onClick={redoWorkflowDraft}
                        >
                          <Redo2 size={15} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div />
              )}
              <div className="header-actions">
                {selectedProject && !selectedFolderAvailable && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void attachProjectFolder(selectedProject.localProjectId)}
                  >
                    <FolderOpen size={15} />
                    {selectedFolderStatus === "unlinked" ? tr("ui.61fcab68565d") : tr("ui.70e2de3b8d74")}
                  </button>
                )}
                <div className="workspace-tool-buttons" role="toolbar" aria-label={tr("workbench.tools")}>
                  <OutputMenu
                    activePanel={visibleWorkbenchPanel}
                    contextKey={`${selectedProjectId ?? ""}:${selectedSessionId ?? ""}`}
                    disabled={!selectedProject}
                    localFilesDisabled={Boolean(selectedProject && !selectedFolderAvailable)}
                    files={projectFiles}
                    processes={processes}
                    browserState={browserState}
                    selectedFilePath={selectedFilePath}
                    selectedProcessId={selectedProcessId}
                    conversationSourcePaths={conversationSourcePaths}
                    onOpen={() => {
                      void refreshProcesses();
                      void refreshProjectFiles();
                    }}
                    onRefreshProcesses={() => {
                      void refreshProcesses();
                    }}
                    onCreateFile={prepareNewProjectFile}
                    onOpenPanel={(panel) => {
                      setWorkspaceView("chat");
                      if (panel === "browser") setBrowserScreenshot(null);
                      setWorkbenchPanel(panel);
                    }}
                    onViewAllSources={() => {
                      setWorkspaceView("chat");
                      setWorkbenchPanel("conversation-files");
                      setSelectedFilePath(null);
                      setReadResult(null);
                      setAssetPreview(null);
                      setFileDraft("");
                      setSearchQuery("");
                    }}
                    onOpenProcess={(processId) => {
                      setSelectedProcessId(processId);
                      setWorkspaceView("chat");
                      setWorkbenchPanel("terminal");
                    }}
                    onOpenFile={(relativePath) => {
                      setWorkspaceView("chat");
                      setWorkbenchPanel("conversation-files");
                      selectProjectFile(relativePath);
                    }}
                  />
                  <span className="workspace-tool-divider" />
                  <button
                    className={workspaceView === "changes" ? "active" : ""}
                    type="button"
                    disabled={!hasFileChanges}
                    title={tr("ui.9d83d547ff13")}
                    onClick={reviewProjectFileChanges}
                  >
                    <GitBranch size={16} />
                    {hasFileChanges && <span className="change-dot" />}
                  </button>
                  <button
                    className={workspaceView === "versions" ? "active" : ""}
                    type="button"
                    disabled={!readResult || newFileDraft}
                    title={tr("ui.989d1affa089")}
                    onClick={() => void openFileVersions()}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    className={workspaceView === "approvals" ? "active" : ""}
                    type="button"
                    title={tr("ui.5ce60cb75d20")}
                    onClick={() => setWorkspaceView("approvals")}
                  >
                    <ShieldCheck size={16} />
                  </button>
                </div>
                <ActivityMenu
                  activities={state.activities}
                  onClear={() => {
                    void api
                      .clearActivities()
                      .then(setState)
                      .catch((nextError) => {
                        setError(nextError instanceof Error ? nextError.message : tr("ui.3f14c6a8a6ea"));
                      });
                  }}
                />
              </div>
            </header>
          )}

        <div className="workspace-body">
          {state.workerStatus === "offline" && (
            <div className="workspace-offline-banner" role="status">
              <CircleAlert size={15} />
              <span>{tr("ui.cb0421fb2cb9")}</span>
              <button type="button" onClick={() => void refreshState().catch(handleConnectionError)}>
                <RefreshCw size={13} />
                {tr("ui.bac95e1e52fe")}
              </button>
            </div>
          )}
          {workspaceView.startsWith("plugin:") ? (
            <ExtensionFrame
              api={api}
              extension={desktopExtensions.find((item) => item.pluginId === extensionSelection?.pluginId) ?? null}
              page={extensionPage}
              loading={extensionLoading}
              error={extensionError}
              onRetry={() => {
                if (extensionSelection) void openDesktopExtension(extensionSelection.pluginId, extensionSelection.pageId);
              }}
            />
          ) : workspaceView === "settings" ? (
            <SettingsPage
              dataApi={api}
              initialView={settingsInitialView}
              onProvidersChanged={() => setModelCatalogRevision((value) => value + 1)}
              onPluginsChanged={async () => {
                const extensions = await api.listDesktopExtensions();
                setDesktopExtensions(extensions);
              }}
              onToolsCategoryChange={setSettingsToolsCategory}
              tools={{
                agent: (
                  <AgentPage
                    model={agentWorkspace.model}
                    actions={agentWorkspace.actions}
                    onOpenMarketplace={() => void api.executeMenuCommand("openMarketplace")}
                    onOpenCloudBuilder={() => void api.executeMenuCommand("openAgentBuilder")}
                  />
                ),
                localSkills: (
                  <LocalSkillPackagesPanel
                    actions={projectSkillActions}
                    projectName={selectedProject?.displayName ?? null}
                  />
                ),
                mcp: (
                  <McpPage
                    model={{
                      transport: mcpTransport,
                      name: mcpName,
                      command: mcpCommand,
                      busy: mcpBusy,
                      servers: mcpServers,
                      selectedServer: selectedMcpServer,
                      selectedTool: selectedMcpTool,
                      toolArgs: mcpToolArgs,
                      result: mcpResult,
                      error,
                      scopeLabel: selectedProject
                        ? tr("settings.extensions.mcp.projectScope", [selectedProject.displayName])
                        : tr("settings.extensions.mcp.deviceScope"),
                    }}
                    actions={{
                      onTransportChange: (transport) => {
                        setMcpTransport(transport);
                        setMcpCommand("");
                      },
                      onNameChange: setMcpName,
                      onCommandChange: setMcpCommand,
                      onInstall: () => void installLocalMcp(),
                      onInstallFeatured: (name, url) => void installFeaturedMcp(name, url),
                      onSelectServer: (server) => {
                        setSelectedMcpServerId(server.serverId);
                        setSelectedMcpToolName(server.tools[0]?.name ?? null);
                        setMcpResult("");
                      },
                      onToggleServer: () => void toggleLocalMcp(),
                      onRemoveServer: () => void removeLocalMcp(),
                      onSelectTool: (toolName) => {
                        setSelectedMcpToolName(toolName);
                        setMcpToolArgs("{}");
                        setMcpResult("");
                      },
                      onToolArgsChange: setMcpToolArgs,
                      onCallTool: () => void callLocalMcpTool(),
                      onDismissError: () => setError(null),
                    }}
                  />
                ),
              }}
            />
          ) : workspaceView === "image" || workspaceView === "video" || workspaceView === "audio" ? (
            <MediaGenerationPage
              api={api}
              kind={workspaceView}
              onCreationModeChange={selectCreationMode}
              onManageLocalModels={() => {
                settingsReturnViewRef.current = { view: workspaceView, workbenchPanel };
                setSettingsInitialView("providers");
                setWorkspaceView("settings");
              }}
            />
          ) : workspaceView === "workflow" ? (
            <WorkflowPage
              model={{
                panel: workflowPanel,
                registry: workflowRegistry
                  ? {
                      ...workflowRegistry,
                      definitions: workflowRegistry.definitions.map(localizeWorkflowNodeDefinition),
                    }
                  : null,
                search: workflowSearch,
                visibleDefinitions: visibleWorkflowDefinitions,
                draft: workflowDraft,
                drafts: workflowDrafts,
                draftDirty: workflowDraftDirty,
                draftBusy: workflowDraftBusy,
                canUndoDraft: workflowDraftHistory.past.length > 0,
                canRedoDraft: workflowDraftHistory.future.length > 0,
                fitViewRevision: workflowFitViewRevision,
                runs: workflowRuns,
                selectedRun: selectedWorkflowRun,
                runInput: workflowRunInput,
                runBusy: workflowRunBusy,
                addExecutor: workflowAddExecutor,
                selectedProjectId,
                selectedFilePath,
                triggers: localTriggers,
                triggerName,
                triggerKind,
                triggerValue,
                triggerBusy,
                connectors: nativeConnectors,
                connectorBusyId,
                error,
              }}
              actions={{
                navigation: {
                  onPanelChange: setWorkflowPanel,
                  onSearchChange: setWorkflowSearch,
                },
                canvas: {
                  onSelectDraft: (workflowId) => void selectWorkflowDraft(workflowId),
                  onCreateDraft: createWorkflowDraft,
                  onDraftNameChange: (name) => updateWorkflowDraft((draft) => ({ ...draft, name })),
                  onUndoDraft: undoWorkflowDraft,
                  onRedoDraft: redoWorkflowDraft,
                  onAddExecutorChange: setWorkflowAddExecutor,
                  onAddNode: addWorkflowNode,
                  onMoveNodes: moveWorkflowNodes,
                  onConnectNodes: connectWorkflowNodes,
                  onRemoveEdges: removeWorkflowEdges,
                  onClearEdges: () => updateWorkflowDraft((draft) => ({ ...draft, edges: [] })),
                  onRemoveNode: removeWorkflowNode,
                  onRemoveNodes: removeWorkflowNodes,
                  onDuplicateNodes: duplicateWorkflowNodes,
                  onAutoLayout: autoLayoutWorkflow,
                  onUpdateNodeConfig: updateWorkflowNodeConfig,
                  onChooseOutputDirectory: () => api.chooseWorkflowOutputDirectory(),
                  onCreateWorkflowSkill: createWorkflowFromSkill,
                  onSaveDraft: () => void saveWorkflowDraft(),
                  onDeleteDraft: () => void deleteWorkflowDraft(),
                  onRunInputChange: setWorkflowRunInput,
                  onRun: () => void runWorkflowDraft(),
                  onCancelRun: () => void cancelWorkflowRun(),
                  onResumeRun: () => void resumeWorkflowRun(),
                  onRetryRun: () => void retryWorkflowRun(),
                  onOpenRunArtifact: (action) => void openWorkflowArtifact(action),
                },
                triggers: {
                  onNameChange: setTriggerName,
                  onKindChange: (kind) => {
                    setTriggerKind(kind);
                    setTriggerValue(kind === "schedule" ? "15" : kind === "hotkey" ? "CommandOrControl+Shift+R" : ".");
                  },
                  onValueChange: setTriggerValue,
                  onCreate: () => void createLocalTrigger(),
                  onToggle: (trigger) => void toggleLocalTrigger(trigger),
                  onFire: (triggerId) => void fireLocalTrigger(triggerId),
                  onRemove: (triggerId) => void removeLocalTrigger(triggerId),
                },
                connectors: {
                  onOpen: (connector) => void openNativeConnector(connector),
                },
                onDismissError: () => setError(null),
              }}
            />
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
                error,
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
                onUpdateProfile: (profileId, input) => void updateManagedBrowserProfile(profileId, input),
                onDeleteProfile: (profileId) => void deleteManagedBrowserProfile(profileId),
                onCaptureScreenshot: () => void captureBrowserScreenshot(),
                onRetryOperation: (operationId) => void retryManagedBrowserOperation(operationId),
                onCloseScreenshot: () => setBrowserScreenshot(null),
                onAttachedEndpointChange: setAttachedEndpoint,
                onDiscoverAttachedTargets: () => void discoverAttachedTargets(),
                onSelectedAttachedTargetChange: setSelectedAttachedTargetId,
                onToggleAttachedConnection: () => void toggleAttachedConnection(),
                onDismissError: () => setError(null),
                onViewportLayoutChange: requestBrowserBoundsSync,
              }}
              viewportRef={browserViewportRef}
              addressRef={browserAddressRef}
            />
          ) : workspaceView === "chat" ? (
            <div className="workspace-split">
              <div className="workspace-split-main">
                <ChatPage
                  selectedProject={selectedProject}
                  hasConversation={Boolean(selectedSessionId)}
                  messages={chatMessages}
                  activeRequestId={activeRequestId}
                  includeFileContext={includeFileContext}
                  selectedFilePath={selectedFilePath}
                  readResult={readResult}
                  draft={draft}
                  attachments={pendingChatAttachments}
                  uploadingAttachments={uploadingChatAttachments}
                  recentAttachments={recentChatAttachments}
                  authStatus={state.authStatus}
                  models={models}
                  selectedModelCode={selectedModelCode}
                  executionEnvironment={executionEnvironment}
                  webSearchMode={webSearchMode}
                  deepThinkingEnabled={deepThinkingEnabled}
                  modelsLoading={modelsLoading}
                  agents={agentWorkspace.model.agents}
                  agentsLoading={agentWorkspace.model.agentsLoading}
                  selectedAgentId={agentWorkspace.model.selectedAgentId}
                  selectedAgent={agentWorkspace.model.selectedAgent}
                  agentVersion={conversationAgentVersion}
                  agentSkills={chatAgentSkills}
                  projectContext={projectContext}
                  selectedProjectSkillId={selectedProjectSkillId}
                  projectSkillActions={projectSkillActions}
                  editingMessageId={editingMessageId}
                  attachmentsBusy={chatAttachmentsBusy}
                  error={error}
                  onAttachProjectFolder={() => {
                    if (selectedProject) void attachProjectFolder(selectedProject.localProjectId);
                  }}
                  onDraftChange={setDraft}
                  onChooseAttachments={() => void chooseChatAttachments()}
                  onUploadAttachmentFiles={(files) => void uploadChatAttachmentFiles(files)}
                  onChooseRecentAttachment={chooseRecentChatAttachment}
                  onClearAttachments={() => void clearChatAttachments()}
                  onRemoveAttachment={(attachmentId) => void removeChatAttachment(attachmentId)}
                  onSend={() => void sendMessage()}
                  onRetry={retryMessage}
                  onEditMessage={(messageId) => {
                    const message = chatMessages.find(
                      (candidate) => candidate.id === messageId && candidate.role === "user",
                    );
                    if (!message) return;
                    setEditingMessageId(message.id);
                    setDraft(message.content);
                    setPendingChatAttachments(message.attachments ?? []);
                    setError(null);
                  }}
                  onCancelEdit={() => {
                    setEditingMessageId(null);
                    setDraft("");
                    abandonPendingChatAttachments();
                  }}
                  onStop={() => void stopMessage()}
                  onModelChange={selectChatModel}
                  onManageModelProviders={openModelProviders}
                  onExecutionEnvironmentChange={setExecutionEnvironment}
                  onWebSearchModeChange={setWebSearchMode}
                  onDeepThinkingChange={setDeepThinkingEnabled}
                  onRefreshAgents={agentWorkspace.actions.onRefreshAgents}
                  onManageAgents={() => void api.executeMenuCommand("openAgentBuilder")}
                  onAgentChange={(agentId) => {
                    agentWorkspace.actions.onSelectAgent(agentId);
                    const nextAgent = agentWorkspace.model.agents.find((agent) => agent.id === agentId);
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
                      [agentVersionKey]: currentAgent.revision,
                    }));
                  }}
                  onProjectSkillChange={setSelectedProjectSkillId}
                  onIncludeFileContextChange={setIncludeFileContext}
                  onDismissError={() => setError(null)}
                  onOpenArtifact={(relativePath) => void openChatArtifact(relativePath)}
                  onCreationModeChange={selectCreationMode}
                />
              </div>
            </div>
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
                    placeholder={tr("ui.f1dfc3dce904")}
                    aria-label={tr("ui.64e5f7ae3d63")}
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
                    {tr("ui.0c3acd446f19")}
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
                      <small>
                        {process.status}
                        {process.exitCode === null ? "" : ` · ${process.exitCode}`}
                      </small>
                    </button>
                  ))}
                  {processes.length === 0 && <div className="process-empty">{tr("ui.3ae4096d7128")}</div>}
                </div>
                <div className="terminal-output">
                  <div className="terminal-output-header">
                    <span>
                      {selectedProcess ? [selectedProcess.executable, ...selectedProcess.args].join(" ") : "Terminal"}
                    </span>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!selectedProcess || selectedProcess.status !== "running" || processBusy}
                      onClick={() => void stopProjectProcess()}
                    >
                      <Square size={12} fill="currentColor" />
                      {tr("ui.a17f70a8d3d6")}
                    </button>
                  </div>
                  <pre>
                    {selectedProcess
                      ? `${selectedProcess.stdout}${selectedProcess.stderr ? `\n[stderr]\n${selectedProcess.stderr}` : ""}`
                      : tr("ui.db4e0ec0994f")}
                  </pre>
                  {selectedProcess?.outputTruncated && (
                    <span className="output-truncated">{tr("ui.0c76fca6a0ae")}</span>
                  )}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={18} />
                  <span>{error}</span>
                  <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={() => setError(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </section>
          ) : workspaceView === "versions" && readResult ? (
            <section className="versions-pane">
              <div className="versions-header">
                <div>
                  <span className="eyebrow">Local Version History</span>
                  <h2>{tr("ui.0e3758fba9e9")}</h2>
                  <p>{selectedFilePath}</p>
                </div>
                <div className="versions-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setWorkspaceView("chat");
                      setWorkbenchPanel("files");
                    }}
                  >
                    {tr("ui.40c16624c742")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!selectedFileVersion || fileVersionBusy}
                    onClick={() => void exportSelectedProjectFile(selectedFileVersion?.versionId)}
                  >
                    <FolderOpen size={13} />
                    {tr("ui.10dac709e474")}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!selectedFileVersion || fileVersionBusy}
                    onClick={() => void restoreFileVersion()}
                  >
                    {fileVersionBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                    {tr("ui.da516977ec7d")}
                  </button>
                </div>
              </div>
              <div className="versions-layout">
                <div className="version-list">
                  {fileVersions.map((version) => (
                    <button
                      key={version.versionId}
                      type="button"
                      className={selectedFileVersion?.versionId === version.versionId ? "active" : ""}
                      onClick={() => void selectFileVersion(version.versionId)}
                    >
                      <strong>{fileVersionSourceLabel(version.source)}</strong>
                      <time>{new Date(version.createdAt).toLocaleString()}</time>
                      <span>
                        {version.bytes} bytes · {version.sha256.slice(7, 15)}
                      </span>
                    </button>
                  ))}
                  {fileVersions.length === 0 && (
                    <div className="version-empty">
                      <RefreshCw size={22} />
                      <span>{tr("ui.6a3983d72541")}</span>
                    </div>
                  )}
                </div>
                <div className="version-comparison">
                  {selectedFileVersion ? (
                    <DiffPreview before={selectedFileVersion.text} after={readResult.text} />
                  ) : (
                    <div className="version-empty">
                      <GitBranch size={25} />
                      <span>{tr("ui.7ccef183ec59")}</span>
                    </div>
                  )}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={18} />
                  <span>{error}</span>
                  <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={() => setError(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </section>
          ) : workspaceView === "changes" && readResult ? (
            <section className="changes-pane">
              <div className="changes-header">
                <div>
                  <span className="eyebrow">{tr("ui.f41757c44225")}</span>
                  <h2>{tr("ui.a2042e839310")}</h2>
                  <p>{selectedFilePath}</p>
                </div>
                <div className="changes-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={savingFile}
                    onClick={() => {
                      setWorkspaceView("chat");
                      setWorkbenchPanel("files");
                    }}
                  >
                    {tr("ui.40c16624c742")}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={savingFile || !hasFileChanges}
                    onClick={() => void saveProjectFile()}
                  >
                    {savingFile ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                    {newFileDraft ? tr("ui.6d551077722e") : tr("ui.336568d8ff88")}
                  </button>
                </div>
              </div>
              <DiffPreview before={readResult.text} after={fileDraft} />
              {error && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={18} />
                  <span>{error}</span>
                  <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={() => setError(null)}>
                    <X size={14} />
                  </button>
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
                error,
              }}
              actions={{
                onChooseProject: () => void chooseProject(),
                onRefreshFiles: () => void refreshProjectFiles(),
                onCreateFile: prepareNewProjectFile,
                onSearch: setSearchQuery,
                onSelectFile: selectProjectFile,
                onSelectSheet: (sheetId) => {
                  if (selectedFilePath) void readProjectFile(selectedFilePath, sheetId);
                },
                onSelectPdfPage: (pageNumber) => {
                  if (selectedFilePath) void readProjectFile(selectedFilePath, undefined, pageNumber);
                },
                onExportFile: () => void exportSelectedProjectFile(),
                onOpenVersions: () => void openFileVersions(),
                onReviewChanges: reviewProjectFileChanges,
                onDraftChange: setFileDraft,
                onDismissError: () => setError(null),
              }}
            />
          )}
        </div>
      </main>
      {selectedChat && headerChatDialog === "rename" && (
        <AppDialog
          title={tr("chat.rename")}
          onClose={() => setHeaderChatDialog(null)}
          footer={
            <>
              <button className="secondary-button" type="button" onClick={() => setHeaderChatDialog(null)}>
                {tr("project.cancel")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!headerChatDialogValue.trim()}
                onClick={() => {
                  void renameProjectChat(
                    selectedChat.localProjectId,
                    selectedChat.sessionId,
                    headerChatDialogValue.trim(),
                  );
                  setHeaderChatDialog(null);
                }}
              >
                {tr("project.save")}
              </button>
            </>
          }
        >
          <label className="app-dialog-field">
            <span>{tr("chat.rename.label")}</span>
            <input
              className="app-dialog-input"
              autoFocus
              maxLength={120}
              value={headerChatDialogValue}
              onChange={(event) => setHeaderChatDialogValue(event.target.value)}
            />
          </label>
        </AppDialog>
      )}
      {selectedChat && headerChatDialog === "move" && (
        <AppDialog
          title={tr("chat.move")}
          onClose={() => setHeaderChatDialog(null)}
          footer={
            <>
              <button className="secondary-button" type="button" onClick={() => setHeaderChatDialog(null)}>
                {tr("project.cancel")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={
                  (headerChatDialogValue === "__general__" ? null : headerChatDialogValue) ===
                  selectedChat.localProjectId
                }
                onClick={() => {
                  const targetProjectId = headerChatDialogValue === "__general__" ? null : headerChatDialogValue;
                  void moveProjectChat(selectedChat.localProjectId, selectedChat.sessionId, targetProjectId);
                  setHeaderChatDialog(null);
                }}
              >
                {tr("chat.move")}
              </button>
            </>
          }
        >
          <label className="app-dialog-field">
            <span>{tr("chat.move.label")}</span>
            <select
              className="app-dialog-select"
              autoFocus
              value={headerChatDialogValue}
              onChange={(event) => setHeaderChatDialogValue(event.target.value)}
            >
              <option value="__general__">{tr("chat.general")}</option>
              {state.projects.map((project) => (
                <option key={project.localProjectId} value={project.localProjectId}>
                  {project.displayName}
                </option>
              ))}
            </select>
          </label>
        </AppDialog>
      )}
      {selectedChat && headerChatDialog === "delete" && (
        <AppDialog
          title={tr("chat.delete")}
          description={selectedChat.title}
          width="small"
          onClose={() => setHeaderChatDialog(null)}
          footer={
            <>
              <button className="secondary-button" type="button" onClick={() => setHeaderChatDialog(null)}>
                {tr("project.cancel")}
              </button>
              <button
                className="app-dialog-danger-button"
                type="button"
                onClick={() => {
                  void deleteProjectChat(selectedChat.localProjectId, selectedChat.sessionId);
                  setHeaderChatDialog(null);
                }}
              >
                {tr("chat.delete")}
              </button>
            </>
          }
        >
          <div className="app-dialog-danger-copy">{tr("chat.delete.confirm")}</div>
        </AppDialog>
      )}
      {visibleWorkbenchPanel && (
        <aside className="workspace-side-panel">
          <div
            className="workspace-side-panel-resizer"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={beginWorkbenchResize}
          />
          <header className="workspace-side-panel-header">
            <div className="workspace-side-panel-title">
              {visibleWorkbenchPanel === "files" || visibleWorkbenchPanel === "conversation-files" ? (
                <FileText size={15} />
              ) : visibleWorkbenchPanel === "terminal" ? (
                <SquareTerminal size={15} />
              ) : (
                <Globe2 size={15} />
              )}
              <strong title={workbenchTitle}>{workbenchTitle}</strong>
            </div>
            <button type="button" title={tr("workbench.close")} onClick={() => setWorkbenchPanel(null)}>
              <X size={15} />
            </button>
          </header>
          <div className="workspace-side-panel-body">
            {visibleWorkbenchPanel === "files" || visibleWorkbenchPanel === "conversation-files"
              ? renderFilesWorkbench()
              : visibleWorkbenchPanel === "terminal"
                ? renderTerminalWorkbench()
                : renderBrowserWorkbench()}
          </div>
        </aside>
      )}
      <ProjectCreateDialog
        open={projectDialogOpen}
        busy={projectActionBusy}
        onClose={() => {
          if (!projectActionBusy) setProjectDialogOpen(false);
        }}
        onCreate={(name, attachFolder) => void createProject(name, attachFolder)}
      />
      <ProjectEditDialog
        project={editingProject}
        busy={projectActionBusy}
        onClose={() => {
          if (!projectActionBusy) setEditingProjectId(null);
        }}
        onSave={(name) => {
          if (editingProject) void renameProject(editingProject.localProjectId, name);
        }}
        onAttachFolder={() => {
          if (editingProject) void attachProjectFolder(editingProject.localProjectId);
        }}
        onRemoveFolder={(folderId) => {
          if (editingProject) void removeProjectFolder(editingProject.localProjectId, folderId);
        }}
        onRemove={() => {
          if (editingProject) {
            const projectId = editingProject.localProjectId;
            setEditingProjectId(null);
            void deleteProject(projectId);
          }
        }}
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
        <span>{tr("ui.445c7a17eb35")}</span>
      </div>
      <div className="diff-view" role="region" aria-label={tr("ui.dcc8809a78a8")}>
        {lines.map((line, index) => (
          <div className={`diff-line ${line.kind}`} key={`${line.kind}:${index}`}>
            <span>{line.beforeLine ?? ""}</span>
            <span>{line.afterLine ?? ""}</span>
            <code>
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
              {line.text}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
function updateAssistantMessage(
  state: Record<string, ChatMessage[]>,
  sessionId: string,
  requestId: string,
  update: (message: ChatMessage) => ChatMessage,
) {
  return {
    ...state,
    [sessionId]: (state[sessionId] ?? []).map((message) =>
      message.id === `assistant:${requestId}` ? update(message) : message,
    ),
  };
}
function updateChatToolActivity(
  tools: NonNullable<ChatMessage["tools"]>,
  event: Extract<
    ProjectChatEvent,
    {
      type: "tool_started" | "tool_completed" | "tool_error";
    }
  >,
) {
  const existing = tools.find((tool) => tool.toolCallId === event.toolCallId);
  const next = {
    ...existing,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    title: event.title,
    status:
      event.type === "tool_started"
        ? ("running" as const)
        : event.type === "tool_completed"
          ? ("completed" as const)
          : ("error" as const),
    ...(event.type === "tool_started"
      ? {
          startedAt: event.startedAt,
          ...(event.inputPreview ? { inputPreview: event.inputPreview } : {}),
        }
      : {
          endedAt: event.endedAt,
          ...(event.outputPreview ? { outputPreview: event.outputPreview } : {}),
        }),
    ...(event.type === "tool_completed"
      ? { detail: event.summary }
      : event.type === "tool_error"
        ? { detail: event.message }
        : {}),
  };
  const existingIndex = tools.findIndex((tool) => tool.toolCallId === event.toolCallId);
  if (existingIndex < 0) return [...tools, next];
  return tools.map((tool, index) => (index === existingIndex ? next : tool));
}
function upsertWorkflowRun(runs: DesktopWorkflowRun[], run: DesktopWorkflowRun): DesktopWorkflowRun[] {
  return [run, ...runs.filter((candidate) => candidate.runId !== run.runId)].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}
function fileVersionSourceLabel(source: ProjectFileVersionSummary["source"]): string {
  if (source === "created") return tr("ui.c2098a5e9c7c");
  if (source === "restored") return tr("ui.0c3b2436730f");
  if (source === "baseline") return tr("ui.3740b0381797");
  return tr("ui.7ca11ae8d708");
}
function isPreviewableArtifact(relativePath: string): boolean {
  return /\.(?:csv|tsv|xlsx?|png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm|pdf)$/i.test(relativePath);
}
function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
