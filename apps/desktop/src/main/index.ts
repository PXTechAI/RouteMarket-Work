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
  DesktopWorkflowNodeRegistry,
  DesktopWorkflowDraft,
  LocalTriggerInput,
  ManagedBrowserProfileInput,
  NativeAppConnectorId,
  ProjectChatRequest,
  ProjectSummary,
  WorkState
} from "../shared/desktop-api";
import { CloudWorkerClient } from "./cloud-worker-client";
import { ApprovalStore } from "./approval-store";
import { ActivityStore } from "./activity-store";
import { DesktopAuthManager } from "./desktop-auth-manager";
import { DeviceCredentialStore } from "./device-credential-store";
import { ProjectChatClient } from "./project-chat-client";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";
import { LocalToolBroker } from "./tool-broker";
import { ManagedBrowserManager } from "./managed-browser-manager";
import { AttachedBrowserManager } from "./attached-browser-manager";
import { LocalTriggerManager } from "./local-trigger-manager";
import { NativeAppConnectorManager } from "./native-app-connector-manager";
import { WorkflowDraftStore } from "./workflow-draft-store";
import { WorkerClient } from "./worker-client";

declare const __ROUTEMARKET_WORK_DEFAULT_API_URL__: string;

const PROTOCOL = "routemarket-work";
const API_BASE_URL = (
  process.env.ROUTEMARKET_WORK_API_URL ??
  __ROUTEMARKET_WORK_DEFAULT_API_URL__
).replace(/\/+$/, "");

let mainWindow: BrowserWindow | null = null;
let workerClient: WorkerClient | null = null;
let cloudWorkerClient: CloudWorkerClient | null = null;
let desktopAuthManager: DesktopAuthManager | null = null;
let projectChatClient: ProjectChatClient | null = null;
let approvalStore: ApprovalStore | null = null;
let activityStore: ActivityStore | null = null;
let managedBrowser: ManagedBrowserManager | null = null;
let localTriggerManager: LocalTriggerManager | null = null;
let workflowDraftStore: WorkflowDraftStore | null = null;
const attachedBrowser = new AttachedBrowserManager();
const nativeAppConnectors = new NativeAppConnectorManager();
let pendingDeepLink: string | null = null;
const transientActivities: ActivityItem[] = [];
const toolBroker = new LocalToolBroker(
  async (request) => {
    if (!mainWindow) return false;
    const result = await dialog.showMessageBox(mainWindow, {
      type: request.risk === "R1" ? "question" : "warning",
      title: "RouteMarket Work 本机审批",
      message: request.title,
      detail: `${request.detail}\n\n能力：${request.capability} · 风险：${request.risk}`,
      buttons: ["取消", "允许一次"],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    });
    return result.response === 1;
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
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  managedBrowser = new ManagedBrowserManager(mainWindow);

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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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
  if (!workerClient) throw new Error("RouteMarket Worker is offline.");
  if (Date.parse(job.deadlineAt) <= Date.now()) throw new Error("The Desktop Job deadline has expired.");
  if (signal.aborted) throw Object.assign(new Error("Desktop Job was canceled."), { code: "TOOL_CANCELED" });
  if (job.executorKey === "local.fs.read") {
    return workerClient.executeJob(job, leaseId, leaseEpoch);
  }
  const began = await workerClient.beginExternalJob(job, leaseId, leaseEpoch);
  if (!began.execute) return began.events;
  try {
    await emitEvents(began.events);
    const project = (await workerClient.listProjects()).find(
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
      }
    );
    assertInlineResult(job, result);
    return workerClient.completeExternalJob(job, leaseId, leaseEpoch, result);
  } catch (error) {
    return workerClient.failExternalJob(job, leaseId, leaseEpoch, {
      code: typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "TOOL_EXECUTION_FAILED",
      message: error instanceof Error ? error.message : "Unknown local Tool error"
    });
  }
}

async function invokeExternalDesktopJob(
  job: Exclude<DesktopJob, { executorKey: "local.fs.read" }>,
  localProjectId: string
): Promise<Record<string, unknown>> {
  if (job.executorKey === "local.browser.navigate") {
    if (attachedBrowser.state().connected) {
      const state = await attachedBrowser.navigate(job.input.url);
      return { url: state.target?.url ?? job.input.url, title: state.target?.title ?? "" };
    }
    const state = await requireBrowser().navigate(localProjectId, job.input.url);
    return { url: state.url, title: state.title };
  }
  if (job.executorKey === "local.browser.click") {
    if (attachedBrowser.state().connected) await attachedBrowser.click(job.input.selector);
    else await requireBrowser().click(localProjectId, job.input.selector);
    return { completed: true };
  }
  if (job.executorKey === "local.browser.type") {
    if (attachedBrowser.state().connected) await attachedBrowser.type(job.input.selector, job.input.text);
    else await requireBrowser().type(localProjectId, job.input.selector, job.input.text);
    return { completed: true };
  }
  if (job.executorKey === "local.browser.extract") {
    return {
      text: attachedBrowser.state().connected
        ? await attachedBrowser.extract(job.input.selector)
        : await requireBrowser().extract(localProjectId, job.input.selector)
    };
  }
  if (job.executorKey === "local.browser.screenshot") {
    return {
      dataUrl: attachedBrowser.state().connected
        ? await attachedBrowser.screenshot()
        : await requireBrowser().screenshot(localProjectId)
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

function externalJobTitle(job: Exclude<DesktopJob, { executorKey: "local.fs.read" }>): string {
  if (job.executorKey === "local.mcp.call") return `允许 Workflow 调用 MCP Tool ${job.input.name}？`;
  if (job.executorKey === "local.app.open") return `允许 Workflow 使用 ${job.input.connectorId} 打开项目内容？`;
  return `允许 Workflow 执行 ${job.executorKey}？`;
}

function externalJobDetail(job: Exclude<DesktopJob, { executorKey: "local.fs.read" }>): string {
  if (job.executorKey === "local.browser.navigate") return job.input.url;
  if (job.executorKey === "local.browser.screenshot") return "当前托管浏览器页面";
  if (job.executorKey === "local.mcp.call") return `${job.input.serverId} · ${job.input.name}`;
  if (job.executorKey === "local.app.open") return `${job.input.connectorId} · ${job.input.relativePath ?? "."}`;
  return job.input.selector;
}

function externalJobAuditTarget(job: Exclude<DesktopJob, { executorKey: "local.fs.read" }>): string {
  if (job.executorKey === "local.browser.navigate") return new URL(job.input.url).origin;
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
    approvals: approvalStore?.list() ?? []
  };
}

function registerIpc(): void {
  ipcMain.handle("work:get-state", getWorkState);

  ipcMain.handle("work:sign-in", async (): Promise<WorkState> => {
    await desktopAuthManager?.signIn();
    return getWorkState();
  });

  ipcMain.handle("work:sign-out", async (): Promise<WorkState> => {
    await desktopAuthManager?.signOut();
    return getWorkState();
  });

  ipcMain.handle("work:choose-project", async (): Promise<ProjectSummary | null> => {
    if (!mainWindow || !workerClient) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择本地项目",
      properties: ["openDirectory", "createDirectory"]
    });
    const rootPath = result.filePaths[0];
    if (result.canceled || !rootPath) return null;
    const project = await workerClient.bindProject(rootPath);
    addActivity("project.bound", "项目已绑定", project.displayName);
    void cloudWorkerClient?.syncProjects().catch((error: unknown) => {
      addActivity(
        "cloud.error",
        "项目云端同步失败",
        error instanceof Error ? error.message : "Unknown cloud sync error"
      );
    });
    return project;
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
    requireBrowser().navigate(localProjectId, url, pageId)
  );
  ipcMain.handle("work:browser-back", (_event, localProjectId: string, pageId?: string) =>
    requireBrowser().back(localProjectId, pageId)
  );
  ipcMain.handle("work:browser-forward", (_event, localProjectId: string, pageId?: string) =>
    requireBrowser().forward(localProjectId, pageId)
  );
  ipcMain.handle("work:browser-reload", (_event, localProjectId: string, pageId?: string) =>
    requireBrowser().reload(localProjectId, pageId)
  );
  ipcMain.handle("work:browser-takeover", (
    _event,
    localProjectId: string,
    userTakeover: boolean,
    pageId?: string
  ) =>
    requireBrowser().setUserTakeover(localProjectId, Boolean(userTakeover), pageId)
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
      () => requireBrowser().click(localProjectId, selector, pageId)
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
      () => requireBrowser().type(localProjectId, selector, text, pageId)
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
      () => requireBrowser().extract(localProjectId, selector, pageId)
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
      () => requireBrowser().screenshot(localProjectId, pageId)
    )
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

  ipcMain.handle(
    "work:send-project-message",
    async (_event, input: ProjectChatRequest) => {
      if (!projectChatClient || !workerClient) {
        throw new Error("RouteMarket chat is unavailable.");
      }
      const project = (await workerClient.listProjects()).find(
        (candidate) => candidate.localProjectId === input.project.localProjectId
      );
      if (!project) throw new Error("The selected project is not bound on this device.");
      const projectContext = await workerClient.projectContext(project.localProjectId);
      void projectChatClient.send({
        ...input,
        project: {
          localProjectId: project.localProjectId,
          displayName: project.displayName
        },
        projectContext
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
    registerProtocolClient();
    const workDataPath = join(app.getPath("userData"), "worker");
    await mkdir(workDataPath, { recursive: true });
    workerClient = new WorkerClient(workDataPath);
    workerClient.start();
    approvalStore = new ApprovalStore(join(workDataPath, "work.db"));
    activityStore = new ActivityStore(join(workDataPath, "work.db"));
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
    for (const item of transientActivities.reverse()) activityStore.append(item);
    transientActivities.length = 0;

    const installationId = await loadInstallationId(workDataPath);
    const platform = process.platform === "darwin" ? "macos" : "windows";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    cloudWorkerClient = new CloudWorkerClient({
      apiBaseUrl: API_BASE_URL,
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
      apiBaseUrl: API_BASE_URL,
      installationId,
      deviceName: hostname(),
      platform,
      arch,
      appVersion: app.getVersion(),
      credentialStore: new DeviceCredentialStore(
        join(workDataPath, "device-credentials.json")
      ),
      openExternal: (url) => shell.openExternal(url),
      onAccessToken: (token) => cloudWorkerClient?.setAccessToken(token)
    });
    projectChatClient = new ProjectChatClient({
      apiBaseUrl: API_BASE_URL,
      getAccessToken: () => desktopAuthManager?.getAccessToken(),
      onEvent: (event) => mainWindow?.webContents.send("work:project-chat-event", event),
      toolRunner: new ProjectChatToolRunner({
        workerClient,
        toolBroker,
        getBrowser: () => requireBrowser(),
        mcpClient: workerClient,
        onActivity: addActivity
      })
    });
    registerIpc();
    createWindow();
    await localTriggerManager.startAll();

    await desktopAuthManager.initialize();
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
  void attachedBrowser.disconnect();
  localTriggerManager?.close();
  localTriggerManager = null;
  workflowDraftStore?.close();
  workflowDraftStore = null;
  projectChatClient?.stopAll();
  cloudWorkerClient?.stop();
  workerClient?.stop();
  approvalStore?.close();
  approvalStore = null;
  activityStore?.close();
  activityStore = null;
});
