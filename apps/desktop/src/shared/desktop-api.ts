export type ProjectSummary = {
  localProjectId: string;
  displayName: string;
  hasFolder?: boolean;
  folderStatus?: "unlinked" | "available" | "missing" | "unavailable";
  rootFingerprint: string;
  createdAt: string;
  updatedAt: string;
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
};

export type DesktopWorkflowDraft = {
  workflowId: string;
  localProjectId: string;
  kind: "workflow" | "local_action";
  name: string;
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
  | "succeeded"
  | "failed"
  | "canceled";

export type DesktopWorkflowNodeRunStatus =
  | "pending"
  | "running"
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
  totalBytes: number;
  databaseBytes: number;
  databaseHealth: "empty" | "healthy" | "corrupt";
  lastRecoveredAt: string | null;
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
  category: "chat" | "reasoning";
  supportsTools: boolean;
  supportsNativeWebSearch: boolean;
  supportsVision: boolean;
  supportsStream: boolean;
  preferredChatProtocol: "openai_responses" | null;
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
  modelSupportsVision?: boolean;
  message: string;
  attachments?: DesktopChatAttachment[];
  history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  project: {
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
  localProjectId: string;
  role: "user" | "assistant";
  content: string;
  sentAt: string;
  contextFile?: string;
  attachments?: DesktopChatAttachment[];
  stopped?: boolean;
  agentId?: string;
  agentRevision?: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
};

export type LocalProjectChat = {
  sessionId: string;
  localProjectId: string;
  messages: LocalProjectChatMessage[];
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

export type ProjectChatEvent =
  | {
      requestId: string;
      type: "delta";
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
    };

export type RouteMarketWorkApi = {
  getState(): Promise<WorkState>;
  getLocalDataInfo(): Promise<LocalDataInfo>;
  showLocalData(): Promise<void>;
  exportLocalData(): Promise<{ exportedPath: string } | null>;
  clearLocalData(): Promise<boolean>;
  clearActivities(): Promise<WorkState>;
  signIn(): Promise<WorkState>;
  signOut(): Promise<WorkState>;
  switchSpace(spaceId: string): Promise<WorkState>;
  removeApprovalPolicy(policyId: string): Promise<boolean>;
  chooseProject(): Promise<ProjectSummary | null>;
  chooseWorkflowOutputDirectory(): Promise<string | null>;
  createProject(displayName: string): Promise<ProjectSummary>;
  attachProjectFolder(localProjectId: string): Promise<ProjectSummary | null>;
  deleteProject(localProjectId: string): Promise<boolean>;
  getProjectContext(localProjectId: string): Promise<ProjectContext>;
  getWorkflowNodeRegistry(localProjectId: string): Promise<DesktopWorkflowNodeRegistry>;
  listProjectFiles(localProjectId: string): Promise<ProjectFileTree>;
  searchProject(localProjectId: string, query: string): Promise<ProjectSearchResult>;
  readProjectFile(localProjectId: string, relativePath: string): Promise<ReadResult>;
  readProjectAsset(localProjectId: string, relativePath: string): Promise<ProjectAssetPreview>;
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
  retryDesktopWorkflowRun(runId: string): Promise<DesktopWorkflowRun>;
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
  getLocalProjectChat(localProjectId: string): Promise<LocalProjectChat | null>;
  truncateLocalProjectChat(localProjectId: string, messageId: string): Promise<number>;
  sendProjectMessage(input: ProjectChatRequest): Promise<void>;
  stopProjectMessage(requestId: string): Promise<void>;
  onProjectChatEvent(listener: (event: ProjectChatEvent) => void): () => void;
};
