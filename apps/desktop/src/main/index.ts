import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from "electron";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";
import { projectBindingIdFor } from "@routemarket/work-worker-core";
import type {
  ActivityItem,
  BrowserBounds,
  DesktopWorkflowDraft,
  DesktopWorkflowNodeRegistry,
  LocalTriggerInput,
  ManagedBrowserProfileInput,
  NativeAppConnectorId,
  ProjectChatRequest,
  ProjectSummary,
  WorkState
} from "../shared/desktop-api";
import { CloudWorkerClient } from "./cloud-worker-client";
import { CloudWorkflowClient } from "./cloud-workflow-client";
import {
  approvalDialogChoices,
  approvalDialogLabel,
  resolveStoredApprovalPolicy
} from "./approval-policy";
import { ApprovalStore } from "./approval-store";
import { ActivityStore } from "./activity-store";
import { LocalChatStore } from "./local-chat-store";
import { DesktopAuthManager } from "./desktop-auth-manager";
import { DeviceCredentialStore } from "./device-credential-store";
import { ProjectChatClient } from "./project-chat-client";
import { RouteMarketApiClient } from "./routemarket-api-client";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";
import {
  LocalToolBroker,
  resolveToolApprovalGate,
  type ToolAuthorizationRequest,
  type ToolRisk
} from "./tool-broker";
import {
  ManagedBrowserManager,
  type ManagedBrowserRetryDescriptor
} from "./managed-browser-manager";
import { AttachedBrowserManager } from "./attached-browser-manager";
import { LocalTriggerManager } from "./local-trigger-manager";
import { NativeAppConnectorManager } from "./native-app-connector-manager";
import { createLocalWorkflowNodeExecutor } from "./local-workflow-node-executor";
import { LocalWorkflowRuntime } from "./local-workflow-runtime";
import { WorkflowDraftStore } from "./workflow-draft-store";
import { WorkflowRunStore } from "./workflow-run-store";
import { WorkerClient } from "./worker-client";
import { DESKTOP_APP_ID, desktopWindowIconPath } from "./desktop-brand";

declare const __ROUTEMARKET_WORK_DEFAULT_API_URL__: string;
declare const __ROUTEMARKET_WORK_DEFAULT_WEB_URL__: string;

const PROTOCOL = "routemarket-work";
const API_BASE_URL = (
  process.env.ROUTEMARKET_WORK_API_URL ??
  __ROUTEMARKET_WORK_DEFAULT_API_URL__
).replace(/\/+$/, "");
const WEB_BASE_URL = (
  process.env.ROUTEMARKET_WORK_WEB_URL ??
  __ROUTEMARKET_WORK_DEFAULT_WEB_URL__
).replace(/\/+$/, "");

let mainWindow: BrowserWindow | null = null;
let workerClient: WorkerClient | null = null;
let cloudWorkerClient: CloudWorkerClient | null = null;
let desktopAuthManager: DesktopAuthManager | null = null;
let accountSyncTimer: NodeJS.Timeout | null = null;
let projectChatClient: ProjectChatClient | null = null;
let approvalStore: ApprovalStore | null = null;
let activityStore: ActivityStore | null = null;
let localChatStore: LocalChatStore | null = null;
const activeLocalChats = new Map<string, {
  sessionId: string;
  localProjectId: string;
  sentAt: string;
  agentId?: string;
  agentRevision?: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
}>();
let managedBrowser: ManagedBrowserManager | null = null;
let localTriggerManager: LocalTriggerManager | null = null;
let workflowDraftStore: WorkflowDraftStore | null = null;
let workflowRunStore: WorkflowRunStore | null = null;
let localWorkflowRuntime: LocalWorkflowRuntime | null = null;
const attachedBrowser = new AttachedBrowserManager();
const nativeAppConnectors = new NativeAppConnectorManager();
let pendingDeepLink: string | null = null;
const transientActivities: ActivityItem[] = [];
const toolBroker = new LocalToolBroker(
  async (request) => {
    const policy = approvalStore?.matchPolicy(request);
    const storedDecision = resolveStoredApprovalPolicy(request, policy ?? null);
    const approvalGate = resolveToolApprovalGate(request.approvalMode, storedDecision);
    if (approvalGate !== "prompt") return approvalGate === "allow";
    // A synced Agent may request more caution, but it may never silently lower
    // this device's approval boundary. "Never ask" therefore requires a
    // pre-existing local allow policy; otherwise the operation is denied.
    if (!mainWindow) return false;
    const choices = approvalDialogChoices(request);
    const buttons = choices.map(approvalDialogLabel);
    const result = await dialog.showMessageBox(mainWindow, {
      type: request.risk === "R1" ? "question" : "warning",
      title: "RouteMarket Work 本机审批",
      message: request.title,
      detail: `${request.detail}\n\n能力：${request.capability} · 风险：${request.risk}${
        request.projectId ? "\n策略范围：当前项目" : ""
      }`,
      buttons,
      defaultId: 1,
      cancelId: 0,
      noLink: true
    });
    const decision = choices[result.response];
    if (decision === "allow_project" && request.projectId) {
      approvalStore?.setPolicy({
        capability: request.capability,
        projectId: request.projectId,
        effect: "allow"
      });
      return true;
    }
    if (decision === "deny_project" && request.projectId) {
      approvalStore?.setPolicy({
        capability: request.capability,
        projectId: request.projectId,
        effect: "deny"
      });
      return false;
    }
    return decision === "allow_once";
  },
  (request, decision) => {
    if (decision === "requested") approvalStore?.request(request);
    else approvalStore?.resolve(request.invocationId, decision);
    const kind = decision === "requested"
      ? "approval.requested"
      : decision === "approved"
        ? "approval.approved"
        : "approval.denied";
    const title = decision === "requested"
      ? "等待本机审批"
      : decision === "approved"
        ? "本机审批已通过"
        : "本机审批已拒绝";
    addActivity(kind, title, `${request.capability} · ${request.auditDetail ?? request.detail}`);
  }
);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#f4f3ef",
    title: "RouteMarket Work",
    icon: desktopWindowIconPath(__dirname),
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  managedBrowser = new ManagedBrowserManager(mainWindow, {
    resolveProjectRoot: (localProjectId) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return workerClient.projectRoot(localProjectId);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && url !== currentUrl) {
      event.preventDefault();
    }
  });
  mainWindow.on("close", () => {
    managedBrowser?.destroy();
    managedBrowser = null;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("focus", () => {
    void desktopAuthManager?.syncAccount();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => mainWindow?.show());
}

function browserRetryApproval(
  localProjectId: string,
  operationId: string,
  descriptor: ManagedBrowserRetryDescriptor
): Omit<ToolAuthorizationRequest, "invocationId"> {
  const risk: ToolRisk = descriptor.kind === "upload"
    ? "R3"
    : descriptor.kind === "click" || descriptor.kind === "type"
      ? "R2"
      : "R1";
  const capability = `local.browser.${descriptor.kind === "takeover" ? "control" : descriptor.kind}`;
  const detail = descriptor.kind === "navigate"
    ? descriptor.value
    : descriptor.kind === "click" ||
        descriptor.kind === "type" ||
        descriptor.kind === "extract" ||
        descriptor.kind === "upload"
      ? descriptor.selector
      : descriptor.pageId ?? "active page";
  return {
    capability,
    risk,
    title: "重新执行失败的浏览器操作？",
    detail,
    auditDetail: `${descriptor.kind} · ${operationId}`,
    approvalKey: `${operationId}:${createHash("sha256")
      .update(JSON.stringify(descriptor))
      .digest("hex")}`,
    projectId: localProjectId
  };
}

function focusMainWindow(): void {
  if (!mainWindow) {
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function addActivity(
  kind: ActivityItem["kind"],
  title: string,
  detail: string
): void {
  const item: ActivityItem = {
    id: `activity_${randomUUID().replaceAll("-", "")}`,
    kind,
    title,
    detail,
    occurredAt: new Date().toISOString()
  };
  if (activityStore) activityStore.append(item);
  else transientActivities.unshift(item);
}

function requireBrowser(): ManagedBrowserManager {
  if (!managedBrowser) throw new Error("Managed Browser is unavailable.");
  return managedBrowser;
}

async function resolveProjectExportSource(projectRoot: string, relativePath: string): Promise<string> {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || isAbsolute(relativePath) || normalized.split("/").includes("..")) {
    throw new Error("Export source must stay inside the project.");
  }
  const root = await realpath(projectRoot);
  const source = await realpath(resolve(root, relativePath));
  const fromRoot = relative(root, source);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Export source escapes the project root.");
  }
  return source;
}

async function assertExportDestinationOutsideProjects(destination: string): Promise<void> {
  if (!workerClient) throw new Error("RouteMarket Worker is offline.");
  const canonicalDestination = await realpath(destination).catch(async () =>
    resolve(await realpath(dirname(destination)), basename(destination))
  );
  for (const project of await workerClient.listProjects()) {
    const root = await realpath(await workerClient.projectRoot(project.localProjectId));
    const fromRoot = relative(root, canonicalDestination);
    if (fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))) {
      throw new Error("Export destination must be outside bound project folders. Use the project editor for project writes.");
    }
  }
}

async function executeExternalDesktopJob(
  job: DesktopJob,
  leaseId: string,
  leaseEpoch: number,
  signal: AbortSignal,
  emitEvents: (events: JobEvent[]) => Promise<void>
): Promise<JobEvent[]> {
  const client = workerClient;
  if (!client) throw new Error("RouteMarket Worker is offline.");
  if (Date.parse(job.deadlineAt) <= Date.now()) throw new Error("The Desktop Job deadline has expired.");
  if (signal.aborted) throw Object.assign(new Error("Desktop Job was canceled."), { code: "TOOL_CANCELED" });
  if (job.executorKey === "local.fs.read" || job.executorKey === "local.skill.invoke") {
    return client.executeJob(job, leaseId, leaseEpoch);
  }
  const began = await client.beginExternalJob(job, leaseId, leaseEpoch);
  if (!began.execute) return began.events;
  try {
    await emitEvents(began.events);
    const project = (await client.listProjects()).find(
      (candidate) => projectBindingIdFor(candidate.localProjectId) === job.projectBindingId
    );
    if (!project) throw Object.assign(new Error("Desktop Job project binding is unavailable."), {
      code: "PROJECT_BINDING_INVALID"
    });
    const result = await toolBroker.run(
      {
        capability: job.executorKey,
        risk: job.approvalPolicy.risk,
        title: externalJobTitle(job),
        detail: externalJobDetail(job),
        auditDetail: `${job.executorKey} · ${externalJobAuditTarget(job)}`,
        approvalKey: `${job.idempotencyKey}:${createHash("sha256")
          .update(JSON.stringify(job.input))
          .digest("hex")}`,
        projectId: project.localProjectId
      },
      () => {
        if (signal.aborted) {
          throw Object.assign(new Error("Desktop Job was canceled before execution."), {
            code: "TOOL_CANCELED"
          });
        }
        return invokeExternalDesktopJob(job, project.localProjectId);
      },
      async (request, decision) => {
        const eventType = decision === "requested"
          ? "approval.requested"
          : "approval.resolved";
        const events = await client.recordExternalApproval(
          job,
          leaseId,
          leaseEpoch,
          eventType,
          {
            approvalId: request.invocationId,
            capability: request.capability,
            risk: request.risk,
            ...(decision === "requested" ? {} : { decision })
          }
        );
        await emitEvents(events);
      }
    );
    assertInlineResult(job, result);
    return client.completeExternalJob(job, leaseId, leaseEpoch, result);
  } catch (error) {
    return client.failExternalJob(job, leaseId, leaseEpoch, {
      code: typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "TOOL_EXECUTION_FAILED",
      message: error instanceof Error ? error.message : "Unknown local Tool error"
    });
  }
}

async function invokeExternalDesktopJob(
  job: ExternalDesktopJob,
  localProjectId: string
): Promise<Record<string, unknown>> {
  if (job.executorKey === "local.browser.navigate") {
    if (attachedBrowser.state().connected) {
      const state = await attachedBrowser.navigate(job.input.url);
      return { url: state.target?.url ?? job.input.url, title: state.target?.title ?? "" };
    }
    const state = await requireBrowser().navigate(
      localProjectId,
      job.input.url,
      undefined,
      { source: "cloud_job" }
    );
    return { url: state.url, title: state.title };
  }
  if (job.executorKey === "local.browser.click") {
    if (attachedBrowser.state().connected) await attachedBrowser.click(job.input.selector);
    else {
      await requireBrowser().click(
        localProjectId,
        job.input.selector,
        undefined,
        { source: "cloud_job" }
      );
    }
    return { completed: true };
  }
  if (job.executorKey === "local.browser.type") {
    if (attachedBrowser.state().connected) await attachedBrowser.type(job.input.selector, job.input.text);
    else {
      await requireBrowser().type(
        localProjectId,
        job.input.selector,
        job.input.text,
        undefined,
        { source: "cloud_job" }
      );
    }
    return { completed: true };
  }
  if (job.executorKey === "local.browser.extract") {
    return {
      text: attachedBrowser.state().connected
        ? await attachedBrowser.extract(job.input.selector)
        : await requireBrowser().extract(
            localProjectId,
            job.input.selector,
            undefined,
            { source: "cloud_job" }
          )
    };
  }
  if (job.executorKey === "local.browser.screenshot") {
    return {
      dataUrl: attachedBrowser.state().connected
        ? await attachedBrowser.screenshot()
        : await requireBrowser().screenshot(
            localProjectId,
            undefined,
            { source: "cloud_job" }
          )
    };
  }
  if (job.executorKey === "local.browser.upload") {
    const result = await requireBrowser().upload(
      localProjectId,
      job.input.selector,
      job.input.relativePaths,
      job.input.pageId,
      { source: "cloud_job" }
    );
    return {
      completed: result.completed,
      pageId: result.pageId,
      url: result.url,
      relativePaths: result.relativePaths
    };
  }
  if (job.executorKey === "local.app.open") {
    const result = await nativeAppConnectors.open(
      job.input.connectorId,
      await workerClient!.projectRoot(localProjectId),
      job.input.relativePath
    );
    return {
      connectorId: result.connectorId,
      relativePath: job.input.relativePath ?? ".",
      launchedAt: result.launchedAt
    };
  }
  const server = (await workerClient!.listMcpServers()).find(
    (candidate) => candidate.serverId === job.input.serverId
  );
  if (!server || (server.localProjectId && server.localProjectId !== localProjectId)) {
    throw Object.assign(new Error("MCP server is not authorized for this project."), {
      code: "MCP_PROJECT_SCOPE_INVALID"
    });
  }
  if (server.status !== "online") await workerClient!.startMcpServer(server.serverId);
  return workerClient!.callMcpTool(server.serverId, job.input.name, job.input.arguments);
}

type ExternalDesktopJob = Exclude<
  DesktopJob,
  { executorKey: "local.fs.read" | "local.skill.invoke" }
>;

function externalJobTitle(job: ExternalDesktopJob): string {
  if (job.executorKey === "local.mcp.call") return `允许 Workflow 调用 MCP Tool ${job.input.name}？`;
  if (job.executorKey === "local.app.open") return `允许 Workflow 使用 ${job.input.connectorId} 打开项目内容？`;
  return `允许 Workflow 执行 ${job.executorKey}？`;
}

function externalJobDetail(job: ExternalDesktopJob): string {
  if (job.executorKey === "local.browser.navigate") return job.input.url;
  if (job.executorKey === "local.browser.screenshot") return "当前托管浏览器页面";
  if (job.executorKey === "local.browser.upload") {
    return `${job.input.selector} / ${job.input.relativePaths.length} files`;
  }
  if (job.executorKey === "local.mcp.call") return `${job.input.serverId} · ${job.input.name}`;
  if (job.executorKey === "local.app.open") return `${job.input.connectorId} · ${job.input.relativePath ?? "."}`;
  return job.input.selector;
}

function externalJobAuditTarget(job: ExternalDesktopJob): string {
  if (job.executorKey === "local.browser.navigate") return new URL(job.input.url).origin;
  if (job.executorKey === "local.browser.upload") return job.input.relativePaths.join(", ");
  if (job.executorKey === "local.mcp.call") return `${job.input.serverId}/${job.input.name}`;
  if (job.executorKey === "local.app.open") return `${job.input.connectorId}/${job.input.relativePath ?? "."}`;
  if (job.executorKey === "local.browser.screenshot") return "managed-browser";
  return job.input.selector;
}

function assertInlineResult(job: DesktopJob, result: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > job.maxInlineResultBytes) {
    throw Object.assign(new Error("Desktop Tool result exceeds the inline result limit."), {
      code: "RESULT_TOO_LARGE"
    });
  }
}

function withNativeConnectorDefinitions(registry: DesktopWorkflowNodeRegistry): DesktopWorkflowNodeRegistry {
  const connectorDefinitions = nativeAppConnectors.list().map((connector) => {
    const definition = {
      executorKey: `local.app.${connector.connectorId}.open`,
      definitionVersion: 1,
      source: "local_extension" as const,
      executionTarget: "desktop" as const,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { relativePath: { type: "string", maxLength: 4096 } }
      },
      outputSchema: { type: "object", additionalProperties: true },
      requiredCapabilities: ["local.app.open", `local.app.${connector.connectorId}`],
      portability: "requires_connector" as const,
      title: connector.name,
      description: connector.description,
      available: connector.available,
      blockedReason: connector.available ? null : "connector_not_installed"
    };
    return {
      ...definition,
      definitionHash: `sha256:${createHash("sha256").update(JSON.stringify(definition)).digest("hex")}`
    };
  });
  const definitions = [...registry.definitions, ...connectorDefinitions]
    .sort((left, right) => left.executorKey.localeCompare(right.executorKey));
  return {
    generatedAt: registry.generatedAt,
    definitions,
    revisionHash: `sha256:${createHash("sha256").update(JSON.stringify(definitions)).digest("hex")}`
  };
}

function withLocalActionDefinitions(
  registry: DesktopWorkflowNodeRegistry,
  localProjectId: string
): DesktopWorkflowNodeRegistry {
  const actions = workflowDraftStore?.list(localProjectId)
    .filter((draft) => draft.kind === "local_action") ?? [];
  const actionDefinitions = actions.map((action) => {
    const definition = {
      executorKey: `subworkflow.local.${action.workflowId}`,
      definitionVersion: 1,
      source: "local_extension" as const,
      executionTarget: "auto" as const,
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: { type: "object", additionalProperties: true },
      requiredCapabilities: ["workflow.local_action.compose"],
      portability: "device_bound" as const,
      title: action.name,
      description: `可复用本地动作 · ${action.nodeCount} 个节点 / ${action.edgeCount} 条连线`,
      available: true,
      blockedReason: null
    };
    return {
      ...definition,
      definitionHash: `sha256:${createHash("sha256").update(JSON.stringify(definition)).digest("hex")}`
    };
  });
  const definitions = [...registry.definitions, ...actionDefinitions]
    .sort((left, right) => left.executorKey.localeCompare(right.executorKey));
  return {
    ...registry,
    definitions,
    revisionHash: `sha256:${createHash("sha256").update(JSON.stringify(definitions)).digest("hex")}`
  };
}

async function getWorkState(): Promise<WorkState> {
  const projects = (await workerClient?.listProjects()) ?? [];
  const cloudState = cloudWorkerClient?.getState() ?? {
    status: "disabled" as const,
    runtimeId: null,
    error: null
  };
  const authState = desktopAuthManager?.getState() ?? {
    authStatus: "signed_out" as const,
    authError: null
  };
  return {
    workerStatus: workerClient ? "online" : "offline",
    cloudStatus: cloudState.status,
    runtimeId: cloudState.runtimeId,
    cloudError: cloudState.error,
    authStatus: authState.authStatus,
    ...(authState.account ? { account: authState.account } : {}),
    authError: authState.authError,
    projects,
    activities: activityStore?.list() ?? transientActivities.slice(0, 200),
    approvals: approvalStore?.list() ?? [],
    approvalPolicies: approvalStore?.listPolicies() ?? []
  };
}

function registerIpc(): void {
  ipcMain.handle("work:get-state", getWorkState);

  ipcMain.handle("work:activities-clear", async (): Promise<WorkState> => {
    activityStore?.clear();
    transientActivities.length = 0;
    return getWorkState();
  });

  ipcMain.handle("work:sign-in", async (): Promise<WorkState> => {
    await desktopAuthManager?.signIn();
    return getWorkState();
  });

  ipcMain.handle("work:sign-out", async (): Promise<WorkState> => {
    await desktopAuthManager?.signOut();
    return getWorkState();
  });

  ipcMain.handle("work:switch-space", async (_event, spaceId: string): Promise<WorkState> => {
    await desktopAuthManager?.switchSpace(spaceId);
    return getWorkState();
  });

  ipcMain.handle("work:approval-policy-remove", (_event, policyId: string): boolean => {
    const policy = approvalStore?.listPolicies().find((item) => item.policyId === policyId);
    const removed = approvalStore?.removePolicy(policyId) ?? false;
    if (removed) {
      addActivity(
        "approval.policy_removed",
        "项目审批策略已撤销",
        policy ? `${policy.capability} · ${policy.projectId}` : policyId
      );
    }
    return removed;
  });

  ipcMain.handle("work:choose-project", async (): Promise<ProjectSummary | null> => {
    if (!mainWindow || !workerClient) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "从文件夹创建项目",
      properties: ["openDirectory", "createDirectory"]
    });
    const rootPath = result.filePaths[0];
    if (result.canceled || !rootPath) return null;
    const project = await workerClient.bindProject(rootPath);
    addActivity("project.bound", "项目已从文件夹创建", project.displayName);
    void cloudWorkerClient?.syncProjects().catch((error: unknown) => {
      addActivity(
        "cloud.error",
        "工作区运行能力登记失败",
        error instanceof Error ? error.message : "Unknown cloud sync error"
      );
    });
    return project;
  });

  ipcMain.handle("work:create-project", async (_event, displayName: string): Promise<ProjectSummary> => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    const project = await workerClient.createProject(displayName);
    addActivity("project.created", "项目已创建", project.displayName);
    return project;
  });

  ipcMain.handle(
    "work:attach-project-folder",
    async (_event, localProjectId: string): Promise<ProjectSummary | null> => {
      if (!mainWindow || !workerClient) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "关联项目文件夹",
        properties: ["openDirectory", "createDirectory"]
      });
      const rootPath = result.filePaths[0];
      if (result.canceled || !rootPath) return null;
      const project = await workerClient.attachProjectFolder(localProjectId, rootPath);
      addActivity("project.folder_attached", "项目已关联文件夹", project.displayName);
      void cloudWorkerClient?.syncProjects().catch((error: unknown) => {
        addActivity(
          "cloud.error",
          "项目运行能力登记失败",
          error instanceof Error ? error.message : "Unknown cloud sync error"
        );
      });
      return project;
    }
  );

  ipcMain.handle("work:delete-project", async (_event, localProjectId: string): Promise<boolean> => {
    if (!mainWindow || !workerClient) return false;
    const project = (await workerClient.listProjects()).find(
      (candidate) => candidate.localProjectId === localProjectId
    );
    if (!project) return false;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "删除项目",
      message: `确定删除项目“${project.displayName}”吗？`,
      detail: "只会删除项目记录和本机对话，不会删除已关联文件夹或其中的任何文件。",
      buttons: ["取消", "删除项目"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return false;
    for (const [requestId, active] of activeLocalChats) {
      if (active.localProjectId !== localProjectId) continue;
      projectChatClient?.stop(requestId);
      activeLocalChats.delete(requestId);
    }
    const deleted = await workerClient.deleteProject(localProjectId);
    if (deleted) {
      localChatStore?.deleteProject(localProjectId);
      addActivity("project.deleted", "项目已删除", `${project.displayName} · 未删除关联文件夹`);
    }
    return deleted;
  });

  ipcMain.handle("work:list-project-files", async (_event, localProjectId: string) => {
    if (!workerClient) {
      throw new Error("RouteMarket Worker is offline.");
    }
    return workerClient.listProjectFiles(localProjectId);
  });

  ipcMain.handle("work:get-project-context", async (_event, localProjectId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return workerClient.projectContext(localProjectId);
  });

  ipcMain.handle("work:get-workflow-node-registry", async (_event, localProjectId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return withLocalActionDefinitions(
      withNativeConnectorDefinitions(await workerClient.workflowNodeRegistry(localProjectId)),
      localProjectId
    );
  });

  ipcMain.handle(
    "work:search-project",
    async (_event, localProjectId: string, query: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return workerClient.searchProject(localProjectId, query);
    }
  );
  ipcMain.handle("work:workflow-draft-list", (_event, localProjectId: string) => {
    if (!workflowDraftStore) throw new Error("Workflow draft store is unavailable.");
    return workflowDraftStore.list(localProjectId);
  });
  ipcMain.handle("work:workflow-draft-get", (_event, localProjectId: string, workflowId?: string) => {
    if (!workflowDraftStore) throw new Error("Workflow draft store is unavailable.");
    return workflowDraftStore.get(localProjectId, workflowId);
  });
  ipcMain.handle("work:workflow-draft-save", (_event, draft: DesktopWorkflowDraft) => {
    if (!workflowDraftStore) throw new Error("Workflow draft store is unavailable.");
    return toolBroker.run(
      {
        capability: "workflow.draft.write",
        risk: "R1",
        title: `保存工作流草稿：${draft.name}？`,
        detail: `${draft.nodes.length} 个节点 · ${draft.edges.length} 条连线`,
        approvalKey: `${draft.workflowId}:${createHash("sha256").update(JSON.stringify(draft)).digest("hex")}`,
        projectId: draft.localProjectId
      },
      async () => workflowDraftStore!.save(draft)
    );
  });
  ipcMain.handle("work:workflow-draft-delete", (_event, localProjectId: string, workflowId: string) => {
    if (!workflowDraftStore) throw new Error("Workflow draft store is unavailable.");
    return toolBroker.run(
      {
        capability: "workflow.draft.delete",
        risk: "R3",
        title: "允许删除当前项目的本地工作流草稿？",
        detail: workflowId,
        approvalKey: `${localProjectId}:${workflowId}`,
        projectId: localProjectId
      },
      async () => workflowDraftStore!.delete(localProjectId, workflowId)
    );
  });
  ipcMain.handle(
    "work:workflow-run",
    (
      _event,
      localProjectId: string,
      workflowId: string,
      input?: Record<string, unknown>
    ) => {
      if (!localWorkflowRuntime) {
        throw new Error("Local Workflow runtime is unavailable.");
      }
      return localWorkflowRuntime.run(localProjectId, workflowId, input ?? {});
    }
  );
  ipcMain.handle("work:workflow-run-get", (_event, runId: string) => {
    if (!localWorkflowRuntime) {
      throw new Error("Local Workflow runtime is unavailable.");
    }
    return localWorkflowRuntime.get(runId);
  });
  ipcMain.handle(
    "work:workflow-run-list",
    (_event, localProjectId: string, workflowId?: string) => {
      if (!localWorkflowRuntime) {
        throw new Error("Local Workflow runtime is unavailable.");
      }
      return localWorkflowRuntime.list(localProjectId, workflowId);
    }
  );
  ipcMain.handle("work:workflow-run-cancel", (_event, runId: string) => {
    if (!localWorkflowRuntime) {
      throw new Error("Local Workflow runtime is unavailable.");
    }
    return localWorkflowRuntime.cancel(runId);
  });
  ipcMain.handle("work:workflow-run-retry", (_event, runId: string) => {
    if (!localWorkflowRuntime) {
      throw new Error("Local Workflow runtime is unavailable.");
    }
    return localWorkflowRuntime.retry(runId);
  });

  ipcMain.handle(
    "work:read-project-file",
    async (_event, localProjectId: string, relativePath: string) => {
    if (!workerClient) {
      throw new Error("RouteMarket Worker is offline.");
    }
    addActivity("job.started", "读取项目文件", relativePath);
    try {
      const result = await workerClient.readProjectFile(localProjectId, relativePath);
      addActivity("job.succeeded", "文件读取完成", `${relativePath} · ${result.bytesRead} bytes`);
      return result;
    } catch (error) {
      addActivity(
        "job.failed",
        "文件读取失败",
        error instanceof Error ? error.message : "Unknown worker error"
      );
      throw error;
    }
    }
  );

  ipcMain.handle(
    "work:read-project-asset",
    async (_event, localProjectId: string, relativePath: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.fs.read",
          risk: "R0",
          title: `预览 ${relativePath}`,
          detail: relativePath,
          projectId: localProjectId
        },
        () => workerClient!.readProjectAsset(localProjectId, relativePath)
      );
    }
  );

  ipcMain.handle(
    "work:write-project-file",
    async (
      _event,
      localProjectId: string,
      relativePath: string,
      text: string,
      expectedSha256: string
    ) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.fs.write",
          risk: "R1",
          title: `允许保存 ${relativePath}？`,
          detail: relativePath,
          approvalKey: `${expectedSha256}:${createHash("sha256").update(text).digest("hex")}`,
          projectId: localProjectId
        },
        async () => {
          addActivity("job.started", "保存项目文件", relativePath);
          try {
            const result = await workerClient!.writeProjectFile(
              localProjectId,
              relativePath,
              text,
              expectedSha256
            );
            addActivity(
              "job.succeeded",
              result.changed ? "文件保存完成" : "文件没有变化",
              `${relativePath} · ${result.bytesRead} bytes`
            );
            return result;
          } catch (error) {
            addActivity(
              "job.failed",
              "文件保存失败",
              error instanceof Error ? error.message : "Unknown worker error"
            );
            throw error;
          }
        }
      );
    }
  );

  ipcMain.handle(
    "work:create-project-file",
    async (_event, localProjectId: string, relativePath: string, text: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.fs.create",
          risk: "R1",
          title: `允许新建 ${relativePath}？`,
          detail: relativePath,
          approvalKey: `${relativePath}:${createHash("sha256").update(text).digest("hex")}`,
          projectId: localProjectId
        },
        async () => {
          addActivity("job.started", "新建项目文件", relativePath);
          try {
            const result = await workerClient!.createProjectFile(
              localProjectId,
              relativePath,
              text
            );
            addActivity("job.succeeded", "文件创建完成", `${relativePath} · ${result.bytesRead} bytes`);
            return result;
          } catch (error) {
            addActivity(
              "job.failed",
              "文件创建失败",
              error instanceof Error ? error.message : "Unknown worker error"
            );
            throw error;
          }
        }
      );
    }
  );

  ipcMain.handle(
    "work:file-versions-list",
    (_event, localProjectId: string, relativePath: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return workerClient.listProjectFileVersions(localProjectId, relativePath);
    }
  );
  ipcMain.handle(
    "work:file-version-read",
    (_event, localProjectId: string, relativePath: string, versionId: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return workerClient.readProjectFileVersion(localProjectId, relativePath, versionId);
    }
  );
  ipcMain.handle(
    "work:file-version-restore",
    (_event, localProjectId: string, relativePath: string, versionId: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.fs.restore",
          risk: "R2",
          title: `允许恢复 ${relativePath} 的历史版本？`,
          detail: versionId,
          approvalKey: `${relativePath}:${versionId}`,
          projectId: localProjectId
        },
        async () => {
          const result = await workerClient!.restoreProjectFileVersion(
            localProjectId,
            relativePath,
            versionId
          );
          addActivity("job.succeeded", "文件历史版本已恢复", relativePath);
          return result;
        }
      );
    }
  );
  ipcMain.handle(
    "work:file-export",
    async (_event, localProjectId: string, relativePath: string, versionId?: string) => {
      if (!mainWindow || !workerClient) throw new Error("RouteMarket Worker is offline.");
      const selection = await dialog.showSaveDialog(mainWindow, {
        title: versionId ? "导出历史版本" : "导出项目文件",
        defaultPath: basename(relativePath)
      });
      if (selection.canceled || !selection.filePath) return null;
      return toolBroker.run(
        {
          capability: "local.fs.export",
          risk: "R2",
          title: `允许导出 ${relativePath}？`,
          detail: selection.filePath,
          auditDetail: relativePath,
          approvalKey: `${localProjectId}:${relativePath}:${versionId ?? "current"}:${selection.filePath}`,
          projectId: localProjectId
        },
        async () => {
          await assertExportDestinationOutsideProjects(selection.filePath);
          if (versionId) {
            const version = await workerClient!.readProjectFileVersion(
              localProjectId,
              relativePath,
              versionId
            );
            await writeFile(selection.filePath, version.text, "utf8");
          } else {
            const source = await resolveProjectExportSource(
              await workerClient!.projectRoot(localProjectId),
              relativePath
            );
            await copyFile(source, selection.filePath);
          }
          addActivity("job.succeeded", "项目文件已导出", relativePath);
          return { exportedPath: selection.filePath };
        }
      );
    }
  );

  ipcMain.handle(
    "work:start-process",
    async (_event, localProjectId: string, executable: string, args: string[]) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.process.start",
          risk: "R2",
          title: `允许在项目中启动 ${executable}？`,
          detail: [executable, ...args].join(" "),
          auditDetail: executable,
          approvalKey: JSON.stringify([executable, ...args]),
          projectId: localProjectId
        },
        async () => {
          const result = await workerClient!.startProcess(localProjectId, executable, args);
          addActivity("job.started", "本地进程已启动", `${executable} · ${result.processId}`);
          return result;
        }
      );
    }
  );

  ipcMain.handle("work:list-processes", async () => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return workerClient.listProcesses();
  });

  ipcMain.handle("work:stop-process", async (_event, processId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return toolBroker.run(
      {
        capability: "local.process.stop",
        risk: "R2",
        title: "允许停止受控本地进程？",
        detail: processId,
        auditDetail: processId,
        approvalKey: processId
      },
      async () => {
        const result = await workerClient!.stopProcess(processId);
        addActivity("job.succeeded", "本地进程已停止", processId);
        return result;
      }
    );
  });

  ipcMain.handle("work:browser-state", (_event, localProjectId: string) =>
    requireBrowser().getState(localProjectId)
  );
  ipcMain.handle("work:browser-show", (_event, localProjectId: string, bounds: BrowserBounds) =>
    requireBrowser().show(localProjectId, bounds)
  );
  ipcMain.handle("work:browser-hide", () => requireBrowser().hide());
  ipcMain.handle("work:browser-bounds", (_event, bounds: BrowserBounds) => {
    requireBrowser().setBounds(bounds);
  });
  ipcMain.handle(
    "work:browser-page-create",
    (_event, localProjectId: string, profileId?: string) =>
      requireBrowser().createPage(localProjectId, profileId)
  );
  ipcMain.handle(
    "work:browser-page-select",
    (_event, localProjectId: string, pageId: string) =>
      requireBrowser().selectPage(localProjectId, pageId)
  );
  ipcMain.handle(
    "work:browser-page-close",
    (_event, localProjectId: string, pageId: string) =>
      requireBrowser().closePage(localProjectId, pageId)
  );
  ipcMain.handle(
    "work:browser-profile-create",
    (_event, localProjectId: string, input: ManagedBrowserProfileInput) =>
      requireBrowser().createProfile(localProjectId, input)
  );
  ipcMain.handle(
    "work:browser-profile-update",
    (
      _event,
      localProjectId: string,
      profileId: string,
      input: ManagedBrowserProfileInput
    ) => requireBrowser().updateProfile(localProjectId, profileId, input)
  );
  ipcMain.handle(
    "work:browser-profile-delete",
    (_event, localProjectId: string, profileId: string) =>
      requireBrowser().deleteProfile(localProjectId, profileId)
  );
  ipcMain.handle("work:browser-navigate", (_event, localProjectId: string, url: string, pageId?: string) =>
    requireBrowser().navigate(localProjectId, url, pageId, { source: "user" })
  );
  ipcMain.handle("work:browser-back", (_event, localProjectId: string, pageId?: string) =>
    requireBrowser().back(localProjectId, pageId, { source: "user" })
  );
  ipcMain.handle("work:browser-forward", (_event, localProjectId: string, pageId?: string) =>
    requireBrowser().forward(localProjectId, pageId, { source: "user" })
  );
  ipcMain.handle("work:browser-reload", (_event, localProjectId: string, pageId?: string) =>
    requireBrowser().reload(localProjectId, pageId, { source: "user" })
  );
  ipcMain.handle("work:browser-takeover", (
    _event,
    localProjectId: string,
    userTakeover: boolean,
    pageId?: string
  ) =>
    requireBrowser().setUserTakeover(
      localProjectId,
      Boolean(userTakeover),
      pageId,
      { source: "user" }
    )
  );
  ipcMain.handle("work:browser-click", (_event, localProjectId: string, selector: string, pageId?: string) =>
    toolBroker.run(
      {
        capability: "local.browser.click",
        risk: "R2",
        title: "允许 Agent 点击当前网页元素？",
        detail: selector,
        auditDetail: "DOM selector",
        approvalKey: `${localProjectId}:${pageId ?? "active"}:${selector}`,
        projectId: localProjectId
      },
      () => requireBrowser().click(
        localProjectId,
        selector,
        pageId,
        { source: "user" }
      )
    )
  );
  ipcMain.handle("work:browser-type", (
    _event,
    localProjectId: string,
    selector: string,
    text: string,
    pageId?: string
  ) =>
    toolBroker.run(
      {
        capability: "local.browser.type",
        risk: "R2",
        title: "允许 Agent 向当前网页输入内容？",
        detail: selector,
        auditDetail: "DOM input",
        approvalKey: `${localProjectId}:${pageId ?? "active"}:${selector}:${createHash("sha256").update(text).digest("hex")}`,
        projectId: localProjectId
      },
      () => requireBrowser().type(
        localProjectId,
        selector,
        text,
        pageId,
        { source: "user" }
      )
    )
  );
  ipcMain.handle("work:browser-upload", (
    _event,
    localProjectId: string,
    selector: string,
    relativePaths: string[],
    pageId?: string
  ) =>
    toolBroker.run(
      {
        capability: "local.browser.upload",
        risk: "R3",
        title: "允许向当前网页上传项目文件？",
        detail: `${selector} · ${relativePaths.length} 个文件`,
        auditDetail: relativePaths.join(", "),
        approvalKey: `${localProjectId}:${pageId ?? "active"}:${selector}:${createHash("sha256").update(JSON.stringify(relativePaths)).digest("hex")}`,
        projectId: localProjectId
      },
      () => requireBrowser().upload(
        localProjectId,
        selector,
        relativePaths,
        pageId,
        { source: "user" }
      )
    )
  );
  ipcMain.handle("work:browser-extract", (
    _event,
    localProjectId: string,
    selector: string,
    pageId?: string
  ) =>
    toolBroker.run(
      {
        capability: "local.browser.extract",
        risk: "R1",
        title: "允许读取当前网页内容？",
        detail: selector,
        auditDetail: "DOM selector",
        approvalKey: `${localProjectId}:${pageId ?? "active"}:${selector}`,
        projectId: localProjectId
      },
      () => requireBrowser().extract(
        localProjectId,
        selector,
        pageId,
        { source: "user" }
      )
    )
  );
  ipcMain.handle("work:browser-screenshot", (_event, localProjectId: string, pageId?: string) =>
    toolBroker.run(
      {
        capability: "local.browser.screenshot",
        risk: "R1",
        title: "允许截取当前网页画面？",
        detail: "Current managed page",
        auditDetail: "Managed Browser",
        projectId: localProjectId
      },
      () => requireBrowser().screenshot(
        localProjectId,
        pageId,
        { source: "user" }
      )
    )
  );
  ipcMain.handle(
    "work:browser-operation-retry",
    (_event, localProjectId: string, operationId: string) => {
      const browser = requireBrowser();
      const descriptor = browser.getRetryDescriptor(localProjectId, operationId);
      const approval = browserRetryApproval(localProjectId, operationId, descriptor);
      return toolBroker.run(
        approval,
        () => browser.retryOperation(localProjectId, operationId)
      );
    }
  );

  ipcMain.handle("work:attached-browser-discover", (_event, endpoint: string) =>
    toolBroker.run(
      {
        capability: "local.browser.attach.discover",
        risk: "R0",
        title: "发现本机浏览器页面",
        detail: endpoint,
        auditDetail: "localhost DevTools"
      },
      () => attachedBrowser.discover(endpoint)
    )
  );
  ipcMain.handle(
    "work:attached-browser-connect",
    (_event, endpoint: string, targetId?: string) => toolBroker.run(
      {
        capability: "local.browser.attach",
        risk: "R3",
        title: "允许连接已登录的本机浏览器页面？",
        detail: `${endpoint}${targetId ? ` · ${targetId}` : ""}`,
        auditDetail: "localhost DevTools",
        approvalKey: `${endpoint}:${targetId ?? "first-page"}`
      },
      async () => {
        const state = await attachedBrowser.connect(endpoint, targetId);
        addActivity("job.succeeded", "Attached Browser 已连接", state.target?.title ?? endpoint);
        return state;
      }
    )
  );
  ipcMain.handle("work:attached-browser-disconnect", async () => {
    const state = await attachedBrowser.disconnect();
    addActivity("job.succeeded", "Attached Browser 已断开", "localhost DevTools");
    return state;
  });
  ipcMain.handle("work:attached-browser-navigate", (_event, url: string) =>
    toolBroker.run(
      {
        capability: "local.browser.navigate",
        risk: "R1",
        title: "允许 Attached Browser 打开网页？",
        detail: url,
        auditDetail: "Attached Browser",
        approvalKey: url
      },
      () => attachedBrowser.navigate(url)
    )
  );
  ipcMain.handle("work:attached-browser-click", (_event, selector: string) =>
    toolBroker.run(
      {
        capability: "local.browser.click",
        risk: "R2",
        title: "允许点击已连接浏览器中的元素？",
        detail: selector,
        auditDetail: "Attached Browser DOM selector",
        approvalKey: selector
      },
      () => attachedBrowser.click(selector)
    )
  );
  ipcMain.handle("work:attached-browser-type", (_event, selector: string, text: string) =>
    toolBroker.run(
      {
        capability: "local.browser.type",
        risk: "R2",
        title: "允许向已连接浏览器输入内容？",
        detail: selector,
        auditDetail: "Attached Browser DOM input",
        approvalKey: `${selector}:${createHash("sha256").update(text).digest("hex")}`
      },
      () => attachedBrowser.type(selector, text)
    )
  );
  ipcMain.handle("work:attached-browser-extract", (_event, selector: string) =>
    toolBroker.run(
      {
        capability: "local.browser.extract",
        risk: "R1",
        title: "允许读取已连接浏览器的页面内容？",
        detail: selector,
        auditDetail: "Attached Browser DOM selector",
        approvalKey: selector
      },
      () => attachedBrowser.extract(selector)
    )
  );
  ipcMain.handle("work:attached-browser-screenshot", () =>
    toolBroker.run(
      {
        capability: "local.browser.screenshot",
        risk: "R1",
        title: "允许截取已连接浏览器页面？",
        detail: attachedBrowser.state().target?.title ?? "Attached Browser",
        auditDetail: "Attached Browser"
      },
      () => attachedBrowser.screenshot()
    )
  );

  ipcMain.handle("work:local-trigger-list", (_event, localProjectId: string) => {
    if (!localTriggerManager) throw new Error("Local trigger runtime is unavailable.");
    return localTriggerManager.list(localProjectId);
  });
  ipcMain.handle("work:local-trigger-save", (_event, input: LocalTriggerInput, triggerId?: string) => {
    if (!localTriggerManager) throw new Error("Local trigger runtime is unavailable.");
    return toolBroker.run(
      {
        capability: "desktop.trigger.configure",
        risk: "R2",
        title: `允许配置本地触发器：${String(input?.name ?? "未命名")}？`,
        detail: String(input?.kind ?? "unknown"),
        auditDetail: `${String(input?.kind ?? "unknown")} · ${String(input?.localProjectId ?? "")}`,
        approvalKey: JSON.stringify({ triggerId, input }),
        ...(typeof input?.localProjectId === "string" ? { projectId: input.localProjectId } : {})
      },
      () => localTriggerManager!.save(input, triggerId)
    );
  });
  ipcMain.handle("work:local-trigger-remove", (_event, triggerId: string) => {
    if (!localTriggerManager) throw new Error("Local trigger runtime is unavailable.");
    const trigger = localTriggerManager.get(triggerId);
    return toolBroker.run(
      {
        capability: "desktop.trigger.remove",
        risk: "R3",
        title: `允许移除本地触发器${trigger ? `：${trigger.name}` : ""}？`,
        detail: triggerId,
        auditDetail: trigger?.kind ?? "unknown",
        approvalKey: triggerId,
        ...(trigger ? { projectId: trigger.localProjectId } : {})
      },
      () => localTriggerManager!.remove(triggerId)
    );
  });
  ipcMain.handle("work:local-trigger-fire", (_event, triggerId: string) => {
    if (!localTriggerManager) throw new Error("Local trigger runtime is unavailable.");
    return localTriggerManager.fire(triggerId);
  });
  ipcMain.handle("work:native-app-list", () => nativeAppConnectors.list());
  ipcMain.handle(
    "work:native-app-open",
    async (_event, connectorId: NativeAppConnectorId, localProjectId: string, relativePath?: string) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.app.open",
          risk: "R2",
          title: `允许使用 ${connectorId} 打开项目内容？`,
          detail: relativePath ?? "项目根目录",
          auditDetail: `${connectorId} · ${relativePath ?? "."}`,
          approvalKey: `${connectorId}:${localProjectId}:${relativePath ?? "."}`,
          projectId: localProjectId
        },
        async () => {
          const result = await nativeAppConnectors.open(
            connectorId,
            await workerClient!.projectRoot(localProjectId),
            relativePath
          );
          addActivity("job.succeeded", `${connectorId} 已打开`, relativePath ?? "项目根目录");
          return result;
        }
      );
    }
  );

  ipcMain.handle(
    "work:mcp-install",
    async (
      _event,
      input: {
        name: string;
        transport: "stdio" | "streamable-http";
        command?: string;
        args: string[];
        url?: string;
        localProjectId: string | null;
      }
    ) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.mcp.install",
          risk: "R3",
          title: `允许安装 Local MCP：${input.name}？`,
          detail: input.transport === "stdio"
            ? [input.command, ...input.args].filter(Boolean).join(" ")
            : input.url ?? "",
          auditDetail: input.transport === "stdio" ? input.command ?? "" : input.url ?? "",
          approvalKey: JSON.stringify(input),
          ...(input.localProjectId ? { projectId: input.localProjectId } : {})
        },
        async () => {
          const result = await workerClient!.installMcpServer(input);
          addActivity("job.succeeded", "Local MCP 已安装", `${input.name} · ${result.serverId}`);
          return result;
        }
      );
    }
  );
  ipcMain.handle("work:mcp-list", async () => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return workerClient.listMcpServers();
  });
  ipcMain.handle("work:mcp-start", async (_event, serverId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return toolBroker.run(
      {
        capability: "local.mcp.start",
        risk: "R2",
        title: "允许启动 Local MCP Server？",
        detail: serverId,
        auditDetail: serverId,
        approvalKey: serverId
      },
      () => workerClient!.startMcpServer(serverId)
    );
  });
  ipcMain.handle("work:mcp-stop", async (_event, serverId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return toolBroker.run(
      {
        capability: "local.mcp.stop",
        risk: "R1",
        title: "允许停止 Local MCP Server？",
        detail: serverId,
        auditDetail: serverId,
        approvalKey: serverId
      },
      () => workerClient!.stopMcpServer(serverId)
    );
  });
  ipcMain.handle("work:mcp-remove", async (_event, serverId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return toolBroker.run(
      {
        capability: "local.mcp.remove",
        risk: "R3",
        title: "允许移除 Local MCP 配置？",
        detail: serverId,
        auditDetail: serverId,
        approvalKey: serverId
      },
      () => workerClient!.removeMcpServer(serverId)
    );
  });
  ipcMain.handle("work:mcp-tools-refresh", async (_event, serverId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return workerClient.refreshMcpTools(serverId);
  });
  ipcMain.handle(
    "work:mcp-tool-call",
    async (_event, serverId: string, name: string, args: Record<string, unknown>) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.mcp.call",
          risk: "R2",
          title: `允许调用 Local MCP Tool：${name}？`,
          detail: `${serverId} · ${name}`,
          auditDetail: `${serverId} · ${name}`,
          approvalKey: `${serverId}:${name}:${createHash("sha256").update(JSON.stringify(args)).digest("hex")}`
        },
        async () => {
          const result = await workerClient!.callMcpTool(serverId, name, args);
          addActivity("job.succeeded", "Local MCP Tool 调用完成", `${serverId} · ${name}`);
          return result;
        }
      );
    }
  );

  ipcMain.handle("work:list-chat-models", async () => {
    if (!projectChatClient) {
      throw new Error("RouteMarket chat is unavailable.");
    }
    return projectChatClient.listModels();
  });

  ipcMain.handle("work:get-local-project-chat", (_event, localProjectId: string) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.get(localProjectId);
  });

  ipcMain.handle(
    "work:truncate-local-project-chat",
    (_event, localProjectId: string, messageId: string) => {
      if (!localChatStore) throw new Error("Local chat storage is unavailable.");
      const hasActiveRequest = [...activeLocalChats.values()].some(
        (chat) => chat.localProjectId === localProjectId
      );
      if (hasActiveRequest) {
        throw new Error("Stop the active response before editing this conversation.");
      }
      return localChatStore.truncateFrom(localProjectId, messageId);
    }
  );

  ipcMain.handle("work:list-agent-profiles", async () => {
    if (!projectChatClient) {
      throw new Error("RouteMarket Agent profiles are unavailable.");
    }
    return projectChatClient.listAgents();
  });

  ipcMain.handle(
    "work:send-project-message",
    async (_event, input: ProjectChatRequest) => {
      if (!projectChatClient || !workerClient) {
        throw new Error("RouteMarket chat is unavailable.");
      }
      const project = (await workerClient.listProjects()).find(
        (candidate) => candidate.localProjectId === input.project.localProjectId
      );
      if (!project) throw new Error("The selected project does not exist on this device.");
      const folderAvailable =
        project.hasFolder !== false && (project.folderStatus ?? "available") === "available";
      const projectContext = !folderAvailable
        ? null
        : await workerClient.projectContext(project.localProjectId);
      if (!localChatStore) throw new Error("Local chat storage is unavailable.");
      const thread = localChatStore.getOrCreate(project.localProjectId, project.displayName);
      const history = thread.messages.map(({ role, content }) => ({ role, content }));
      localChatStore.append({
        id: `user:${input.requestId}`,
        sessionId: thread.sessionId,
        localProjectId: project.localProjectId,
        role: "user",
        content: input.message,
        sentAt: input.sentAt,
        ...(input.contextFile ? { contextFile: input.contextFile.relativePath } : {})
      });
      activeLocalChats.set(input.requestId, {
        sessionId: thread.sessionId,
        localProjectId: project.localProjectId,
        sentAt: input.sentAt,
        ...(input.agent?.agentId ? { agentId: input.agent.agentId } : {}),
        ...(input.agent?.agentRevision ? { agentRevision: input.agent.agentRevision } : {}),
        ...(input.agent?.agentName ? { agentName: input.agent.agentName } : {}),
        ...(input.agent && "agentAvatarUrl" in input.agent
          ? { agentAvatarUrl: input.agent.agentAvatarUrl }
          : {})
      });
      const trustedInput = { ...input };
      delete trustedInput.projectContext;
      void projectChatClient.send({
        ...trustedInput,
        sessionId: thread.sessionId,
        history,
        project: {
          localProjectId: project.localProjectId,
          displayName: project.displayName,
          hasFolder: folderAvailable
        },
        ...(projectContext ? { projectContext } : {})
      });
    }
  );

  ipcMain.handle("work:stop-project-message", (_event, requestId: string) => {
    projectChatClient?.stop(requestId);
  });
}

async function loadInstallationId(workDataPath: string): Promise<string> {
  const path = join(workDataPath, "installation-id");
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing.trim()) return existing.trim();
  const installationId = `install_${randomUUID().replaceAll("-", "")}`;
  await writeFile(path, installationId, { encoding: "utf8", mode: 0o600 });
  return installationId;
}

function findDeepLink(argv: string[]): string | undefined {
  return argv.find((value) => value.startsWith(`${PROTOCOL}://`));
}

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;
  focusMainWindow();
  if (!desktopAuthManager) {
    pendingDeepLink = url;
    return;
  }
  void desktopAuthManager.handleCallback(url);
}

function registerProtocolClient(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = findDeepLink(commandLine);
    if (deepLink) handleDeepLink(deepLink);
    else focusMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId(DESKTOP_APP_ID);
    registerProtocolClient();
    const workDataPath = join(app.getPath("userData"), "worker");
    await mkdir(workDataPath, { recursive: true });
    workerClient = new WorkerClient(workDataPath);
    workerClient.start();
    approvalStore = new ApprovalStore(join(workDataPath, "work.db"));
    activityStore = new ActivityStore(join(workDataPath, "work.db"));
    localChatStore = new LocalChatStore(join(workDataPath, "work.db"));
    localTriggerManager = new LocalTriggerManager(
      join(workDataPath, "work.db"),
      (localProjectId) => workerClient!.projectRoot(localProjectId),
      ({ trigger, reason, relativePath }) => {
        addActivity(
          "trigger.fired",
          `本地触发器已触发：${trigger.name}`,
          [reason, relativePath].filter(Boolean).join(" · ")
        );
        mainWindow?.webContents.send("work:local-trigger-fired", {
          triggerId: trigger.triggerId,
          localProjectId: trigger.localProjectId,
          reason,
          relativePath
        });
      },
      {
        register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
        unregister: (accelerator) => globalShortcut.unregister(accelerator)
      }
    );
    workflowDraftStore = new WorkflowDraftStore(join(workDataPath, "work.db"));
    workflowRunStore = new WorkflowRunStore(join(workDataPath, "work.db"));
    const apiClient = new RouteMarketApiClient({
      baseUrl: API_BASE_URL,
      appVersion: app.getVersion()
    });
    const cloudWorkflowClient = new CloudWorkflowClient({
      apiClient
    });
    localWorkflowRuntime = new LocalWorkflowRuntime(
      workflowDraftStore,
      workflowRunStore,
      createLocalWorkflowNodeExecutor({
        cloudWorkflowClient,
        workerClient,
        toolBroker,
        getBrowser: requireBrowser,
        nativeAppConnectors
      }),
      (event) => {
        mainWindow?.webContents.send("work:workflow-run-event", event);
        if (event.run.status === "succeeded") {
          addActivity(
            "job.succeeded",
            `Workflow completed: ${event.run.workflowName}`,
            event.run.runId
          );
        } else if (
          event.run.status === "failed" ||
          event.run.status === "canceled"
        ) {
          addActivity(
            "job.failed",
            `Workflow ${event.run.status}: ${event.run.workflowName}`,
            event.run.error ?? event.run.runId
          );
        }
      }
    );
    for (const item of transientActivities.reverse()) activityStore.append(item);
    transientActivities.length = 0;

    const installationId = await loadInstallationId(workDataPath);
    const platform = process.platform === "darwin" ? "macos" : "windows";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    cloudWorkerClient = new CloudWorkerClient({
      apiClient,
      installationId,
      deviceName: hostname(),
      platform,
      arch,
      appVersion: app.getVersion(),
      workerVersion: app.getVersion(),
      workerClient,
      onActivity: addActivity,
      executeDesktopJob: executeExternalDesktopJob
    });
    desktopAuthManager = new DesktopAuthManager({
      apiClient,
      webBaseUrl: WEB_BASE_URL,
      installationId,
      deviceName: hostname(),
      platform,
      arch,
      appVersion: app.getVersion(),
      credentialStore: new DeviceCredentialStore(
        join(workDataPath, "device-credentials.json")
      ),
      openExternal: (url) => shell.openExternal(url),
      onAccessToken: (token) => {
        apiClient.setAccessToken(token);
        cloudWorkerClient?.setAccessToken(token);
      },
      onSpaceChanged: (teamId) => {
        apiClient.setTeamId(teamId);
        cloudWorkerClient?.refreshWorkspace();
      }
    });
    projectChatClient = new ProjectChatClient({
      apiClient,
      onEvent: (event) => {
        const active = activeLocalChats.get(event.requestId);
        if (active && (event.type === "complete" || event.type === "stopped")) {
          localChatStore?.append({
            id: `assistant:${event.requestId}`,
            sessionId: active.sessionId,
            localProjectId: active.localProjectId,
            role: "assistant",
            content: event.content,
            sentAt: active.sentAt,
            ...(event.type === "stopped" ? { stopped: true } : {}),
            ...(active.agentId ? { agentId: active.agentId } : {}),
            ...(active.agentRevision ? { agentRevision: active.agentRevision } : {}),
            ...(active.agentName ? { agentName: active.agentName } : {}),
            ...("agentAvatarUrl" in active
              ? { agentAvatarUrl: active.agentAvatarUrl }
              : {})
          });
          activeLocalChats.delete(event.requestId);
        } else if (event.type === "error") {
          activeLocalChats.delete(event.requestId);
        }
        mainWindow?.webContents.send("work:project-chat-event", event);
      },
      toolRunner: new ProjectChatToolRunner({
        workerClient,
        toolBroker,
        getBrowser: () => requireBrowser(),
        mcpClient: workerClient,
        skillClient: workerClient,
        onActivity: addActivity
      })
    });
    registerIpc();
    createWindow();
    await localTriggerManager.startAll();

    await desktopAuthManager.initialize();
    void desktopAuthManager.syncAccount();
    accountSyncTimer = setInterval(() => {
      void desktopAuthManager?.syncAccount();
    }, 60_000);
    await cloudWorkerClient.start();

    const initialDeepLink = pendingDeepLink ?? findDeepLink(process.argv);
    pendingDeepLink = null;
    if (initialDeepLink) handleDeepLink(initialDeepLink);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (accountSyncTimer) clearInterval(accountSyncTimer);
  accountSyncTimer = null;
  void attachedBrowser.disconnect();
  localTriggerManager?.close();
  localTriggerManager = null;
  workflowDraftStore?.close();
  workflowDraftStore = null;
  localWorkflowRuntime?.cancelAll();
  localWorkflowRuntime = null;
  workflowRunStore?.close();
  workflowRunStore = null;
  projectChatClient?.stopAll();
  cloudWorkerClient?.stop();
  workerClient?.stop();
  approvalStore?.close();
  approvalStore = null;
  activityStore?.close();
  activityStore = null;
  localChatStore?.close();
  localChatStore = null;
});
