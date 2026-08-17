export type ProjectSummary = {
  localProjectId: string;
  displayName: string;
  hasFolder?: boolean;
  folderStatus?: "unlinked" | "available" | "missing" | "unavailable";
  folders?: ProjectFolderSummary[];
  rootFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectFolderSummary = {
  folderId: string;
  name: string;
  path: string;
  status: "available" | "missing" | "unavailable";
  primary: boolean;
};

export type ReadResult = {
  uri: string;
  text: string;
  bytesRead: number;
  truncated: boolean;
  encoding: "utf8";
  sha256: string;
};

export type WriteResult = ReadResult & {
  changed: boolean;
  previousSha256: string;
};

export type CreateResult = ReadResult & { created: true };

export type ProjectAssetPreview = {
  uri: string;
  mimeType: string;
  dataUrl: string;
  bytesRead: number;
};

export type ProjectArtifactPreview =
  | ({
      kind: "media";
      providerId: "core.media";
    } & ProjectAssetPreview)
  | {
      kind: "table";
      providerId: "core.delimited-table" | "ai.routemarket.spreadsheet";
      viewerId: "core.delimited-table" | "spreadsheet.viewer";
      uri: string;
      mimeType:
        | "text/csv"
        | "text/tab-separated-values"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      rows: string[][];
      rowCount: number;
      columnCount: number;
      bytesRead: number;
      truncated: boolean;
      sheets?: Array<{ id: string; name: string }>;
      activeSheetId?: string;
    }
  | {
      kind: "pdf";
      providerId: "ai.routemarket.pdf";
      viewerId: "pdf.viewer";
      uri: string;
      mimeType: "application/pdf";
      dataUrl: string;
      bytesRead: number;
      pageCount: number;
      pageNumber: number;
      width: number;
      height: number;
      isolated: true;
    }
  | {
      kind: "unavailable";
      providerId: "ai.routemarket.spreadsheet" | "ai.routemarket.pdf";
      viewerId: "spreadsheet.viewer" | "pdf.viewer";
      uri: string;
      title: string;
      reason: string;
    };

export type ProjectFileEntry = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  children?: ProjectFileEntry[];
};

export type ProjectFileTree = {
  entries: ProjectFileEntry[];
  totalEntries: number;
  truncated: boolean;
};

export type ProjectSearchMatch = {
  relativePath: string;
  matchKind: "path" | "content";
  line: number | null;
  column: number | null;
  preview: string;
};

export type ProjectSearchResult = {
  query: string;
  matches: ProjectSearchMatch[];
  filesScanned: number;
  truncated: boolean;
};

export type ManagedProcessSummary = {
  processId: string;
  localProjectId: string;
  executable: string;
  args: string[];
  status: "running" | "exited" | "failed" | "stopped";
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  startedAt: string;
  finishedAt: string | null;
};

export type ApprovalRecord = {
  invocationId: string;
  capability: string;
  risk: "R0" | "R1" | "R2" | "R3";
  title: string;
  detail: string;
  projectId: string | null;
  parametersHash: string;
  status: "requested" | "approved" | "denied";
  requestedAt: string;
  resolvedAt: string | null;
};

export type ApprovalPolicy = {
  policyId: string;
  capability: string;
  projectId: string;
  effect: "allow" | "deny";
  createdAt: string;
  updatedAt: string;
};

export type ManagedBrowserState = {
  localProjectId: string;
  visible: boolean;
  activeProfileId: string;
  activePageId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  userTakeover: boolean;
  crashed: boolean;
  profiles: ManagedBrowserProfile[];
  pages: ManagedBrowserPageSummary[];
  downloads: ManagedBrowserDownload[];
  operations: ManagedBrowserOperation[];
};

export type ManagedBrowserOperationSource =
  | "user"
  | "chat"
  | "agent"
  | "workflow"
  | "cloud_job";

export type ManagedBrowserOperationKind =
  | "navigate"
  | "back"
  | "forward"
  | "reload"
  | "takeover"
  | "click"
  | "type"
  | "upload"
  | "extract"
  | "screenshot";

export type ManagedBrowserOperation = {
  operationId: string;
  localProjectId: string;
  pageId: string;
  source: ManagedBrowserOperationSource;
  kind: ManagedBrowserOperationKind;
  status: "running" | "succeeded" | "failed";
  title: string;
  detail: string;
  url: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  retryable: boolean;
  retryOfOperationId: string | null;
};

export type ManagedBrowserDownload = {
  downloadId: string;
  pageId: string;
  localProjectId: string;
  url: string;
  fileName: string;
  relativePath: string;
  status: "progressing" | "paused" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  startedAt: string;
  finishedAt: string | null;
};

export type ManagedBrowserUploadResult = {
  completed: true;
  pageId: string;
  url: string;
  relativePaths: string[];
};

export type ManagedBrowserProfile = {
  profileId: string;
  localProjectId: string;
  name: string;
  userAgent: string;
  proxyRules: string;
  proxyBypassRules: string;
  persistence: "persistent" | "ephemeral";
};

export type ManagedBrowserProfileInput = Pick<
  ManagedBrowserProfile,
  "name" | "userAgent" | "proxyRules" | "proxyBypassRules" | "persistence"
>;

export type ManagedBrowserPageSummary = {
  pageId: string;
  profileId: string;
  localProjectId: string;
  title: string;
  url: string;
  loading: boolean;
  crashed: boolean;
};

export type AttachedBrowserTarget = {
  targetId: string;
  title: string;
  url: string;
  type: string;
};

export type AttachedBrowserState = {
  connected: boolean;
  endpoint: string | null;
  target: AttachedBrowserTarget | null;
  error: string | null;
};

export type LocalTriggerKind = "file_changed" | "folder_added" | "schedule" | "hotkey";

export type LocalTriggerSummary = {
  triggerId: string;
  localProjectId: string;
  name: string;
  kind: LocalTriggerKind;
  enabled: boolean;
  relativePath: string | null;
  intervalMinutes: number | null;
  accelerator: string | null;
  status: "inactive" | "active" | "error";
  lastError: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalTriggerInput = {
  localProjectId: string;
  name: string;
  kind: LocalTriggerKind;
  enabled: boolean;
  relativePath?: string;
  intervalMinutes?: number;
  accelerator?: string;
};

export type NativeAppConnectorId = "vscode" | "excel" | "powerpoint";

export type NativeAppConnectorSummary = {
  connectorId: NativeAppConnectorId;
  name: string;
  description: string;
  available: boolean;
  executablePath: string | null;
  supportedExtensions: string[];
};

export type NativeAppOpenResult = {
  connectorId: NativeAppConnectorId;
  openedPath: string;
  launchedAt: string;
};

export type DesktopWorkflowDraftNode = {
  nodeId: string;
  executorKey: string;
  title: string;
  executionTarget: "cloud" | "desktop" | "auto";
  x: number;
  y: number;
  config: Record<string, unknown>;
  definitionSnapshot: DesktopWorkflowNodeDefinition;
};

export type DesktopWorkflowDraftEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string;
  targetPortId?: string;
};

export type DesktopWorkflowDraft = {
  workflowId: string;
  localProjectId: string;
  kind: "workflow" | "local_action";
  name: string;
  sourceSkill?: {
    id: string;
    version: number;
  };
  nodes: DesktopWorkflowDraftNode[];
  edges: DesktopWorkflowDraftEdge[];
  createdAt: string;
  updatedAt: string;
};

export type DesktopWorkflowDraftSummary = Pick<
  DesktopWorkflowDraft,
  "workflowId" | "localProjectId" | "kind" | "name" | "createdAt" | "updatedAt"
> & { nodeCount: number; edgeCount: number };

export type DesktopWorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "canceled";

export type DesktopWorkflowNodeRunStatus =
  | "pending"
  | "running"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "skipped"
  | "canceled";

export type DesktopWorkflowNodeRun = {
  nodeRunId: string;
  nodeId: string;
  executorKey: string;
  title: string;
  status: DesktopWorkflowNodeRunStatus;
  input: Record<string, unknown> | null;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempt: number;
};

export type DesktopWorkflowRun = {
  runId: string;
  workflowId: string;
  workflowName: string;
  localProjectId: string;
  sourceSkill?: {
    id: string;
    version: number;
  };
  status: DesktopWorkflowRunStatus;
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nodeRuns: DesktopWorkflowNodeRun[];
};

export type DesktopWorkflowRunEvent = {
  type: "updated";
  run: DesktopWorkflowRun;
};

export type ProjectFileVersionSummary = {
  versionId: string;
  localProjectId: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  source: "baseline" | "saved" | "created" | "restored";
  createdAt: string;
};

export type ProjectFileVersion = ProjectFileVersionSummary & { text: string };

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerSummary = {
  serverId: string;
  name: string;
  transport: "stdio" | "streamable-http";
  command: string;
  args: string[];
  url: string | null;
  localProjectId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  status: "offline" | "starting" | "online" | "error";
  tools: McpTool[];
  serverInfo: { name: string; version: string } | null;
  protocolVersion: string | null;
  stderr: string;
  lastError: string | null;
};

export type BrowserBounds = { x: number; y: number; width: number; height: number };

export type DesktopWorkflowCloudPort = {
  id: string;
  label?: string;
  accepts?: string[];
  produces?: string[];
  required?: boolean;
};

export type DesktopWorkflowCloudRuntime = {
  nodeType: string;
  kind: string;
  executionMode: string;
  joinStrategy: string;
  inputPorts: DesktopWorkflowCloudPort[];
  outputPorts: DesktopWorkflowCloudPort[];
};

export type DesktopWorkflowNodeDefinition = {
  executorKey: string;
  definitionVersion: number;
  source: "cloud" | "desktop_builtin" | "local_extension";
  executionTarget: "cloud" | "desktop" | "auto";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredCapabilities: string[];
  portability: "portable" | "requires_connector" | "device_bound";
  definitionHash: string;
  title: string;
  description: string;
  available: boolean;
  blockedReason: string | null;
  cloudRuntime?: DesktopWorkflowCloudRuntime;
};

export type DesktopWorkflowNodeRegistry = {
  revisionHash: string;
  generatedAt: string;
  definitions: DesktopWorkflowNodeDefinition[];
};

export type ActivityItem = {
  id: string;
  kind:
    | "project.bound"
    | "project.created"
    | "project.folder_attached"
    | "project.deleted"
    | "cloud.connected"
    | "cloud.error"
    | "job.offered"
    | "job.started"
    | "approval.requested"
    | "approval.approved"
    | "approval.denied"
    | "approval.policy_removed"
    | "job.attention"
    | "job.succeeded"
    | "job.failed"
    | "job.canceled"
    | "trigger.fired";
  title: string;
  detail: string;
  occurredAt: string;
  firstOccurredAt?: string;
  occurrenceCount?: number;
};

export type CloudWorkerStatus =
  | "disabled"
  | "connecting"
  | "online"
  | "degraded"
  | "error"
  | "access_required";

export type WorkState = {
  workerStatus: "starting" | "online" | "offline";
  cloudStatus: CloudWorkerStatus;
  runtimeId: string | null;
  cloudError: string | null;
  authStatus: "signed_out" | "authorizing" | "signed_in" | "error";
  account?: {
    id: string;
    displayName: string;
    email: string | null;
    avatarUrl?: string | null;
    creditsBalance?: number;
    spaces?: AccountSpace[];
    activeSpaceId?: string;
    membership?: {
      planCode: string;
      planName: string;
      status: string;
      expiresAt: string;
    } | null;
  };
  authError: string | null;
  projects: ProjectSummary[];
  activities: ActivityItem[];
  approvals: ApprovalRecord[];
  approvalPolicies: ApprovalPolicy[];
};

export type LocalDataInfo = {
  dataPath: string;
  scope: "guest" | "account-space";
  accountName: string | null;
  spaceName: string | null;
  storedAccountCount: number;
  storedSpaceCount: number;
  allScopesBytes: number;
  totalBytes: number;
  databaseBytes: number;
  databaseHealth: "empty" | "healthy" | "corrupt";
  lastRecoveredAt: string | null;
};

export type LocalDataScopeSummary = {
  scopeId: string;
  accountName: string;
  spaceName: string;
  spaceKind: "personal" | "team" | "local";
  lastUsedAt: string;
  totalBytes: number;
  current: boolean;
};

export type DesktopAppInfo = {
  version: string;
  buildEnvironment: "development" | "test" | "production";
  updateEnabled: boolean;
  updateChannel: "stable" | "beta";
};

export type AccountSpace = {
  id: string;
  name: string;
  kind: "personal" | "team";
  teamId: string | null;
  avatarUrl: string | null;
  role: string | null;
};

export type ChatModel = {
  code: string;
  displayName: string;
  source: "routemarket" | "external";
  providerId: string | null;
  providerName: string;
  category: "chat" | "reasoning";
  supportsTools: boolean;
  supportsNativeWebSearch: boolean;
  supportsVision: boolean;
  supportsStream: boolean;
  supportsReasoningSummary: boolean;
  preferredChatProtocol: "openai_responses" | null;
};

export type ModelProviderProtocol = "openai-compatible" | "anthropic";

export type ModelProviderCompatibility =
  | "standard"
  | "openrouter"
  | "opencode"
  | "nine-router"
  | "custom";

export type ModelProviderHeader = {
  name: string;
  value: string;
};

export type ModelProviderModel = {
  id: string;
  displayName: string;
  source: "synced" | "manual";
  category: "chat" | "reasoning";
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStream: boolean;
  supportsReasoningSummary: boolean;
};

export type ModelProviderSummary = {
  id: string;
  name: string;
  protocol: ModelProviderProtocol;
  compatibility: ModelProviderCompatibility;
  baseUrl: string;
  headers: ModelProviderHeader[];
  hasApiKey: boolean;
  enabled: boolean;
  modelCount: number;
  models: ModelProviderModel[];
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type ModelProviderInput = {
  id?: string;
  name: string;
  protocol: ModelProviderProtocol;
  compatibility?: ModelProviderCompatibility;
  baseUrl: string;
  headers?: ModelProviderHeader[];
  apiKey?: string;
  enabled: boolean;
  models?: ModelProviderModel[];
};

export type LocalApiGatewayState = {
  enabled: boolean;
  port: number;
  running: boolean;
  baseUrl: string;
  token: string;
  requestCount: number;
  lastRequestAt: string | null;
  lastError: string | null;
  routes: LocalApiGatewayRoute[];
  targetHealth: LocalApiGatewayTargetHealth[];
};

export type LocalApiGatewayRoute = {
  id: string;
  name: string;
  strategy: "priority" | "round-robin";
  targets: string[];
};

export type LocalApiGatewayRouteInput = {
  id?: string;
  name: string;
  strategy?: "priority" | "round-robin";
  targets: string[];
};

export type LocalApiGatewayTargetHealth = {
  model: string;
  consecutiveFailures: number;
  openUntil: string | null;
  lastStatus: number | null;
};

export type LocalApiGatewayUsage = {
  id: string;
  source: "desktop_chat" | "local_gateway";
  kind: "chat" | "responses" | "anthropic_messages" | "image" | "audio" | "video";
  providerId: string | null;
  providerName: string;
  requestedModel: string;
  resolvedModel: string;
  routeId: string | null;
  status: number | null;
  durationMs: number;
  success: boolean;
  createdAt: string;
};

export type LocalApiGatewayUpdate = {
  enabled?: boolean;
  port?: number;
  rotateToken?: boolean;
};

export type WebSearchMode = "agentic" | "native" | "off";

export type DesktopChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "audio" | "video" | "file";
  textExcerpt: string | null;
  assetId: string;
  downloadUrl: string;
  previewUrl: string | null;
};

export type DesktopAgentTool = {
  type: string;
  serverId?: string;
  credentialId?: string;
};

export type DesktopAgentSkill = {
  skillId: string;
  name?: string;
  version?: number | string;
  source: "cloud" | "local";
  enabled: boolean;
};

export type DesktopAgentExecutionPolicy = {
  environment: "auto" | "local" | "cloud";
  approvalMode: "always_ask" | "risky_only" | "never_ask";
};

export type DesktopAgentProfile = {
  id: string;
  revision: number;
  origin: "personal" | "template";
  forkSourceId: string | null;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  systemPrompt: string;
  greeting: string | null;
  starterQuestions: string[];
  tags: string[];
  defaultModelCode: string | null;
  skills: DesktopAgentSkill[];
  toolPermissions: DesktopAgentTool[];
  executionPolicy: DesktopAgentExecutionPolicy;
  tools: DesktopAgentTool[];
  updatedAt: string;
};

export type AgentLocalToolGroup =
  | "files"
  | "processes"
  | "browser"
  | "mcp"
  | "skills";

export type ProjectChatRequest = {
  requestId: string;
  sessionId: string;
  sentAt: string;
  model: string;
  webSearchMode?: WebSearchMode;
  modelSupportsTools?: boolean;
  modelSupportsVision?: boolean;
  preferredChatProtocol?: "openai_responses" | null;
  reasoningSummary?: "auto";
  message: string;
  attachments?: DesktopChatAttachment[];
  history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  project?: {
    localProjectId: string;
    displayName: string;
    hasFolder?: boolean;
  };
  contextFile?: {
    relativePath: string;
    uri: string;
    text: string;
    truncated: boolean;
  };
  projectContext?: ProjectContext;
  projectSkill?: {
    id: string;
    name: string;
    relativePath: string;
    text: string;
    truncated: boolean;
  };
  agent?: {
    agentId: string;
    agentRevision: number;
    executionEnvironment: "auto" | "local" | "cloud";
    agentName?: string;
    agentAvatarUrl?: string | null;
    localToolGroups: AgentLocalToolGroup[];
    maxToolRounds: number;
  };
};

export type LocalProjectChatMessage = {
  id: string;
  sessionId: string;
  localProjectId: string | null;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sentAt: string;
  contextFile?: string;
  attachments?: DesktopChatAttachment[];
  artifacts?: ProjectChatArtifact[];
  tools?: ProjectChatToolActivity[];
  stopped?: boolean;
  failed?: boolean;
  agentId?: string;
  agentRevision?: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
};

export type ProjectChatToolActivity = {
  toolCallId: string;
  toolName: string;
  title: string;
  status: "running" | "completed" | "error";
  detail?: string;
};

export type ProjectChatArtifact = {
  id: string;
  kind: "file";
  relativePath: string;
  filename: string;
  mimeType: string;
  size: number;
  uri: string;
  providerId: string;
};

export type LocalProjectChat = {
  sessionId: string;
  localProjectId: string | null;
  messages: LocalProjectChatMessage[];
};

export type LocalProjectChatSummary = {
  sessionId: string;
  localProjectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTextContext = {
  relativePath: string;
  text: string;
  truncated: boolean;
};

export type ProjectContext = {
  instructions: ProjectTextContext | null;
  readme: ProjectTextContext | null;
  settings: {
    defaultAgent: string | null;
    defaultModel: string | null;
    cloudProjectId: string | null;
    ignore: string[];
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    relativePath: string;
  }>;
};

export type LocalSkillInvocationResult = {
  skillId: string;
  name: string;
  description: string;
  relativePath: string;
  task: string;
  instructions: string;
  truncated: boolean;
  directive: string;
};

export type LocalSkillInstallReceipt = {
  localProjectId: string;
  skillId: string;
  name: string;
  description: string;
  version: string;
  packageDigest: string;
  currentPackageDigest: string | null;
  source: "local_archive" | "web_library" | "local_directory";
  sourceLabel: string;
  publisherFingerprint: string | null;
  installedAt: string | null;
  updatedAt: string | null;
  status: "ready" | "modified" | "missing" | "invalid";
  managed: boolean;
  relativePath: string;
  permissions: string[];
  operations: string[];
};

export type DownloadableCloudSkill = {
  skillId: string;
  version: string;
  versionId: string;
  name: string;
  description: string;
};

export type ProjectChatEvent =
  | {
      requestId: string;
      type: "delta";
      content: string;
    }
  | {
      requestId: string;
      type: "reasoning";
      content: string;
    }
  | {
      requestId: string;
      type: "complete";
      content: string;
    }
  | {
      requestId: string;
      type: "stopped";
      content: string;
    }
  | {
      requestId: string;
      type: "artifacts";
      artifacts: ProjectChatArtifact[];
    }
  | {
      requestId: string;
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      title: string;
    }
  | {
      requestId: string;
      type: "tool_completed";
      toolCallId: string;
      toolName: string;
      title: string;
      summary: string;
    }
  | {
      requestId: string;
      type: "tool_error";
      toolCallId: string;
      toolName: string;
      title: string;
      message: string;
    }
  | {
      requestId: string;
      type: "error";
      message: string;
      content?: string;
    };

export type DesktopLocale = "en-US" | "zh-CN" | "ja-JP" | "es-ES" | "pt-BR" | "th-TH" | "ko-KR";

export type DesktopPreferences = {
  locale?: "system" | DesktopLocale;
  theme?: "light" | "dark" | "system";
  railExpanded?: boolean;
  projectModels?: Record<string, string>;
};

export type DesktopAnalyticsEvent =
  | { name: "desktop_app_opened" }
  | { name: "desktop_auth_started"; data: { intent: "login" | "register" } }
  | { name: "desktop_locale_changed"; data: { locale: DesktopLocale } }
  | { name: "desktop_project_created" }
  | { name: "desktop_chat_created"; data: { scope: "project" | "standalone" } }
  | {
      name: "desktop_message_sent";
      data: {
        scope: "project" | "standalone";
        hasAttachments: boolean;
        hasAgent: boolean;
        webSearchEnabled: boolean;
      };
    }
  | { name: "desktop_workflow_run_started" }
  | { name: "desktop_marketplace_plugin_installed" };

export type DesktopMenuCommand =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "toggleFullScreen"
  | "closeWindow"
  | "quit"
  | "openDocumentation"
  | "openAccountCenter"
  | "openPlanUpgrade"
  | "openCreditsTopUp"
  | "openCreditsUsage"
  | "showAbout";

export type MarketplaceResourceKind = "plugin" | "skill" | "workflow" | "app";

export type MarketplaceCatalogItem = {
  id: string;
  slug: string;
  kind: MarketplaceResourceKind;
  publisher: string;
  name: string;
  description: string;
  status: "available" | "preview" | "disabled";
  acquisitionMode: "install" | "copy" | "launch";
  release:
    | {
        distributionSource: "bundled";
        version: string;
        minimumHostVersion: string;
      }
    | {
        distributionSource: "marketplace";
        version: string;
        minimumHostVersion: string;
        packageUrl: string;
        integrity: string;
        signature: {
          algorithm: "ed25519";
          keyId: string;
          value: string;
        };
      };
};

export type MarketplaceCatalogResponse = {
  schemaVersion: 1;
  revision: string;
  items: MarketplaceCatalogItem[];
};

export type MarketplacePluginInstallation = {
  pluginId: string;
  version: string;
  publisher: string;
  integrity: string;
  signerKeyId: string;
  installedAt: string;
  updatedAt: string;
  enabled: boolean;
  status: "ready" | "missing" | "invalid";
};

export type MarketplacePluginInstallPreview = {
  installToken: string;
  pluginId: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  permissions: string[];
  tools: Array<{ name: string; title: string; risk: "R0" | "R1" | "R2" | "R3" }>;
  viewers: Array<{ id: string; title: string; mode: "readonly" | "editable" }>;
  workflowNodes: Array<{ executorKey: string; title: string }>;
  connectors: Array<{ id: string; title: string; kind: "browser_provider" | "native_app" | "remote_service" }>;
};

export type RouteMarketWorkApi = {
  onRuntimeError(listener: (message: string) => void): () => void;
  getPreferences(): Promise<DesktopPreferences>;
  updatePreferences(patch: DesktopPreferences): Promise<DesktopPreferences>;
  setLocale(locale: DesktopLocale): Promise<void>;
  executeMenuCommand(command: DesktopMenuCommand): Promise<void>;
  setTitleBarTheme(theme: "light" | "dark"): Promise<void>;
  setWorkbenchExpanded(expanded: boolean, preferredPanelWidth?: number): Promise<{
    expanded: boolean;
    addedWidth: number;
  }>;
  getState(): Promise<WorkState>;
  getAppInfo(): Promise<DesktopAppInfo>;
  checkForUpdates(): Promise<boolean>;
  listMarketplaceCatalog(): Promise<MarketplaceCatalogResponse>;
  listMarketplacePluginInstallations(): Promise<MarketplacePluginInstallation[]>;
  prepareMarketplacePluginInstall(pluginId: string): Promise<MarketplacePluginInstallPreview>;
  cancelMarketplacePluginInstall(installToken: string): Promise<boolean>;
  installMarketplacePlugin(installToken: string): Promise<MarketplacePluginInstallation>;
  setMarketplacePluginEnabled(pluginId: string, enabled: boolean): Promise<MarketplacePluginInstallation>;
  removeMarketplacePlugin(pluginId: string): Promise<boolean>;
  getLocalDataInfo(): Promise<LocalDataInfo>;
  listLocalDataScopes(): Promise<LocalDataScopeSummary[]>;
  removeLocalDataScope(scopeId: string): Promise<boolean>;
  showLocalData(): Promise<void>;
  exportLocalData(): Promise<{ exportedPath: string } | null>;
  clearLocalData(): Promise<boolean>;
  clearActivities(): Promise<WorkState>;
  signIn(intent?: "login" | "register"): Promise<WorkState>;
  signOut(): Promise<WorkState>;
  switchSpace(spaceId: string): Promise<WorkState>;
  removeApprovalPolicy(policyId: string): Promise<boolean>;
  chooseProject(): Promise<ProjectSummary | null>;
  chooseWorkflowOutputDirectory(): Promise<string | null>;
  createProject(displayName: string): Promise<ProjectSummary>;
  renameProject(localProjectId: string, displayName: string): Promise<ProjectSummary>;
  attachProjectFolder(localProjectId: string): Promise<ProjectSummary | null>;
  removeProjectFolder(localProjectId: string, folderId: string): Promise<ProjectSummary>;
  openProjectFolder(localProjectId: string): Promise<boolean>;
  deleteProject(localProjectId: string): Promise<boolean>;
  getProjectContext(localProjectId: string): Promise<ProjectContext>;
  listProjectSkills(localProjectId: string): Promise<LocalSkillInstallReceipt[]>;
  chooseAndInstallProjectSkill(
    localProjectId: string
  ): Promise<LocalSkillInstallReceipt | null>;
  listDownloadableCloudSkills(): Promise<DownloadableCloudSkill[]>;
  installCloudSkill(
    localProjectId: string,
    skillId: string,
    versionId: string
  ): Promise<LocalSkillInstallReceipt>;
  removeInstalledProjectSkill(
    localProjectId: string,
    skillId: string
  ): Promise<boolean>;
  getWorkflowNodeRegistry(localProjectId: string): Promise<DesktopWorkflowNodeRegistry>;
  listProjectFiles(localProjectId: string): Promise<ProjectFileTree>;
  searchProject(localProjectId: string, query: string): Promise<ProjectSearchResult>;
  readProjectFile(localProjectId: string, relativePath: string): Promise<ReadResult>;
  readProjectAsset(localProjectId: string, relativePath: string): Promise<ProjectAssetPreview>;
  previewProjectArtifact(
    localProjectId: string,
    relativePath: string,
    selectedSheetId?: string,
    pageNumber?: number
  ): Promise<ProjectArtifactPreview>;
  chooseChatAttachments(maxCount: number): Promise<DesktopChatAttachment[]>;
  discardChatAttachment(attachmentId: string): Promise<void>;
  writeProjectFile(
    localProjectId: string,
    relativePath: string,
    text: string,
    expectedSha256: string
  ): Promise<WriteResult>;
  createProjectFile(
    localProjectId: string,
    relativePath: string,
    text: string
  ): Promise<CreateResult>;
  startProcess(
    localProjectId: string,
    executable: string,
    args: string[]
  ): Promise<ManagedProcessSummary>;
  listProcesses(): Promise<ManagedProcessSummary[]>;
  stopProcess(processId: string): Promise<ManagedProcessSummary>;
  getBrowserState(localProjectId: string): Promise<ManagedBrowserState>;
  showBrowser(localProjectId: string, bounds: BrowserBounds): Promise<ManagedBrowserState>;
  hideBrowser(): Promise<void>;
  setBrowserBounds(bounds: BrowserBounds): Promise<void>;
  createBrowserPage(localProjectId: string, profileId?: string): Promise<ManagedBrowserState>;
  selectBrowserPage(localProjectId: string, pageId: string): Promise<ManagedBrowserState>;
  closeBrowserPage(localProjectId: string, pageId: string): Promise<ManagedBrowserState>;
  createBrowserProfile(
    localProjectId: string,
    input: ManagedBrowserProfileInput
  ): Promise<ManagedBrowserState>;
  updateBrowserProfile(
    localProjectId: string,
    profileId: string,
    input: ManagedBrowserProfileInput
  ): Promise<ManagedBrowserState>;
  deleteBrowserProfile(localProjectId: string, profileId: string): Promise<ManagedBrowserState>;
  navigateBrowser(localProjectId: string, url: string, pageId?: string): Promise<ManagedBrowserState>;
  browserBack(localProjectId: string, pageId?: string): Promise<ManagedBrowserState>;
  browserForward(localProjectId: string, pageId?: string): Promise<ManagedBrowserState>;
  reloadBrowser(localProjectId: string, pageId?: string): Promise<ManagedBrowserState>;
  setBrowserTakeover(
    localProjectId: string,
    userTakeover: boolean,
    pageId?: string
  ): Promise<ManagedBrowserState>;
  clickBrowser(localProjectId: string, selector: string, pageId?: string): Promise<void>;
  typeBrowser(localProjectId: string, selector: string, text: string, pageId?: string): Promise<void>;
  uploadBrowser(
    localProjectId: string,
    selector: string,
    relativePaths: string[],
    pageId?: string
  ): Promise<ManagedBrowserUploadResult>;
  extractBrowser(localProjectId: string, selector: string, pageId?: string): Promise<string>;
  screenshotBrowser(localProjectId: string, pageId?: string): Promise<string>;
  retryBrowserOperation(
    localProjectId: string,
    operationId: string
  ): Promise<ManagedBrowserState>;
  discoverAttachedBrowser(endpoint: string): Promise<AttachedBrowserTarget[]>;
  connectAttachedBrowser(endpoint: string, targetId?: string): Promise<AttachedBrowserState>;
  disconnectAttachedBrowser(): Promise<AttachedBrowserState>;
  navigateAttachedBrowser(url: string): Promise<AttachedBrowserState>;
  clickAttachedBrowser(selector: string): Promise<void>;
  typeAttachedBrowser(selector: string, text: string): Promise<void>;
  extractAttachedBrowser(selector: string): Promise<string>;
  screenshotAttachedBrowser(): Promise<string>;
  listLocalTriggers(localProjectId: string): Promise<LocalTriggerSummary[]>;
  saveLocalTrigger(input: LocalTriggerInput, triggerId?: string): Promise<LocalTriggerSummary>;
  removeLocalTrigger(triggerId: string): Promise<void>;
  fireLocalTrigger(triggerId: string): Promise<LocalTriggerSummary>;
  listNativeAppConnectors(): Promise<NativeAppConnectorSummary[]>;
  openNativeAppConnector(
    connectorId: NativeAppConnectorId,
    localProjectId: string,
    relativePath?: string
  ): Promise<NativeAppOpenResult>;
  listDesktopWorkflowDrafts(localProjectId: string): Promise<DesktopWorkflowDraftSummary[]>;
  getDesktopWorkflowDraft(
    localProjectId: string,
    workflowId?: string
  ): Promise<DesktopWorkflowDraft | null>;
  saveDesktopWorkflowDraft(draft: DesktopWorkflowDraft): Promise<DesktopWorkflowDraft>;
  deleteDesktopWorkflowDraft(localProjectId: string, workflowId: string): Promise<void>;
  runDesktopWorkflow(
    localProjectId: string,
    workflowId: string,
    input?: Record<string, unknown>
  ): Promise<DesktopWorkflowRun>;
  getDesktopWorkflowRun(runId: string): Promise<DesktopWorkflowRun | null>;
  listDesktopWorkflowRuns(
    localProjectId: string,
    workflowId?: string
  ): Promise<DesktopWorkflowRun[]>;
  cancelDesktopWorkflowRun(runId: string): Promise<DesktopWorkflowRun>;
  resumeDesktopWorkflowRun(runId: string): Promise<DesktopWorkflowRun>;
  retryDesktopWorkflowRun(runId: string): Promise<DesktopWorkflowRun>;
  openDesktopWorkflowArtifact(
    runId: string,
    action: "open" | "reveal"
  ): Promise<boolean>;
  onDesktopWorkflowRunEvent(
    listener: (event: DesktopWorkflowRunEvent) => void
  ): () => void;
  listProjectFileVersions(
    localProjectId: string,
    relativePath: string
  ): Promise<ProjectFileVersionSummary[]>;
  readProjectFileVersion(
    localProjectId: string,
    relativePath: string,
    versionId: string
  ): Promise<ProjectFileVersion>;
  restoreProjectFileVersion(
    localProjectId: string,
    relativePath: string,
    versionId: string
  ): Promise<WriteResult>;
  exportProjectFile(
    localProjectId: string,
    relativePath: string,
    versionId?: string
  ): Promise<{ exportedPath: string } | null>;
  installMcpServer(input: {
    name: string;
    transport: "stdio" | "streamable-http";
    command?: string;
    args: string[];
    url?: string;
    localProjectId: string | null;
  }): Promise<McpServerSummary>;
  listMcpServers(): Promise<McpServerSummary[]>;
  startMcpServer(serverId: string): Promise<McpServerSummary>;
  stopMcpServer(serverId: string): Promise<McpServerSummary>;
  removeMcpServer(serverId: string): Promise<void>;
  refreshMcpTools(serverId: string): Promise<McpServerSummary>;
  callMcpTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  listAgentProfiles(): Promise<DesktopAgentProfile[]>;
  listChatModels(): Promise<ChatModel[]>;
  listModelProviders(): Promise<ModelProviderSummary[]>;
  saveModelProvider(input: ModelProviderInput): Promise<ModelProviderSummary>;
  syncModelProvider(providerId: string): Promise<ModelProviderSummary>;
  removeModelProvider(providerId: string): Promise<boolean>;
  getLocalApiGateway(): Promise<LocalApiGatewayState>;
  updateLocalApiGateway(input: LocalApiGatewayUpdate): Promise<LocalApiGatewayState>;
  saveLocalApiGatewayRoute(input: LocalApiGatewayRouteInput): Promise<LocalApiGatewayState>;
  removeLocalApiGatewayRoute(routeId: string): Promise<LocalApiGatewayState>;
  listLocalApiGatewayUsage(limit?: number): Promise<LocalApiGatewayUsage[]>;
  listLocalProjectChats(localProjectId: string | null): Promise<LocalProjectChatSummary[]>;
  listRecentLocalChats(limit?: number): Promise<LocalProjectChatSummary[]>;
  createLocalProjectChat(localProjectId: string | null): Promise<LocalProjectChatSummary>;
  renameLocalProjectChat(localProjectId: string | null, sessionId: string, title: string): Promise<LocalProjectChatSummary>;
  deleteLocalProjectChat(localProjectId: string | null, sessionId: string): Promise<void>;
  moveLocalProjectChat(localProjectId: string | null, sessionId: string, targetProjectId: string | null): Promise<LocalProjectChatSummary>;
  getLocalProjectChat(localProjectId: string | null, sessionId?: string): Promise<LocalProjectChat | null>;
  truncateLocalProjectChat(localProjectId: string | null, messageId: string): Promise<number>;
  sendProjectMessage(input: ProjectChatRequest): Promise<void>;
  stopProjectMessage(requestId: string): Promise<void>;
  onProjectChatEvent(listener: (event: ProjectChatEvent) => void): () => void;
};
