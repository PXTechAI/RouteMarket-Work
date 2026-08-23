import { trMain } from "./i18n";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  readFile,
  readdir,
  realpath,
  mkdir,
  lstat,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Notification,
  screen,
  session,
  shell,
  type Rectangle
} from "electron";
import type {
  DesktopJob,
  JobEvent,
  LocalSkillIdentity
} from "@routemarket/work-protocol";
import {
  MarketplacePluginInstaller,
  projectBindingIdFor,
  type MarketplacePluginRelease
} from "@routemarket/work-worker-core";
import type {
  ActivityItem,
  BrowserBounds,
  DesktopChatAttachment,
  DesktopAnalyticsEvent,
  DesktopExtensionFilePickRequest,
  DesktopMenuCommand,
  DesktopWorkflowRunEvent,
  DesktopWorkflowDraft,
  DesktopWorkflowNodeRegistry,
  DownloadableCloudSkill,
  LocalTriggerInput,
  LocalSkillImportKind,
  LocalSkillInstallReceipt,
  MarketplaceCatalogResponse,
  ManagedBrowserProfileInput,
  NativeAppConnectorId,
  ProjectChatEvent,
  ProjectChatRequest,
  ProjectSummary,
  DesktopPreferences,
  WorkState
} from "../shared/desktop-api";
import { CloudWorkerClient } from "./cloud-worker-client";
import { CloudWorkflowClient } from "./cloud-workflow-client";
import { routeMarketAccountUrl } from "./desktop-external-links";
import {
  approvalDialogChoices,
  approvalDialogLabel,
  resolveStoredApprovalPolicy
} from "./approval-policy";
import { ApprovalStore } from "./approval-store";
import { ActivityStore } from "./activity-store";
import { LocalChatStore } from "./local-chat-store";
import { redactCloudText } from "./cloud-redaction";
import {
  clearLocalDataOnStartup,
  exportLocalDatabase,
  inspectLocalData,
  localDataDirectorySize,
  recoverLocalDatabase
} from "./local-data-manager";
import { DesktopAuthManager } from "./desktop-auth-manager";
import {
  DesktopAnalytics,
  resolveRuntimeAnalyticsConfig
} from "./desktop-analytics";
import { DesktopPreferenceStore } from "./desktop-preference-store";
import {
  DeviceCredentialStore,
  type DeviceAccount,
  type DeviceCredentialPayload
} from "./device-credential-store";
import { DeviceSkillSigner } from "./device-skill-signer";
import {
  buildStoredChatHistory,
  isProjectChatAuthenticationError,
  ProjectChatClient
} from "./project-chat-client";
import { ModelProviderStore } from "./model-provider-store";
import { LocalApiGateway } from "./local-api-gateway";
import { DesktopUsageStore } from "./desktop-usage-store";
import { RouteMarketApiClient } from "./routemarket-api-client";
import { MarketplaceCatalogClient } from "./marketplace-catalog-client";
import { MARKETPLACE_PUBLISHER_KEYS } from "./marketplace-publisher-keys";
import {
  loadDevelopmentMarketplaceFixture,
  mergeDevelopmentMarketplaceCatalog,
  type DevelopmentMarketplaceFixture
} from "./development-marketplace-fixture";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";
import { ProjectPdfService } from "./project-pdf-service";
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
import { LocalTriggerManager, type LocalTriggerEvent } from "./local-trigger-manager";
import { NativeAppConnectorManager } from "./native-app-connector-manager";
import { createLocalWorkflowNodeExecutor } from "./local-workflow-node-executor";
import { LocalWorkflowRuntime } from "./local-workflow-runtime";
import { WorkflowDraftStore } from "./workflow-draft-store";
import { WorkflowRunStore } from "./workflow-run-store";
import { workflowArtifactPath } from "./workflow-artifact";
import { WorkerClient } from "./worker-client";
import { DESKTOP_APP_ID, desktopWindowIconPath } from "./desktop-brand";
import { resolveRuntimeEndpoint } from "./runtime-endpoints";
import { DesktopUpdateManager } from "./desktop-update-manager";
import { DesktopExtensionHost } from "./desktop-extension-host";
import { LocalAssetService } from "./local-asset-service";
import { PluginMediaCapabilityService } from "./plugin-media-capability-service";
import { AgentCatalogStore } from "./agent-catalog-store";
import { loadAuthenticatedCatalog } from "./authenticated-catalog";
import { DataScopeIndex } from "./data-scope-index";
import { setMainLocale } from "./i18n";
import {
  markLegacyRouteMarketDataImported,
  migrateLegacyRouteMarketDeviceData,
  migrateLegacyRouteMarketData,
  migrateUnscopedRouteMarketData,
  routeMarketDataPaths,
  routeMarketDataScopePaths
} from "./route-market-data-paths";
import {
  MAX_CHAT_ATTACHMENTS,
  releaseChatAttachment,
  uploadSelectedChatAttachments,
  uploadTransferredChatAttachments
} from "./chat-attachment-service";

declare const __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__:
  "development" | "test" | "production";
declare const __ROUTEMARKET_WORK_BUILD_ID__: string | null;
declare const __ROUTEMARKET_WORK_DEFAULT_UPDATE_URL__: string | null;
declare const __ROUTEMARKET_WORK_DEFAULT_API_URL__: string;
declare const __ROUTEMARKET_WORK_DEFAULT_WEB_URL__: string;
declare const __ROUTEMARKET_WORK_ANALYTICS_CONFIG__: import("../../build-endpoints").DesktopAnalyticsBuildConfig | null;

const PROTOCOL = "routemarket-work";
const API_BASE_URL = resolveRuntimeEndpoint({
  defaultUrl: __ROUTEMARKET_WORK_DEFAULT_API_URL__,
  overrideUrl: process.env.ROUTEMARKET_WORK_API_URL,
  buildEnvironment: __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__,
  name: "ROUTEMARKET_WORK_API_URL"
});
const WEB_BASE_URL = resolveRuntimeEndpoint({
  defaultUrl: __ROUTEMARKET_WORK_DEFAULT_WEB_URL__,
  overrideUrl: process.env.ROUTEMARKET_WORK_WEB_URL,
  buildEnvironment: __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__,
  name: "ROUTEMARKET_WORK_WEB_URL"
});

let mainWindow: BrowserWindow | null = null;
let desktopAnalytics: DesktopAnalytics | null = null;
let workbenchRestoreBounds: Rectangle | null = null;
let workerClient: WorkerClient | null = null;
let deviceSkillSigner: DeviceSkillSigner | null = null;
let cloudWorkerClient: CloudWorkerClient | null = null;
let desktopAuthManager: DesktopAuthManager | null = null;
let desktopPreferenceStore: DesktopPreferenceStore | null = null;
let accountSyncTimer: NodeJS.Timeout | null = null;
let projectChatClient: ProjectChatClient | null = null;
let projectChatToolRunner: ProjectChatToolRunner | null = null;
let modelProviderStore: ModelProviderStore | null = null;
let localApiGateway: LocalApiGateway | null = null;
let desktopUsageStore: DesktopUsageStore | null = null;
let routeMarketApiClient: RouteMarketApiClient | null = null;
let marketplaceCatalogClient: MarketplaceCatalogClient | null = null;
let marketplacePluginInstaller: MarketplacePluginInstaller | null = null;
let desktopExtensionHost: DesktopExtensionHost | null = null;
let localAssetService: LocalAssetService | null = null;
let pluginMediaCapabilityService: PluginMediaCapabilityService | null = null;
let developmentMarketplaceFixture: DevelopmentMarketplaceFixture | null = null;
const preparedMarketplacePluginInstalls = new Map<string,
  | { kind: "marketplace"; archive: Buffer; release: MarketplacePluginRelease; expiresAt: number }
  | { kind: "local"; sourcePath: string; integrity: string; expiresAt: number }
>();
const MARKETPLACE_INSTALL_PREVIEW_TTL_MS = 10 * 60_000;
let approvalStore: ApprovalStore | null = null;
let activityStore: ActivityStore | null = null;
let localChatStore: LocalChatStore | null = null;
let agentCatalogStore: AgentCatalogStore | null = null;
const activeLocalChats = new Map<string, {
  sessionId: string;
  localProjectId: string | null;
  sentAt: string;
  agentId?: string;
  agentRevision?: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
  reasoning: string;
  artifacts: import("../shared/desktop-api").ProjectChatArtifact[];
  tools: import("../shared/desktop-api").ProjectChatToolActivity[];
  responseMeta?: import("../shared/desktop-api").ProjectChatResponseMeta;
}>();
const selectedChatAttachments = new Map<string, DesktopChatAttachment>();
let managedBrowser: ManagedBrowserManager | null = null;
let localTriggerManager: LocalTriggerManager | null = null;
let workflowDraftStore: WorkflowDraftStore | null = null;
let workflowRunStore: WorkflowRunStore | null = null;
let localWorkflowRuntime: LocalWorkflowRuntime | null = null;
let localDataPath: string | null = null;
let activeDataScopeId: string | null = null;
let activeDataScopeContext: {
  scope: "guest" | "account-space";
  accountName: string | null;
  spaceName: string | null;
  accountsRoot: string;
} | null = null;
let dataScopeIndex: DataScopeIndex | null = null;
let routeMarketAccountsRoot: string | null = null;
let dataScopeSwitching = false;
let switchDataScopeRuntime: ((account: DeviceAccount) => Promise<void>) | null = null;
let desktopUpdateManager: DesktopUpdateManager | null = null;
let quitAttachmentCleanupStarted = false;
let quitAttachmentCleanupComplete = false;
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
      title: trMain("ui.e19562c2050e"),
      message: request.title,
      detail: trMain("ui.843aa9dbfa08", [request.detail, request.capability, request.risk, request.projectId ? trMain("ui.3668cf84970f") : ""]),
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
      ? trMain("ui.202a0d881a3a")
      : decision === "approved"
        ? trMain("ui.37b028639232")
        : trMain("ui.540b4fb39ba7");
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
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin" ? {} : {
      titleBarOverlay: {
        color: "rgba(0, 0, 0, 0)",
        symbolColor: "#566078",
        height: 36
      }
    }),
    icon: desktopWindowIconPath(__dirname),
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setZoomFactor(desktopPreferenceStore?.get().zoomFactor ?? 1.1);
  mainWindow.setMenuBarVisibility(false);
  managedBrowser = new ManagedBrowserManager(mainWindow, {
    dataScopeId: activeDataScopeId ?? "guest",
    onPersistentPartition: (partition) => {
      if (activeDataScopeId) {
        void dataScopeIndex?.addBrowserPartition(activeDataScopeId, partition);
      }
    },
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
    workbenchRestoreBounds = null;
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
    title: trMain("ui.b0454170b83e"),
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
    title: redactCloudText(title).slice(0, 512),
    detail: redactCloudText(detail).slice(0, 8_192),
    occurredAt: new Date().toISOString()
  };
  if (activityStore) activityStore.append(item);
  else transientActivities.unshift(item);
}

let reportingMainProcessError = false;

function reportMainProcessError(kind: "uncaught exception" | "unhandled rejection", error: unknown): void {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "An unexpected main-process error occurred.";
  console.error(`RouteMarket Work contained an ${kind}.`, error);
  if (reportingMainProcessError) return;
  reportingMainProcessError = true;
  try {
    addActivity("job.failed", "Application error contained", message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("work:runtime-error", message);
    }
  } finally {
    reportingMainProcessError = false;
  }
}

process.on("uncaughtException", (error) => reportMainProcessError("uncaught exception", error));
process.on("unhandledRejection", (error) => reportMainProcessError("unhandled rejection", error));

async function listDownloadableCloudSkills(): Promise<DownloadableCloudSkill[]> {
  if (!routeMarketApiClient) throw new Error("RouteMarket API is unavailable.");
  const response = await routeMarketApiClient.request(
    "/api/app/v1/skills",
    {},
    "required"
  );
  if (!response.ok) {
    throw new Error(trMain("ui.5312a906b70d"));
  }
  const payload = await response.json() as { items?: unknown };
  if (!Array.isArray(payload.items) || payload.items.length > 500) {
    throw new Error(trMain("ui.0e4e7ef576a2"));
  }
  return payload.items.flatMap((value): DownloadableCloudSkill[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const manifest = item.manifest && typeof item.manifest === "object" &&
      !Array.isArray(item.manifest)
      ? item.manifest as Record<string, unknown>
      : {};
    if (
      item.status !== "active" ||
      typeof item.skillId !== "string" ||
      typeof item.version !== "string" ||
      typeof item.activeVersionId !== "string" ||
      typeof manifest.name !== "string" ||
      typeof manifest.description !== "string" ||
      item.skillId.length > 200 ||
      item.version.length > 80 ||
      item.activeVersionId.length > 100
    ) {
      return [];
    }
    return [{
      skillId: item.skillId,
      version: item.version,
      versionId: item.activeVersionId,
      name: manifest.name.slice(0, 128),
      description: manifest.description.slice(0, 512)
    }];
  });
}

async function installCloudSkillPackage(
  localProjectId: string,
  skillId: string,
  versionId: string
) {
  if (!routeMarketApiClient || !workerClient || !localDataPath) {
    throw new Error("RouteMarket local Skill service is unavailable.");
  }
  if (
    !/^[a-z0-9][a-z0-9._-]{0,199}$/.test(skillId) ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(versionId)
  ) {
    throw new Error("Skill identity is invalid.");
  }
  const response = await routeMarketApiClient.request(
    `/api/app/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/desktop-package`,
    {},
    "required"
  );
  if (!response.ok) throw new Error(trMain("ui.4727a4e8cd08"));
  const payload = await response.json() as Record<string, unknown>;
  const fileName = typeof payload.fileName === "string" ? payload.fileName : "";
  const checksum = typeof payload.checksum === "string" ? payload.checksum : "";
  const bytesBase64 = typeof payload.bytesBase64 === "string"
    ? payload.bytesBase64
    : "";
  if (
    !/^[a-z0-9._-]{1,220}\.zip$/i.test(fileName) ||
    !/^sha256:[a-f0-9]{64}$/.test(checksum) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(bytesBase64) ||
    bytesBase64.length > 7_000_000
  ) {
    throw new Error(trMain("ui.8511d5713031"));
  }
  const bytes = Buffer.from(bytesBase64, "base64");
  if (
    !bytes.length ||
    bytes.length > 5 * 1024 * 1024 ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== checksum
  ) {
    throw new Error(trMain("ui.1f76dc91d369"));
  }
  const downloadDirectory = join(localDataPath, "skill-downloads");
  await mkdir(downloadDirectory, { recursive: true });
  const temporaryPath = join(
    downloadDirectory,
    `${randomUUID().replaceAll("-", "")}.zip`
  );
  await writeFile(temporaryPath, bytes, { mode: 0o600 });
  try {
    return await workerClient.installProjectSkillArchive(
      localProjectId,
      temporaryPath,
      fileName,
      "web_library"
    );
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
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
  if (job.executorKey === "local.fs.read") {
    return client.executeJob(job, leaseId, leaseEpoch);
  }
  const signedSkillIdentity = job.executorKey === "local.skill.invoke"
    ? deviceSkillSigner?.assertAuthorizedJob(job)
    : null;
  if (job.executorKey === "local.skill.invoke" && !signedSkillIdentity) {
    throw Object.assign(new Error("Local Skill signing identity is unavailable."), {
      code: "PROJECT_SKILL_IDENTITY_UNAUTHORIZED"
    });
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
    const localSkillReceipt = job.executorKey === "local.skill.invoke"
      ? (await client.listProjectSkillReceipts(project.localProjectId)).find(
          (receipt) => receipt.skillId === job.input.skillId
        ) ?? null
      : null;
    const result = await toolBroker.run(
      {
        capability: job.executorKey,
        risk: job.approvalPolicy.risk,
        title: externalJobTitle(job, project.displayName),
        detail: externalJobDetail(job, signedSkillIdentity, localSkillReceipt),
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
  if (job.executorKey === "local.skill.invoke") {
    return workerClient!.invokeAuthorizedProjectSkill(job);
  }
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
  { executorKey: "local.fs.read" }
>;

function externalJobTitle(job: ExternalDesktopJob, projectName?: string): string {
  if (job.executorKey === "local.skill.invoke") {
    return trMain("ui.dbc079b1c210", [projectName ?? trMain("ui.afd8d88fa102"), job.input.skillId]);
  }
  if (job.executorKey === "local.mcp.call") return trMain("ui.4566f3aab1cd", [job.input.name]);
  if (job.executorKey === "local.app.open") return trMain("ui.be014e68b762", [job.input.connectorId]);
  return trMain("ui.98f8703168fd", [job.executorKey]);
}

function externalJobDetail(
  job: ExternalDesktopJob,
  signedIdentity?: LocalSkillIdentity | null,
  receipt?: LocalSkillInstallReceipt | null
): string {
  if (job.executorKey === "local.skill.invoke") {
    const source = receipt?.source === "web_library"
      ? trMain("ui.9911e0b282f5", [receipt.sourceLabel])
      : receipt?.source === "local_archive"
        ? trMain("ui.eb6fd5bbdea6", [receipt.sourceLabel])
        : trMain("ui.6e6f05f81646");
    const permissions = signedIdentity?.permissions
      .map((permission) => permission === "project.read" ? trMain("ui.1a8deee99601") : permission)
      .join("、") || trMain("ui.6cad9198f25d");
    return [
      `${job.input.skillId}@${job.input.version}`,
      source,
      trMain("ui.58b7ce931872", [permissions]),
      trMain("ui.902a0920e455", [job.input.operation])
    ].join(" · ");
  }
  if (job.executorKey === "local.browser.navigate") return job.input.url;
  if (job.executorKey === "local.browser.screenshot") return trMain("ui.f39eafbc38aa");
  if (job.executorKey === "local.browser.upload") {
    return `${job.input.selector} / ${job.input.relativePaths.length} files`;
  }
  if (job.executorKey === "local.mcp.call") return `${job.input.serverId} · ${job.input.name}`;
  if (job.executorKey === "local.app.open") return `${job.input.connectorId} · ${job.input.relativePath ?? "."}`;
  return job.input.selector;
}

function externalJobAuditTarget(job: ExternalDesktopJob): string {
  if (job.executorKey === "local.skill.invoke") {
    return `${job.input.skillId}@${job.input.version}/${job.input.packageDigest.slice(0, 19)}`;
  }
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
      description: trMain("ui.86ee31205161", [action.nodeCount, action.edgeCount]),
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

function getAuthenticatedRouteMarketApiClient(): RouteMarketApiClient {
  if (!routeMarketApiClient) {
    throw new Error("RouteMarket API is unavailable.");
  }
  const accessToken = desktopAuthManager?.getAccessToken();
  if (!accessToken) {
    throw new Error(trMain("ui.14b469c15fbf"));
  }
  routeMarketApiClient.setAccessToken(accessToken);
  return routeMarketApiClient;
}

async function releaseTrackedChatAttachment(
  attachment: DesktopChatAttachment
): Promise<void> {
  const apiClient = getAuthenticatedRouteMarketApiClient();
  await releaseChatAttachment(apiClient, attachment);
  selectedChatAttachments.delete(attachment.id);
}

async function releaseAllTrackedChatAttachments(): Promise<void> {
  const attachments = [...selectedChatAttachments.values()];
  if (!attachments.length) return;
  const results = await Promise.allSettled(
    attachments.map((attachment) => releaseTrackedChatAttachment(attachment))
  );
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result?.status !== "rejected") continue;
    const attachment = attachments[index];
    console.warn("Could not release a pending desktop chat attachment.", {
      attachmentId: attachment?.id,
      error: result.reason
    });
  }
}

function createScopedLocalTriggerManager(workDataPath: string): LocalTriggerManager {
  return new LocalTriggerManager(
    join(workDataPath, "work.db"),
    (localProjectId) => workerClient!.projectRoot(localProjectId),
    handleLocalTriggerEvent,
    {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    }
  );
}

async function handleLocalTriggerEvent({
  trigger,
  reason,
  relativePath,
  occurredAt
}: LocalTriggerEvent): Promise<void> {
  addActivity(
    "trigger.fired",
    trMain("ui.6d748eb7307b", [trigger.name]),
    [reason, relativePath].filter(Boolean).join(" 路 ")
  );
  mainWindow?.webContents.send("work:local-trigger-fired", {
    triggerId: trigger.triggerId,
    localProjectId: trigger.localProjectId,
    reason,
    relativePath
  });
  if (!trigger.workflowId) return;
  if (!localWorkflowRuntime) {
    throw new Error("Local Workflow runtime is unavailable.");
  }
  const unfinished = localWorkflowRuntime
    .list(trigger.localProjectId, trigger.workflowId)
    .find((run) =>
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting_for_user"
    );
  if (unfinished) {
    addActivity(
      "job.attention",
      `Scheduled Workflow skipped: ${unfinished.workflowName}`,
      unfinished.status === "waiting_for_user"
        ? unfinished.error ?? unfinished.runId
        : `Previous run is ${unfinished.status}.`
    );
    return;
  }
  localWorkflowRuntime.run(trigger.localProjectId, trigger.workflowId, {
    $trigger: {
      triggerId: trigger.triggerId,
      reason,
      relativePath,
      occurredAt
    }
  });
}

function createScopedLocalWorkflowRuntime(apiClient: RouteMarketApiClient): LocalWorkflowRuntime {
  if (!workflowDraftStore || !workflowRunStore || !workerClient) {
    throw new Error("RouteMarket local workflow storage is unavailable.");
  }
  return new LocalWorkflowRuntime(
    workflowDraftStore,
    workflowRunStore,
    createLocalWorkflowNodeExecutor({
      cloudWorkflowClient: new CloudWorkflowClient({ apiClient }),
      workerClient,
      toolBroker,
      getBrowser: requireBrowser,
      nativeAppConnectors
    }),
    handleLocalWorkflowRunEvent
  );
}

function handleLocalWorkflowRunEvent(event: DesktopWorkflowRunEvent): void {
  mainWindow?.webContents.send("work:workflow-run-event", event);
  if (event.run.status === "succeeded") {
    addActivity(
      "job.succeeded",
      `Workflow completed: ${event.run.workflowName}`,
      event.run.runId
    );
  } else if (event.run.status === "waiting_for_user") {
    addActivity(
      "job.attention",
      trMain("ui.11f9f72e1666", [event.run.workflowName]),
      event.run.error ?? event.run.runId
    );
    mainWindow?.flashFrame(true);
    mainWindow?.once("focus", () => mainWindow?.flashFrame(false));
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: trMain("ui.de4a5669ada9"),
        body: event.run.error ?? trMain("ui.1b8fc3a5c520")
      });
      notification.on("click", () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    }
  } else if (event.run.status === "failed" || event.run.status === "canceled") {
    addActivity(
      "job.failed",
      `Workflow ${event.run.status}: ${event.run.workflowName}`,
      event.run.error ?? event.run.runId
    );
  }
}

function createScopedProjectChatRuntime(apiClient: RouteMarketApiClient): void {
  if (!workerClient) throw new Error("RouteMarket Worker is offline.");
  projectChatToolRunner = new ProjectChatToolRunner({
    workerClient,
    toolBroker,
    getBrowser: () => requireBrowser(),
    getAttachedBrowser: () => attachedBrowser,
    mcpClient: workerClient,
    skillClient: workerClient,
    pdfClient: {
      createProjectPdf: (input) => new ProjectPdfService(
        (localProjectId) => workerClient!.projectRoot(localProjectId)
      ).create(input)
    },
    onActivity: addActivity
  });
  projectChatClient = new ProjectChatClient({
    apiClient,
    agentCache: agentCatalogStore ?? undefined,
    modelProviderStore: modelProviderStore ?? undefined,
    recordUsage: (record) => desktopUsageStore?.record(record) ?? Promise.resolve(),
    onEvent: handleProjectChatEvent,
    toolRunner: projectChatToolRunner
  });
}

function handleProjectChatEvent(event: ProjectChatEvent): void {
  const active = activeLocalChats.get(event.requestId);
  if (active && event.type === "artifacts") {
    const byPath = new Map(active.artifacts.map((artifact) => [artifact.relativePath, artifact]));
    for (const artifact of event.artifacts) byPath.set(artifact.relativePath, artifact);
    active.artifacts = [...byPath.values()];
  }
  if (active && event.type === "reasoning") {
    active.reasoning = event.content;
  }
  if (active && (event.type === "tool_started" || event.type === "tool_completed" || event.type === "tool_error")) {
    const status = event.type === "tool_started" ? "running" : event.type === "tool_completed" ? "completed" : "error";
    const detail = event.type === "tool_started" ? undefined : event.type === "tool_completed" ? event.summary : event.message;
    const existing = active.tools.find((tool) => tool.toolCallId === event.toolCallId);
    const next = {
      ...existing,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      title: event.title,
      status,
      ...(event.type === "tool_started" ? {
        startedAt: event.startedAt,
        ...(event.inputPreview ? { inputPreview: event.inputPreview } : {})
      } : {
        endedAt: event.endedAt,
        ...(event.outputPreview ? { outputPreview: event.outputPreview } : {})
      }),
      ...(detail ? { detail } : {})
    } satisfies import("../shared/desktop-api").ProjectChatToolActivity;
    const index = active.tools.findIndex((tool) => tool.toolCallId === event.toolCallId);
    if (index >= 0) active.tools[index] = next;
    else active.tools.push(next);
  }
  if (active && (event.type === "complete" || event.type === "stopped" || event.type === "error")) {
    localChatStore?.append({
      id: `assistant:${event.requestId}`,
      sessionId: active.sessionId,
      localProjectId: active.localProjectId,
      role: "assistant",
      content: event.type === "error" ? event.content || event.message : event.content,
      ...(active.reasoning ? { reasoning: active.reasoning } : {}),
      sentAt: active.sentAt,
      ...(active.artifacts.length ? { artifacts: active.artifacts } : {}),
      ...(active.tools.length ? { tools: active.tools } : {}),
      ...(event.type === "complete" ? { responseMeta: event.responseMeta } : {}),
      ...(event.type === "stopped" ? { stopped: true } : {}),
      ...(event.type === "error" ? { failed: true } : {}),
      ...(active.agentId ? { agentId: active.agentId } : {}),
      ...(active.agentRevision ? { agentRevision: active.agentRevision } : {}),
      ...(active.agentName ? { agentName: active.agentName } : {}),
      ...("agentAvatarUrl" in active ? { agentAvatarUrl: active.agentAvatarUrl } : {})
    });
    activeLocalChats.delete(event.requestId);
  }
  mainWindow?.webContents.send("work:project-chat-event", event);
}

async function refreshMarketplacePluginActivation(): Promise<void> {
  if (!marketplacePluginInstaller || !projectChatToolRunner) return;
  const packages = await marketplacePluginInstaller.listEnabledPackages();
  projectChatToolRunner.setMarketplacePluginManifests(packages.map((item) => item.manifest));
  await desktopExtensionHost?.refresh(packages);
}

async function handleAuthenticatedCatalogFailure(error: unknown): Promise<boolean> {
  if (!isProjectChatAuthenticationError(error)) return false;
  await desktopAuthManager?.syncAccount();
  return true;
}

async function listMarketplaceCatalogForDesktop(): Promise<MarketplaceCatalogResponse> {
  if (!marketplaceCatalogClient) throw new Error("RouteMarket Marketplace is unavailable.");
  let catalog: MarketplaceCatalogResponse | null = null;
  try {
    catalog = await marketplaceCatalogClient.list();
  } catch (error) {
    if (!developmentMarketplaceFixture) throw error;
  }
  return developmentMarketplaceFixture
    ? mergeDevelopmentMarketplaceCatalog(catalog, developmentMarketplaceFixture)
    : catalog!;
}

function registerIpc(): void {
  ipcMain.on("work:analytics-track", (_event, event: DesktopAnalyticsEvent) => {
    void desktopAnalytics?.track(event);
  });
  ipcMain.handle("work:execute-menu-command", async (_event, command: DesktopMenuCommand) => {
    const window = mainWindow;
    const contents = window?.webContents;
    if (!window || !contents) return;
    switch (command) {
      case "undo": contents.undo(); break;
      case "redo": contents.redo(); break;
      case "cut": contents.cut(); break;
      case "copy": contents.copy(); break;
      case "paste": contents.paste(); break;
      case "delete": contents.delete(); break;
      case "selectAll": contents.selectAll(); break;
      case "zoomIn": {
        const zoomFactor = Math.round(Math.min(3, contents.getZoomFactor() + 0.1) * 10) / 10;
        contents.setZoomFactor(zoomFactor);
        await desktopPreferenceStore?.update({ zoomFactor });
        break;
      }
      case "zoomOut": {
        const zoomFactor = Math.round(Math.max(0.5, contents.getZoomFactor() - 0.1) * 10) / 10;
        contents.setZoomFactor(zoomFactor);
        await desktopPreferenceStore?.update({ zoomFactor });
        break;
      }
      case "resetZoom":
        contents.setZoomFactor(1);
        await desktopPreferenceStore?.update({ zoomFactor: 1 });
        break;
      case "toggleFullScreen": window.setFullScreen(!window.isFullScreen()); break;
      case "closeWindow": window.close(); break;
      case "quit": app.quit(); break;
      case "openDocumentation": await shell.openExternal("https://routemarket.ai"); break;
      case "openMarketplace": await shell.openExternal(new URL("/marketplace", WEB_BASE_URL).toString()); break;
      case "openAgentBuilder": await shell.openExternal(new URL("/app/agents", WEB_BASE_URL).toString()); break;
      case "openAccountCenter": await shell.openExternal(routeMarketAccountUrl(WEB_BASE_URL, "account_center")); break;
      case "openPlanUpgrade": await shell.openExternal(routeMarketAccountUrl(WEB_BASE_URL, "plan_upgrade")); break;
      case "openCreditsTopUp": await shell.openExternal(routeMarketAccountUrl(WEB_BASE_URL, "credits_top_up")); break;
      case "openCreditsUsage": await shell.openExternal(routeMarketAccountUrl(WEB_BASE_URL, "credits_usage")); break;
      case "showAbout":
        await dialog.showMessageBox(window, {
          type: "info",
          title: "RouteMarket Work",
          message: "RouteMarket Work",
          detail: `Version ${app.getVersion()}`,
          buttons: ["OK"]
        });
        break;
    }
  });

  ipcMain.handle("work:set-titlebar-theme", (_event, theme: "light" | "dark") => {
    if (process.platform === "darwin" || !mainWindow) return;
    mainWindow.setTitleBarOverlay({
      color: "rgba(0, 0, 0, 0)",
      symbolColor: theme === "dark" ? "#d7dce7" : "#566078",
      height: 36
    });
  });

  ipcMain.handle("work:get-preferences", (): DesktopPreferences => {
    return desktopPreferenceStore?.get() ?? {};
  });
  ipcMain.handle("work:update-preferences", async (_event, patch: DesktopPreferences) => {
    if (!desktopPreferenceStore) throw new Error("Desktop preferences are not ready.");
    const preferences = await desktopPreferenceStore.update(patch);
    if (patch.zoomFactor !== undefined && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(preferences.zoomFactor ?? 1);
    }
    return preferences;
  });
  ipcMain.handle("work:set-locale", (_event, locale: import("../shared/desktop-api").DesktopLocale) => {
    setMainLocale(locale);
  });
  ipcMain.handle(
    "work:set-workbench-expanded",
    (_event, expanded: boolean, preferredPanelWidth = 680): { expanded: boolean; addedWidth: number } => {
      const window = mainWindow;
      if (!window || window.isDestroyed()) {
        return { expanded: false, addedWidth: 0 };
      }
      if (!expanded) {
        const restoreBounds = workbenchRestoreBounds;
        workbenchRestoreBounds = null;
        if (restoreBounds && !window.isMaximized() && !window.isFullScreen()) {
          window.setBounds(restoreBounds, true);
        }
        return { expanded: false, addedWidth: 0 };
      }
      if (window.isMaximized() || window.isFullScreen()) {
        return { expanded: false, addedWidth: 0 };
      }
      if (expanded) {
        if (workbenchRestoreBounds) {
          return {
            expanded: true,
            addedWidth: Math.max(0, window.getBounds().width - workbenchRestoreBounds.width)
          };
        }
        const current = window.getBounds();
        const workArea = screen.getDisplayMatching(current).workArea;
        const requestedWidth = Math.max(420, Math.min(880, Math.round(preferredPanelWidth)));
        const availableRight = Math.max(0, workArea.x + workArea.width - (current.x + current.width));
        const availableLeft = Math.max(0, current.x - workArea.x);
        const addedRight = Math.min(requestedWidth, availableRight);
        const addedLeft = Math.min(requestedWidth - addedRight, availableLeft);
        const addedWidth = addedRight + addedLeft;
        if (addedWidth === 0) return { expanded: false, addedWidth: 0 };
        workbenchRestoreBounds = current;
        window.setBounds({
          x: current.x - addedLeft,
          y: current.y,
          width: current.width + addedWidth,
          height: current.height
        }, true);
        return { expanded: true, addedWidth };
      }
      return { expanded: false, addedWidth: 0 };
    }
  );
  ipcMain.handle("work:get-state", getWorkState);

  ipcMain.handle("work:get-app-info", () => {
    const updateInfo = desktopUpdateManager?.getInfo() ?? {
      enabled: false,
      channel: "stable" as const
    };
    return {
      version: app.getVersion(),
      buildEnvironment: __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__,
      updateEnabled: updateInfo.enabled,
      updateChannel: updateInfo.channel
    };
  });

  ipcMain.handle("work:check-for-updates", async () => {
    return desktopUpdateManager?.checkNow() ?? false;
  });

  ipcMain.handle("work:get-update-state", () => {
    return desktopUpdateManager?.getState() ?? {
      status: "idle",
      version: null,
      percent: null,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      error: null
    };
  });

  ipcMain.handle("work:download-update", async () => {
    return desktopUpdateManager?.downloadUpdate() ?? false;
  });

  ipcMain.handle("work:install-update", () => {
    return desktopUpdateManager?.installUpdate() ?? false;
  });

  ipcMain.handle("work:marketplace-catalog", async () => {
    return listMarketplaceCatalogForDesktop();
  });
  ipcMain.handle("work:desktop-extensions-list", async () => {
    if (!desktopExtensionHost) return [];
    return desktopExtensionHost.list();
  });
  ipcMain.handle("work:desktop-extensions-refresh", async () => {
    if (!desktopExtensionHost) return [];
    const packages = marketplacePluginInstaller
      ? await marketplacePluginInstaller.listEnabledPackages()
      : [];
    return desktopExtensionHost.refresh(packages);
  });
  ipcMain.handle("work:desktop-extension-open-page", async (_event, pluginId: string, pageId: string) => {
    if (!desktopExtensionHost) throw new Error("Desktop extension host is unavailable.");
    if (marketplacePluginInstaller) {
      const packages = await marketplacePluginInstaller.listEnabledPackages();
      await desktopExtensionHost.refresh(packages);
    }
    return desktopExtensionHost.openPage(pluginId, pageId);
  });
  ipcMain.handle(
    "work:desktop-extension-pick-file",
    async (_event, pluginId: string, request: DesktopExtensionFilePickRequest) => {
      if (!mainWindow || !desktopExtensionHost) {
        throw new Error("Desktop extension file picker is unavailable.");
      }
      if (!request || typeof request !== "object") throw new Error("Desktop extension picker request is invalid.");
      const purposes = {
        "data-input": { permission: "data.read", directory: false, fallbackTitle: "选择数据文件" },
        "media-input": { permission: "media.read", directory: false, fallbackTitle: "选择媒体文件" },
        "media-output-directory": { permission: "media.write", directory: true, fallbackTitle: "选择输出目录" },
        "model-directory": { permission: "models.manage", directory: true, fallbackTitle: "选择模型目录" },
        "runtime-executable": { permission: "process", directory: false, fallbackTitle: "选择运行程序" },
        "runtime-directory": { permission: "process", directory: true, fallbackTitle: "选择运行目录" }
      } as const;
      const policy = purposes[request.purpose];
      if (!policy) throw new Error("Desktop extension picker purpose is invalid.");
      const extension = desktopExtensionHost.assertPermission(pluginId, policy.permission);
      const title = typeof request.title === "string" && request.title.trim()
        ? request.title.trim().slice(0, 120)
        : `${extension.name} · ${policy.fallbackTitle}`;
      const extensions = Array.isArray(request.extensions)
        ? request.extensions
            .filter((value): value is string => typeof value === "string" && /^[A-Za-z0-9]{1,12}$/.test(value))
            .slice(0, 24)
        : [];
      const selection = await dialog.showOpenDialog(mainWindow, {
        title,
        properties: [policy.directory ? "openDirectory" : "openFile"],
        ...(!policy.directory && extensions.length
          ? { filters: [{ name: "Supported files", extensions }] }
          : {})
      });
      return {
        canceled: selection.canceled || !selection.filePaths[0],
        path: selection.canceled ? null : selection.filePaths[0] ?? null
      };
    }
  );

  ipcMain.handle("work:marketplace-plugin-installations", async () => {
    if (!marketplacePluginInstaller) throw new Error("RouteMarket Marketplace is unavailable.");
    return marketplacePluginInstaller.list();
  });

  ipcMain.handle("work:marketplace-plugin-prepare", async (_event, pluginId: string) => {
    if (!marketplaceCatalogClient || !marketplacePluginInstaller) {
      throw new Error("RouteMarket Marketplace is unavailable.");
    }
    if (!/^[a-z0-9][a-z0-9.-]{2,127}$/.test(pluginId)) {
      throw new Error("Marketplace plugin ID is invalid.");
    }
    const catalog = await listMarketplaceCatalogForDesktop();
    const item = catalog.items.find((candidate) => candidate.id === pluginId);
    if (
      !item || item.kind !== "plugin" || item.status !== "available" ||
      item.acquisitionMode !== "install" || item.release.distributionSource !== "marketplace"
    ) {
      throw new Error("Marketplace plugin is not available for installation.");
    }
    const release: MarketplacePluginRelease = {
      pluginId: item.id,
      publisher: item.publisher,
      version: item.release.version,
      minimumHostVersion: item.release.minimumHostVersion,
      integrity: item.release.integrity,
      signature: item.release.signature
    };
    // Verify the pinned publisher signature before making a package request.
    marketplacePluginInstaller.assertTrustedRelease(release);
    const archive = developmentMarketplaceFixture?.item.id === item.id
      ? await readFile(developmentMarketplaceFixture.packagePath)
      : await marketplaceCatalogClient.downloadPluginPackage(item);
    const manifest = await marketplacePluginInstaller.inspectArchive(archive, release);
    const now = Date.now();
    for (const [token, prepared] of preparedMarketplacePluginInstalls) {
      if (prepared.expiresAt <= now) preparedMarketplacePluginInstalls.delete(token);
    }
    if (preparedMarketplacePluginInstalls.size >= 5) {
      throw new Error("Too many plugin installations are awaiting confirmation.");
    }
    const installToken = randomUUID();
    preparedMarketplacePluginInstalls.set(installToken, {
      kind: "marketplace",
      archive,
      release,
      expiresAt: now + MARKETPLACE_INSTALL_PREVIEW_TTL_MS
    });
    return {
      installToken,
      source: "marketplace",
      pluginId: manifest.id,
      name: manifest.name,
      description: manifest.description,
      publisher: manifest.publisher,
      version: manifest.version,
      permissions: [...manifest.permissions],
      tools: manifest.contributes.tools.map(({ name, title, risk }) => ({ name, title, risk })),
      viewers: manifest.contributes.viewers.map(({ id, title, mode }) => ({ id, title, mode })),
      workflowNodes: manifest.contributes.workflowNodes.map(({ executorKey, title }) => ({ executorKey, title })),
      connectors: manifest.contributes.connectors.map(({ id, title, kind }) => ({ id, title, kind })),
      navigation: (manifest.contributes.navigation ?? []).map(({ id, title, pageId }) => ({ id, title, pageId })),
      pages: (manifest.contributes.pages ?? []).map(({ id, title }) => ({ id, title })),
      models: (manifest.resources?.models ?? []).map(({ id, title, kind, required }) => ({ id, title, kind, required }))
    };
  });

  ipcMain.handle("work:local-plugin-prepare", async () => {
    if (!mainWindow || !marketplacePluginInstaller) {
      throw new Error("RouteMarket plugin installer is unavailable.");
    }
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "选择本地插件目录",
      buttonLabel: "检查插件",
      properties: ["openDirectory"]
    });
    const sourcePath = selection.filePaths[0];
    if (selection.canceled || !sourcePath) return null;
    const inspected = await marketplacePluginInstaller.inspectLocalDirectory(sourcePath);
    const { manifest } = inspected;
    const now = Date.now();
    for (const [token, prepared] of preparedMarketplacePluginInstalls) {
      if (prepared.expiresAt <= now) preparedMarketplacePluginInstalls.delete(token);
    }
    if (preparedMarketplacePluginInstalls.size >= 5) {
      throw new Error("Too many plugin installations are awaiting confirmation.");
    }
    const installToken = randomUUID();
    preparedMarketplacePluginInstalls.set(installToken, {
      kind: "local",
      sourcePath,
      integrity: inspected.integrity,
      expiresAt: now + MARKETPLACE_INSTALL_PREVIEW_TTL_MS
    });
    return {
      installToken,
      source: "local",
      pluginId: manifest.id,
      name: manifest.name,
      description: manifest.description,
      publisher: manifest.publisher,
      version: manifest.version,
      permissions: [...manifest.permissions],
      tools: manifest.contributes.tools.map(({ name, title, risk }) => ({ name, title, risk })),
      viewers: manifest.contributes.viewers.map(({ id, title, mode }) => ({ id, title, mode })),
      workflowNodes: manifest.contributes.workflowNodes.map(({ executorKey, title }) => ({ executorKey, title })),
      connectors: manifest.contributes.connectors.map(({ id, title, kind }) => ({ id, title, kind })),
      navigation: (manifest.contributes.navigation ?? []).map(({ id, title, pageId }) => ({ id, title, pageId })),
      pages: (manifest.contributes.pages ?? []).map(({ id, title }) => ({ id, title })),
      models: (manifest.resources?.models ?? []).map(({ id, title, kind, required }) => ({ id, title, kind, required }))
    };
  });

  ipcMain.handle("work:marketplace-plugin-install", async (_event, installToken: string) => {
    if (!marketplacePluginInstaller || typeof installToken !== "string") {
      throw new Error("RouteMarket Marketplace is unavailable.");
    }
    const prepared = preparedMarketplacePluginInstalls.get(installToken);
    preparedMarketplacePluginInstalls.delete(installToken);
    if (!prepared || prepared.expiresAt <= Date.now()) {
      throw new Error("Plugin installation confirmation expired. Review the plugin again.");
    }
    const installation = prepared.kind === "marketplace"
      ? await marketplacePluginInstaller.installArchive(prepared.archive, prepared.release)
      : await marketplacePluginInstaller.installLocalDirectory(prepared.sourcePath, prepared.integrity);
    await refreshMarketplacePluginActivation();
    return installation;
  });

  ipcMain.handle("work:marketplace-plugin-cancel", (_event, installToken: string) => {
    if (typeof installToken !== "string") return false;
    return preparedMarketplacePluginInstalls.delete(installToken);
  });

  ipcMain.handle("work:marketplace-plugin-set-enabled", async (_event, pluginId: string, enabled: boolean) => {
    if (!marketplacePluginInstaller) throw new Error("RouteMarket Marketplace is unavailable.");
    if (typeof enabled !== "boolean") throw new Error("Plugin enabled state is invalid.");
    const installation = await marketplacePluginInstaller.setEnabled(pluginId, enabled);
    if (!installation) throw new Error("Marketplace plugin is not installed.");
    await refreshMarketplacePluginActivation();
    return installation;
  });

  ipcMain.handle("work:marketplace-plugin-remove", async (_event, pluginId: string) => {
    if (!marketplacePluginInstaller) throw new Error("RouteMarket Marketplace is unavailable.");
    await marketplacePluginInstaller.remove(pluginId);
    await refreshMarketplacePluginActivation();
    return true;
  });

  ipcMain.handle("work:local-data-info", async () => {
    if (!localDataPath || !activeDataScopeContext) {
      throw new Error(trMain("ui.3fc7f2bc30b2"));
    }
    return inspectLocalData(localDataPath, activeDataScopeContext);
  });

  ipcMain.handle("work:local-data-scopes-list", async () => {
    if (!dataScopeIndex || !routeMarketAccountsRoot) return [];
    const entries = await dataScopeIndex.list();
    return Promise.all(entries.map(async (entry) => ({
      scopeId: entry.scopeId,
      accountName: entry.accountName,
      spaceName: entry.spaceName,
      spaceKind: entry.spaceKind,
      lastUsedAt: entry.lastUsedAt,
      totalBytes: await localDataDirectorySize(join(
        routeMarketAccountsRoot!,
        entry.accountKey,
        "spaces",
        entry.spaceKey
      )),
      current: entry.scopeId === activeDataScopeId
    })));
  });

  ipcMain.handle("work:local-data-scope-remove", async (_event, scopeId: string) => {
    if (!dataScopeIndex || !routeMarketAccountsRoot) return false;
    if (!/^[a-f0-9]{24}$/.test(scopeId) || scopeId === activeDataScopeId) return false;
    const entry = (await dataScopeIndex.list()).find((item) => item.scopeId === scopeId);
    if (!entry) return false;
    const target = resolve(routeMarketAccountsRoot, entry.accountKey, "spaces", entry.spaceKey);
    const accountRoot = resolve(routeMarketAccountsRoot, entry.accountKey);
    const spacesRoot = resolve(accountRoot, "spaces");
    const relativeTarget = relative(resolve(routeMarketAccountsRoot), target);
    if (!relativeTarget || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) return false;
    const pathStats = await Promise.all([accountRoot, spacesRoot, target].map((path) =>
      lstat(path).catch(() => null)
    ));
    if (pathStats.some((value) => !value?.isDirectory() || value.isSymbolicLink())) return false;
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      title: trMain("settings.scopeRemoveDialog.title"),
      message: trMain("settings.scopeRemoveDialog.description", [entry.spaceName]),
      detail: trMain("settings.scopeRemoveDialog.note", [entry.accountName]),
      buttons: [trMain("settings.clearDialog.cancel"), trMain("settings.scopeRemoveDialog.confirm")],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return false;
    await Promise.all(entry.browserPartitions.map(async (partition) => {
      const browserSession = session.fromPartition(partition);
      await Promise.all([browserSession.clearCache(), browserSession.clearStorageData()]);
    }));
    await shell.trashItem(target);
    await dataScopeIndex.remove(scopeId);
    return true;
  });

  ipcMain.handle("work:local-data-show", async () => {
    if (!localDataPath) throw new Error(trMain("ui.3fc7f2bc30b2"));
    const error = await shell.openPath(localDataPath);
    if (error) throw new Error(error);
  });

  ipcMain.handle("work:local-data-export", async () => {
    if (!localDataPath) throw new Error(trMain("ui.3fc7f2bc30b2"));
    const timestamp = new Date().toISOString().slice(0, 10);
    const selection = await dialog.showSaveDialog(mainWindow!, {
      title: trMain("ui.6a1ce2014d5d"),
      defaultPath: `RouteMarket-Work-Backup-${timestamp}.sqlite`,
      filters: [{ name: trMain("ui.41bcd24e70a2"), extensions: ["sqlite"] }]
    });
    if (selection.canceled || !selection.filePath) return null;
    await exportLocalDatabase(localDataPath, selection.filePath);
    return { exportedPath: selection.filePath };
  });

  ipcMain.handle("work:local-data-clear", async () => {
    if (!localDataPath || !mainWindow) return false;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: trMain("settings.clearDialog.title"),
      message: trMain("settings.clearDialog.description"),
      detail: trMain("settings.localData.note"),
      buttons: [trMain("settings.clearDialog.cancel"), trMain("settings.clearDialog.confirm")],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return false;
    if (!localDataPath) return false;
    await writeFile(
      join(localDataPath, ".clear-local-data-on-restart"),
      new Date().toISOString(),
      "utf8"
    );
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return true;
  });

  ipcMain.handle("work:activities-clear", async (): Promise<WorkState> => {
    activityStore?.clear();
    transientActivities.length = 0;
    return getWorkState();
  });

  ipcMain.handle("work:sign-in", async (_event, intent: "login" | "register" = "login"): Promise<WorkState> => {
    await desktopAuthManager?.signIn(intent === "register" ? "register" : "login");
    return getWorkState();
  });

  ipcMain.handle("work:sign-out", async (): Promise<WorkState> => {
    await releaseAllTrackedChatAttachments();
    await desktopAuthManager?.signOut();
    return getWorkState();
  });

  ipcMain.handle("work:switch-space", async (_event, spaceId: string): Promise<WorkState> => {
    await releaseAllTrackedChatAttachments();
    await desktopAuthManager?.switchSpace(spaceId);
    const account = desktopAuthManager?.getState().account;
    if (account) await switchDataScopeRuntime?.(account);
    return getWorkState();
  });

  ipcMain.handle("work:approval-policy-remove", (_event, policyId: string): boolean => {
    const policy = approvalStore?.listPolicies().find((item) => item.policyId === policyId);
    const removed = approvalStore?.removePolicy(policyId) ?? false;
    if (removed) {
      addActivity(
        "approval.policy_removed",
        trMain("ui.32db0b5b75c9"),
        policy ? `${policy.capability} · ${policy.projectId}` : policyId
      );
    }
    return removed;
  });

  ipcMain.handle("work:choose-project", async (): Promise<ProjectSummary | null> => {
    if (!mainWindow || !workerClient) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: trMain("ui.526ffe67d225"),
      properties: ["openDirectory", "createDirectory"]
    });
    const rootPath = result.filePaths[0];
    if (result.canceled || !rootPath) return null;
    const project = await workerClient.bindProject(rootPath);
    addActivity("project.bound", trMain("ui.d15134269639"), project.displayName);
    void cloudWorkerClient?.syncProjects().catch((error: unknown) => {
      addActivity(
        "cloud.error",
        trMain("ui.26a3f413b447"),
        error instanceof Error ? error.message : "Unknown cloud sync error"
      );
    });
    return project;
  });

  ipcMain.handle(
    "work:workflow-output-directory-choose",
    async (): Promise<string | null> => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: trMain("ui.8ab6af7406ee"),
        buttonLabel: trMain("ui.06628959e129"),
        properties: ["openDirectory", "createDirectory"]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );

  ipcMain.handle("work:chat-attachments-choose", async (_event, maxCount: number) => {
    if (!mainWindow) return [];
    const apiClient = getAuthenticatedRouteMarketApiClient();
    const allowedCount = Number.isInteger(maxCount)
      ? Math.min(MAX_CHAT_ATTACHMENTS, Math.max(0, maxCount))
      : 0;
    if (!allowedCount) return [];
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: trMain("ui.c4fce4deabc5"),
      buttonLabel: trMain("ui.dba9e8228bf3"),
      properties: ["openFile", "multiSelections"]
    });
    if (selection.canceled || !selection.filePaths.length) return [];
    if (selection.filePaths.length > allowedCount) {
      throw new Error(trMain("ui.2a2ef22d4f76", [allowedCount]));
    }
    const attachments = await uploadSelectedChatAttachments(
      apiClient,
      selection.filePaths
    );
    for (const attachment of attachments) {
      selectedChatAttachments.set(attachment.id, attachment);
    }
    return attachments;
  });

  ipcMain.handle("work:chat-attachments-upload", async (_event, files: unknown) => {
    const apiClient = getAuthenticatedRouteMarketApiClient();
    const attachments = await uploadTransferredChatAttachments(
      apiClient,
      files
    );
    for (const attachment of attachments) {
      selectedChatAttachments.set(attachment.id, attachment);
    }
    return attachments;
  });

  ipcMain.handle(
    "work:chat-attachment-discard",
    async (_event, attachmentId: string) => {
      const attachment = selectedChatAttachments.get(attachmentId);
      if (!attachment) return;
      await releaseTrackedChatAttachment(attachment);
    }
  );

  ipcMain.handle("work:create-project", async (_event, displayName: string): Promise<ProjectSummary> => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    const project = await workerClient.createProject(displayName);
    addActivity("project.created", trMain("ui.35be25a7e725"), project.displayName);
    return project;
  });

  ipcMain.handle(
    "work:rename-project",
    async (_event, localProjectId: string, displayName: string): Promise<ProjectSummary> => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return workerClient.renameProject(localProjectId, displayName);
    }
  );

  ipcMain.handle("work:open-project-folder", async (_event, localProjectId: string): Promise<boolean> => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    const rootPath = await workerClient.projectRoot(localProjectId);
    const error = await shell.openPath(rootPath);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle(
    "work:attach-project-folder",
    async (_event, localProjectId: string): Promise<ProjectSummary | null> => {
      if (!mainWindow || !workerClient) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: trMain("ui.fbcb18049f72"),
        properties: ["openDirectory", "createDirectory", "multiSelections"]
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      let project: ProjectSummary | null = null;
      for (const rootPath of result.filePaths) {
        project = await workerClient.attachProjectFolder(localProjectId, rootPath);
      }
      if (!project) return null;
      addActivity("project.folder_attached", trMain("ui.9fad6c682423"), project.displayName);
      void cloudWorkerClient?.syncProjects().catch((error: unknown) => {
        addActivity(
          "cloud.error",
          trMain("ui.72db04b24cbb"),
          error instanceof Error ? error.message : "Unknown cloud sync error"
        );
      });
      return project;
    }
  );

  ipcMain.handle(
    "work:remove-project-folder",
    async (_event, localProjectId: string, folderId: string): Promise<ProjectSummary> => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return workerClient.removeProjectFolder(localProjectId, folderId);
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
      title: trMain("ui.8dd153b49f26"),
      message: trMain("ui.30a350fe7864", [project.displayName]),
      detail: trMain("ui.d3620b1d0a04"),
      buttons: [trMain("ui.4d0b4688c787"), trMain("ui.8dd153b49f26")],
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
      addActivity("project.deleted", trMain("ui.0c6cba6ea6d3"), trMain("ui.4008c1d82643", [project.displayName]));
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

  ipcMain.handle("work:local-skills-list", async (_event, localProjectId: string) => {
    if (!workerClient) throw new Error("RouteMarket Worker is offline.");
    return workerClient.listProjectSkillReceipts(localProjectId);
  });

  ipcMain.handle("work:local-skill-install", async (
    _event,
    localProjectId: string,
    importKind: LocalSkillImportKind = "archive"
  ) => {
    if (!mainWindow || !workerClient) return null;
    const project = (await workerClient.listProjects()).find(
      (candidate) => candidate.localProjectId === localProjectId
    );
    if (!project) throw new Error("Project is unavailable.");
    const selection = await dialog.showOpenDialog(mainWindow, importKind === "directory"
      ? {
          title: trMain("ui.386330ddf532", [project.displayName]),
          properties: ["openDirectory"]
        }
      : {
          title: trMain("ui.386330ddf532", [project.displayName]),
          properties: ["openFile"],
          filters: importKind === "markdown"
            ? [{ name: "SKILL.md", extensions: ["md"] }]
            : [{ name: "Skill package", extensions: ["zip"] }]
        });
    const sourcePath = selection.filePaths[0];
    if (selection.canceled || !sourcePath) return null;
    const receipt = await workerClient.installProjectSkillSource(
      localProjectId,
      sourcePath,
      importKind
    );
    addActivity(
      "project.bound",
      trMain("ui.af13b646e1d4", [receipt.name]),
      `${receipt.skillId}@${receipt.version} · ${receipt.packageDigest.slice(0, 19)}`
    );
    await cloudWorkerClient?.syncProjects().catch(() => {
      addActivity(
        "cloud.error",
        trMain("ui.ac90f90ed1b0"),
        `${receipt.skillId}@${receipt.version}`
      );
    });
    return receipt;
  });

  ipcMain.handle("work:cloud-skills-list", () =>
    listDownloadableCloudSkills()
  );

  ipcMain.handle(
    "work:cloud-skill-install",
    async (
      _event,
      localProjectId: string,
      skillId: string,
      versionId: string
    ) => {
      const receipt = await installCloudSkillPackage(
        localProjectId,
        skillId,
        versionId
      );
      addActivity(
        "project.bound",
        trMain("ui.1f3687429654", [receipt.name]),
        `${receipt.skillId}@${receipt.version} · ${receipt.packageDigest.slice(0, 19)}`
      );
      await cloudWorkerClient?.syncProjects().catch(() => {
        addActivity(
          "cloud.error",
          trMain("ui.596481793efb"),
          `${receipt.skillId}@${receipt.version}`
        );
      });
      return receipt;
    }
  );

  ipcMain.handle(
    "work:local-skill-remove",
    async (_event, localProjectId: string, skillId: string): Promise<boolean> => {
      if (!mainWindow || !workerClient) return false;
      const receipt = (await workerClient.listProjectSkillReceipts(localProjectId)).find(
        (candidate) => candidate.skillId === skillId
      );
      if (!receipt?.managed) {
        throw new Error("Only Skills installed by RouteMarket Work can be removed here.");
      }
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: trMain("ui.40f371360d57"),
        message: trMain("ui.8614642ed979", [receipt.name]),
        detail: receipt.status === "modified"
          ? trMain("ui.f8969e6cbe77")
          : trMain("ui.15c72a409999", [receipt.skillId, receipt.version]),
        buttons: [trMain("ui.4d0b4688c787"), trMain("ui.7a65c31ea79b")],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) return false;
      await workerClient.removeInstalledProjectSkill(localProjectId, skillId);
      addActivity(
        "project.deleted",
        trMain("ui.52265ee10468", [receipt.name]),
        `${receipt.skillId}@${receipt.version}`
      );
      await cloudWorkerClient?.syncProjects().catch(() => {
        addActivity(
          "cloud.error",
          trMain("ui.7df1d602441d"),
          `${receipt.skillId}@${receipt.version}`
        );
      });
      return true;
    }
  );

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
        title: trMain("ui.cf3707707fc7", [draft.name]),
        detail: trMain("ui.96c3a79691ff", [draft.nodes.length, draft.edges.length]),
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
        title: trMain("ui.f32a060c08bc"),
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
  ipcMain.handle("work:workflow-run-resume", async (_event, runId: string) => {
    if (!localWorkflowRuntime) {
      throw new Error("Local Workflow runtime is unavailable.");
    }
    const run = localWorkflowRuntime.get(runId);
    const waitingBrowserNode = run?.nodeRuns.find(
      (nodeRun) => nodeRun.status === "waiting_for_user" && nodeRun.executorKey.startsWith("local.browser."),
    );
    if (run && waitingBrowserNode) {
      const browser = requireBrowser();
      const state = await browser.getWorkflowState(run.localProjectId, run.workflowId);
      if (state.userTakeover) {
        await browser.setUserTakeover(run.localProjectId, false, state.activePageId, { source: "workflow" });
      }
    }
    return localWorkflowRuntime.resume(runId);
  });
  ipcMain.handle("work:workflow-run-retry", (_event, runId: string) => {
    if (!localWorkflowRuntime) {
      throw new Error("Local Workflow runtime is unavailable.");
    }
    return localWorkflowRuntime.retry(runId);
  });
  ipcMain.handle(
    "work:workflow-artifact-open",
    async (_event, runId: string, action: "open" | "reveal") => {
      if (!localWorkflowRuntime) {
        throw new Error("Local Workflow runtime is unavailable.");
      }
      if (action !== "open" && action !== "reveal") {
        throw new Error("Workflow artifact action is invalid.");
      }
      const run = localWorkflowRuntime.get(runId);
      if (!run || run.status !== "succeeded") {
        throw new Error("Workflow artifact is not available.");
      }
      const savedPath = workflowArtifactPath(run);
      const file = savedPath
        ? await stat(savedPath).catch(() => null)
        : null;
      if (!savedPath || !file?.isFile()) {
        throw new Error("Workflow artifact no longer exists on this device.");
      }
      if (action === "reveal") {
        shell.showItemInFolder(savedPath);
        return true;
      }
      const error = await shell.openPath(savedPath);
      if (error) throw new Error(error);
      return true;
    }
  );

  ipcMain.handle(
    "work:read-project-file",
    async (_event, localProjectId: string, relativePath: string, selectedSheetId?: string) => {
    if (!workerClient) {
      throw new Error("RouteMarket Worker is offline.");
    }
    addActivity("job.started", trMain("ui.87e4a3b9a477"), relativePath);
    try {
      const result = await workerClient.readProjectFile(localProjectId, relativePath);
      addActivity("job.succeeded", trMain("ui.d4cdfc2a8e29"), `${relativePath} · ${result.bytesRead} bytes`);
      return result;
    } catch (error) {
      addActivity(
        "job.failed",
        trMain("ui.ea2e2f6afbdb"),
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
          title: trMain("ui.304e46fff13b", [relativePath]),
          detail: relativePath,
          projectId: localProjectId
        },
        () => workerClient!.readProjectAsset(localProjectId, relativePath)
      );
    }
  );

  ipcMain.handle(
    "work:preview-project-artifact",
    async (
      _event,
      localProjectId: string,
      relativePath: string,
      selectedSheetId?: string,
      pageNumber?: number
    ) => {
      if (!workerClient) throw new Error("RouteMarket Worker is offline.");
      return toolBroker.run(
        {
          capability: "local.fs.read",
          risk: "R0",
          title: trMain("ui.304e46fff13b", [relativePath]),
          detail: relativePath,
          projectId: localProjectId
        },
        () => workerClient!.previewProjectArtifact(localProjectId, relativePath, selectedSheetId, pageNumber)
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
          title: trMain("ui.67d105585390", [relativePath]),
          detail: relativePath,
          approvalKey: `${expectedSha256}:${createHash("sha256").update(text).digest("hex")}`,
          projectId: localProjectId
        },
        async () => {
          addActivity("job.started", trMain("ui.e46c7ee877b9"), relativePath);
          try {
            const result = await workerClient!.writeProjectFile(
              localProjectId,
              relativePath,
              text,
              expectedSha256
            );
            addActivity(
              "job.succeeded",
              result.changed ? trMain("ui.2af567528490") : trMain("ui.df066218b1eb"),
              `${relativePath} · ${result.bytesRead} bytes`
            );
            return result;
          } catch (error) {
            addActivity(
              "job.failed",
              trMain("ui.987580a481f0"),
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
          title: trMain("ui.81251500ac47", [relativePath]),
          detail: relativePath,
          approvalKey: `${relativePath}:${createHash("sha256").update(text).digest("hex")}`,
          projectId: localProjectId
        },
        async () => {
          addActivity("job.started", trMain("ui.54c7ecfd638a"), relativePath);
          try {
            const result = await workerClient!.createProjectFile(
              localProjectId,
              relativePath,
              text
            );
            addActivity("job.succeeded", trMain("ui.c4a94e00f208"), `${relativePath} · ${result.bytesRead} bytes`);
            return result;
          } catch (error) {
            addActivity(
              "job.failed",
              trMain("ui.beffb3506ec0"),
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
          title: trMain("ui.85264f9189d9", [relativePath]),
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
          addActivity("job.succeeded", trMain("ui.fc982a73e1c6"), relativePath);
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
        title: versionId ? trMain("ui.872a4b050d6f") : trMain("ui.189f8a298212"),
        defaultPath: basename(relativePath)
      });
      if (selection.canceled || !selection.filePath) return null;
      return toolBroker.run(
        {
          capability: "local.fs.export",
          risk: "R2",
          title: trMain("ui.56fe6fa3b616", [relativePath]),
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
          addActivity("job.succeeded", trMain("ui.93b8629b8f2a"), relativePath);
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
          title: trMain("ui.d16b01fa9a39", [executable]),
          detail: [executable, ...args].join(" "),
          auditDetail: executable,
          approvalKey: JSON.stringify([executable, ...args]),
          projectId: localProjectId
        },
        async () => {
          const result = await workerClient!.startProcess(localProjectId, executable, args);
          addActivity("job.started", trMain("ui.6f096be8882c"), `${executable} · ${result.processId}`);
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
        title: trMain("ui.980adfb5537b"),
        detail: processId,
        auditDetail: processId,
        approvalKey: processId
      },
      async () => {
        const result = await workerClient!.stopProcess(processId);
        addActivity("job.succeeded", trMain("ui.219375df3512"), processId);
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
  ipcMain.handle(
    "work:workflow-browser-state",
    (_event, localProjectId: string, workflowId: string) =>
      requireBrowser().getWorkflowState(localProjectId, workflowId)
  );
  ipcMain.handle(
    "work:workflow-browser-show",
    (_event, localProjectId: string, workflowId: string, bounds: BrowserBounds) =>
      requireBrowser().showWorkflow(localProjectId, workflowId, bounds)
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
        title: trMain("ui.391814f706fe"),
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
        title: trMain("ui.edb346ab4d73"),
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
        title: trMain("ui.0cf947156dac"),
        detail: trMain("ui.b569fc78af6f", [selector, relativePaths.length]),
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
        title: trMain("ui.2b8823d02add"),
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
        title: trMain("ui.7c0e00182f8c"),
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
        title: trMain("ui.62d876ea16de"),
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
        title: trMain("ui.406b64d1eacd"),
        detail: `${endpoint}${targetId ? ` · ${targetId}` : ""}`,
        auditDetail: "localhost DevTools",
        approvalKey: `${endpoint}:${targetId ?? "first-page"}`
      },
      async () => {
        const state = await attachedBrowser.connect(endpoint, targetId);
        addActivity("job.succeeded", trMain("ui.a9aaef995793"), state.target?.title ?? endpoint);
        return state;
      }
    )
  );
  ipcMain.handle("work:attached-browser-disconnect", async () => {
    const state = await attachedBrowser.disconnect();
    addActivity("job.succeeded", trMain("ui.1dc9c484b501"), "localhost DevTools");
    return state;
  });
  ipcMain.handle("work:attached-browser-navigate", (_event, url: string) =>
    toolBroker.run(
      {
        capability: "local.browser.navigate",
        risk: "R1",
        title: trMain("ui.d9be03fed752"),
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
        title: trMain("ui.b59a519672eb"),
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
        title: trMain("ui.297df54bb614"),
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
        title: trMain("ui.4bfb99b19335"),
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
        title: trMain("ui.b4664873eb5e"),
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
        title: trMain("ui.58e2a6f166db", [String(input?.name ?? trMain("ui.efe7121edcef"))]),
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
        title: trMain("ui.962983429b05", [trigger ? `：${trigger.name}` : ""]),
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
          title: trMain("ui.0000d0d9e8f1", [connectorId]),
          detail: relativePath ?? trMain("ui.ba80dca7d777"),
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
          addActivity("job.succeeded", trMain("ui.84e063d6ec23", [connectorId]), relativePath ?? trMain("ui.ba80dca7d777"));
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
          title: trMain("ui.fea7ae03f94c", [input.name]),
          detail: input.transport === "stdio"
            ? [input.command, ...input.args].filter(Boolean).join(" ")
            : input.url ?? "",
          auditDetail: input.transport === "stdio" ? input.command ?? "" : input.url ?? "",
          approvalKey: JSON.stringify(input),
          ...(input.localProjectId ? { projectId: input.localProjectId } : {})
        },
        async () => {
          const result = await workerClient!.installMcpServer(input);
          addActivity("job.succeeded", trMain("ui.c0ff4378a84c"), `${input.name} · ${result.serverId}`);
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
        title: trMain("ui.314df6d67117"),
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
        title: trMain("ui.4059c943de87"),
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
        title: trMain("ui.343e596bd189"),
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
          title: trMain("ui.0016fb430274", [name]),
          detail: `${serverId} · ${name}`,
          auditDetail: `${serverId} · ${name}`,
          approvalKey: `${serverId}:${name}:${createHash("sha256").update(JSON.stringify(args)).digest("hex")}`
        },
        async () => {
          const result = await workerClient!.callMcpTool(serverId, name, args);
          addActivity("job.succeeded", trMain("ui.c0acf240bcd2"), `${serverId} · ${name}`);
          return result;
        }
      );
    }
  );

  ipcMain.handle("work:list-chat-models", async () => {
    if (!projectChatClient) {
      throw new Error("RouteMarket chat is unavailable.");
    }
    if (dataScopeSwitching) return [];
    return loadAuthenticatedCatalog(
      () => desktopAuthManager?.getState().authStatus ?? "signed_out",
      () => projectChatClient!.listModels(),
      handleAuthenticatedCatalogFailure
    );
  });

  ipcMain.handle("work:list-media-models", async (_event, kind) => {
    if (!projectChatClient) {
      throw new Error("RouteMarket media is unavailable.");
    }
    if (kind !== "image" && kind !== "video" && kind !== "audio") {
      throw new Error("Unsupported media category.");
    }
    if (dataScopeSwitching) return [];
    if ((desktopAuthManager?.getState().authStatus ?? "signed_out") !== "signed_in") {
      return modelProviderStore?.listMediaModels(kind) ?? [];
    }
    return projectChatClient.listMediaModels(kind);
  });

  ipcMain.handle("work:list-media-inspiration", async (_event, input) => {
    if (!projectChatClient || dataScopeSwitching) {
      throw new Error("RouteMarket media inspiration is unavailable.");
    }
    if (!input || (input.kind !== "image" && input.kind !== "video" && input.kind !== "audio")) {
      throw new Error("Unsupported media category.");
    }
    return projectChatClient.listMediaInspiration(input);
  });

  ipcMain.handle("work:list-media-inspiration-tags", async (_event, kind) => {
    if (!projectChatClient || dataScopeSwitching) return [];
    if (kind !== "image" && kind !== "video" && kind !== "audio") {
      throw new Error("Unsupported media category.");
    }
    return projectChatClient.listMediaInspirationTags(kind);
  });

  ipcMain.handle("work:generate-media", async (_event, input) => {
    if (!projectChatClient || dataScopeSwitching) {
      throw new Error("RouteMarket media is unavailable.");
    }
    return projectChatClient.generateMedia(input);
  });

  ipcMain.handle("work:model-providers-list", async () => {
    if (!modelProviderStore) throw new Error("Model provider storage is unavailable.");
    return modelProviderStore.list();
  });

  ipcMain.handle("work:model-provider-save", async (_event, input) => {
    if (!modelProviderStore) throw new Error("Model provider storage is unavailable.");
    const saved = await modelProviderStore.save(input);
    try {
      return await modelProviderStore.sync(saved.id);
    } catch {
      return (await modelProviderStore.list()).find((provider) => provider.id === saved.id) ?? saved;
    }
  });

  ipcMain.handle("work:model-provider-sync", async (_event, providerId: string) => {
    if (!modelProviderStore) throw new Error("Model provider storage is unavailable.");
    return modelProviderStore.sync(providerId);
  });

  ipcMain.handle("work:model-provider-remove", async (_event, providerId: string) => {
    if (!modelProviderStore) throw new Error("Model provider storage is unavailable.");
    return modelProviderStore.remove(providerId);
  });

  ipcMain.handle("work:local-api-gateway-get", async () => {
    if (!localApiGateway) throw new Error("Local API gateway is unavailable.");
    return localApiGateway.getState();
  });

  ipcMain.handle("work:local-api-gateway-update", async (_event, input) => {
    if (!localApiGateway) throw new Error("Local API gateway is unavailable.");
    return localApiGateway.update(input);
  });

  ipcMain.handle("work:local-api-route-save", async (_event, input) => {
    if (!localApiGateway) throw new Error("Local API gateway is unavailable.");
    return localApiGateway.saveRoute(input);
  });

  ipcMain.handle("work:local-api-route-remove", async (_event, routeId: string) => {
    if (!localApiGateway) throw new Error("Local API gateway is unavailable.");
    return localApiGateway.removeRoute(routeId);
  });

  ipcMain.handle("work:local-api-usage-list", async (_event, limit?: number) => {
    if (!localApiGateway) throw new Error("Local API gateway is unavailable.");
    return localApiGateway.listUsage(limit);
  });

  ipcMain.handle("work:list-local-project-chats", (_event, localProjectId: string | null) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.list(localProjectId);
  });

  ipcMain.handle("work:list-recent-local-chats", (_event, limit?: number) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.listRecent(limit);
  });

  ipcMain.handle("work:create-local-project-chat", (_event, localProjectId: string | null) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.create(localProjectId, trMain("chat.agent.none"));
  });

  ipcMain.handle("work:rename-local-project-chat", (_event, localProjectId: string | null, sessionId: string, title: string) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.rename(localProjectId, sessionId, title);
  });

  ipcMain.handle("work:delete-local-project-chat", (_event, localProjectId: string | null, sessionId: string) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    localChatStore.delete(localProjectId, sessionId);
  });

  ipcMain.handle("work:move-local-project-chat", (_event, localProjectId: string | null, sessionId: string, targetProjectId: string | null) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.move(localProjectId, sessionId, targetProjectId);
  });

  ipcMain.handle("work:get-local-project-chat", (_event, localProjectId: string | null, sessionId?: string) => {
    if (!localChatStore) throw new Error("Local chat storage is unavailable.");
    return localChatStore.get(localProjectId, sessionId);
  });

  ipcMain.handle(
    "work:truncate-local-project-chat",
    (_event, localProjectId: string | null, messageId: string) => {
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
    if (dataScopeSwitching) return [];
    return loadAuthenticatedCatalog(
      () => desktopAuthManager?.getState().authStatus ?? "signed_out",
      () => projectChatClient!.listAgents(),
      handleAuthenticatedCatalogFailure
    );
  });

  ipcMain.handle(
    "work:send-project-message",
    async (_event, input: ProjectChatRequest) => {
      if (!projectChatClient || !workerClient) {
        throw new Error("RouteMarket chat is unavailable.");
      }
      const project = input.project
        ? (await workerClient.listProjects()).find(
            (candidate) => candidate.localProjectId === input.project?.localProjectId
          ) ?? null
        : null;
      if (input.project && !project) throw new Error("The selected project does not exist on this device.");
      const localProjectId = project?.localProjectId ?? null;
      const folderAvailable = Boolean(
        project && project.hasFolder !== false && (project.folderStatus ?? "available") === "available"
      );
      const projectContext = !project || !folderAvailable
        ? null
        : await workerClient.projectContext(project.localProjectId);
      if (!localChatStore) throw new Error("Local chat storage is unavailable.");
      const thread = localChatStore.getOrCreate(localProjectId, project?.displayName ?? trMain("chat.agent.none"), input.sessionId);
      const knownAttachments = new Map<string, DesktopChatAttachment>();
      for (const message of thread.messages) {
        for (const attachment of message.attachments ?? []) {
          knownAttachments.set(attachment.id, attachment);
        }
      }
      for (const attachment of selectedChatAttachments.values()) {
        knownAttachments.set(attachment.id, attachment);
      }
      if (
        (input.attachments?.length ?? 0) > MAX_CHAT_ATTACHMENTS ||
        new Set((input.attachments ?? []).map((attachment) => attachment.id)).size !==
          (input.attachments?.length ?? 0)
      ) {
        throw new Error("The chat attachment selection is invalid.");
      }
      const trustedAttachments = (input.attachments ?? []).map((attachment) => {
        const trusted = knownAttachments.get(attachment.id);
        if (!trusted) throw new Error("The selected chat attachment is no longer available.");
        return trusted;
      });
      const history = buildStoredChatHistory(thread.messages);
      localChatStore.append({
        id: `user:${input.requestId}`,
        sessionId: thread.sessionId,
        localProjectId,
        role: "user",
        content: input.message,
        sentAt: input.sentAt,
        ...(input.contextFile
          ? { contextFile: input.contextFile.relativePath }
          : {}),
        ...(trustedAttachments.length
          ? { attachments: trustedAttachments }
          : {})
      });
      for (const attachment of trustedAttachments) {
        selectedChatAttachments.delete(attachment.id);
      }
      activeLocalChats.set(input.requestId, {
        sessionId: thread.sessionId,
        localProjectId,
        sentAt: input.sentAt,
        reasoning: "",
        artifacts: [],
        tools: [],
        ...(input.agent?.agentId ? { agentId: input.agent.agentId } : {}),
        ...(input.agent?.agentRevision ? { agentRevision: input.agent.agentRevision } : {}),
        ...(input.agent?.agentName ? { agentName: input.agent.agentName } : {}),
        ...(input.agent && "agentAvatarUrl" in input.agent
          ? { agentAvatarUrl: input.agent.agentAvatarUrl }
          : {})
      });
      const trustedInput = {
        ...input,
        ...(trustedAttachments.length
          ? { attachments: trustedAttachments }
          : { attachments: undefined })
      };
      delete trustedInput.projectContext;
      void projectChatClient.send({
        ...trustedInput,
        sessionId: thread.sessionId,
        history,
        ...(project ? { project: {
          localProjectId: project.localProjectId,
          displayName: project.displayName,
          hasFolder: folderAvailable
        } } : { project: undefined }),
        ...(projectContext ? { projectContext } : {})
      });
    }
  );

  ipcMain.handle("work:stop-project-message", (_event, requestId: string) => {
    projectChatClient?.stop(requestId);
  });
}

async function loadInstallationId(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing.trim()) return existing.trim();
  const installationId = `install_${randomUUID().replaceAll("-", "")}`;
  await writeFile(path, installationId, { encoding: "utf8", mode: 0o600 });
  return installationId;
}

function dataScopeIdentity(account: DeviceAccount | null | undefined) {
  if (!account?.id) return {};
  const activeSpace = account.spaces?.find((space) => space.id === account.activeSpaceId);
  return {
    accountId: account.id,
    spaceId: activeSpace?.id ?? account.activeSpaceId ?? `personal:${account.id}`
  };
}

async function createAccountModelProviderStore(
  accountsRoot: string,
  accountKey: string
): Promise<ModelProviderStore> {
  const accountRoot = join(accountsRoot, accountKey);
  const store = new ModelProviderStore(join(accountRoot, "model-providers.json"));
  const spacesRoot = join(accountRoot, "spaces");
  const spaces = await readdir(spacesRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  );
  const legacyFiles = spaces
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(spacesRoot, entry.name, "model-providers.json"));
  if (legacyFiles.length) {
    await store.migrateFrom(legacyFiles).catch((error) => {
      console.warn("Could not migrate space-scoped model providers to the account scope.", error);
    });
  }
  return store;
}

async function createAccountAgentCatalogStore(
  accountsRoot: string,
  accountKey: string
): Promise<AgentCatalogStore> {
  const accountRoot = join(accountsRoot, accountKey);
  await mkdir(accountRoot, { recursive: true });
  const store = new AgentCatalogStore(join(accountRoot, "agent-catalog.db"));
  try {
    const spacesRoot = join(accountRoot, "spaces");
    const spaces = await readdir(spacesRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    );
    const legacyDatabases = spaces
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(spacesRoot, entry.name, "work.db"));
    store.migrateFrom(legacyDatabases);
    return store;
  } catch (error) {
    store.close();
    throw error;
  }
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
  void desktopAuthManager.handleCallback(url).then(async () => {
    const account = desktopAuthManager?.getState().account;
    if (account) await switchDataScopeRuntime?.(account);
  }).catch((error) => reportMainProcessError("unhandled rejection", error));
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
    desktopAnalytics = new DesktopAnalytics(
      resolveRuntimeAnalyticsConfig(__ROUTEMARKET_WORK_ANALYTICS_CONFIG__),
      {
        appVersion: app.getVersion(),
        buildEnvironment: __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__,
        language: app.getLocale(),
        platform: process.platform,
        arch: process.arch
      }
    );
    registerProtocolClient();
    const userDataPath = app.getPath("userData");
    const dataPaths = routeMarketDataPaths(homedir());
    localAssetService = new LocalAssetService(join(dataPaths.root, "assets", "local-assets.db"));
    pluginMediaCapabilityService = new PluginMediaCapabilityService({
      listMediaModels: async (kind) => {
        if (!projectChatClient) throw new Error("RouteMarket media catalog is unavailable.");
        return projectChatClient.listMediaModels(kind);
      },
      generateMedia: async (input) => {
        if (!projectChatClient) throw new Error("RouteMarket media generation is unavailable.");
        return projectChatClient.generateMedia(input);
      }
    });
    desktopExtensionHost = new DesktopExtensionHost(
      join(dataPaths.root, "plugins", "dev"),
      join(dataPaths.root, "plugins", "data"),
      process.env.ROUTEMARKET_EXTENSION_DEV_MODE === "1",
      localAssetService,
      pluginMediaCapabilityService
    );
    routeMarketAccountsRoot = dataPaths.accountsRoot;
    dataScopeIndex = new DataScopeIndex(dataPaths.dataScopeIndex);
    await migrateLegacyRouteMarketData(join(userDataPath, "worker"), dataPaths.root);
    await migrateLegacyRouteMarketDeviceData(dataPaths);
    const credentialStore = new DeviceCredentialStore(dataPaths.credentials);
    const storedCredentials = await credentialStore.read().catch(
      (): DeviceCredentialPayload => ({})
    );
    const dataScope = routeMarketDataScopePaths(
      dataPaths,
      dataScopeIdentity(storedCredentials.credentials?.account)
    );
    const storedAccount = storedCredentials.credentials?.account;
    const storedSpace = storedAccount?.spaces?.find(
      (space) => space.id === storedAccount.activeSpaceId
    );
    const workDataPath = dataScope.root;
    activeDataScopeId = dataScope.scopeId;
    activeDataScopeContext = {
      scope: storedAccount ? "account-space" : "guest",
      accountName: storedAccount?.displayName ?? null,
      spaceName: storedSpace?.name ?? (storedAccount ? trMain("ui.712b770f5105") : null),
      accountsRoot: dataPaths.accountsRoot
    };
    await dataScopeIndex.upsert(dataScope, {
      accountName: storedAccount?.displayName ?? trMain("settings.localData.guest"),
      spaceName: storedSpace?.name ?? (storedAccount ? trMain("ui.712b770f5105") : trMain("settings.localData.localSpace")),
      spaceKind: storedSpace?.kind ?? (storedAccount ? "personal" : "local")
    });
    await migrateUnscopedRouteMarketData(dataPaths, workDataPath, dataScope.scopeId);
    const clearedLegacyRequest = await clearLocalDataOnStartup(
      workDataPath,
      join(userDataPath, ".clear-local-data-on-restart")
    );
    const clearedCurrentRequest = await clearLocalDataOnStartup(
      workDataPath,
      join(workDataPath, ".clear-local-data-on-restart")
    );
    await mkdir(workDataPath, { recursive: true });
    if (clearedLegacyRequest || clearedCurrentRequest) {
      await markLegacyRouteMarketDataImported(workDataPath);
    }
    desktopPreferenceStore = new DesktopPreferenceStore(dataPaths.settings);
    await desktopPreferenceStore.initialize();
    desktopUsageStore = new DesktopUsageStore(
      join(dirname(dataPaths.settings), "local-api-gateway.json.usage.jsonl")
    );
    await recoverLocalDatabase(workDataPath);
    localDataPath = workDataPath;
    workerClient = new WorkerClient(workDataPath);
    workerClient.start();
    approvalStore = new ApprovalStore(join(workDataPath, "work.db"));
    activityStore = new ActivityStore(join(workDataPath, "work.db"));
    localChatStore = new LocalChatStore(join(workDataPath, "work.db"));
    agentCatalogStore = await createAccountAgentCatalogStore(
      dataPaths.accountsRoot,
      dataScope.accountKey
    );
    modelProviderStore = await createAccountModelProviderStore(
      dataPaths.accountsRoot,
      dataScope.accountKey
    );
    localTriggerManager = new LocalTriggerManager(
      join(workDataPath, "work.db"),
      (localProjectId) => workerClient!.projectRoot(localProjectId),
      handleLocalTriggerEvent,
      {
        register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
        unregister: (accelerator) => globalShortcut.unregister(accelerator)
      }
    );
    workflowDraftStore = new WorkflowDraftStore(join(workDataPath, "work.db"));
    workflowRunStore = new WorkflowRunStore(join(workDataPath, "work.db"));
    const apiClient = new RouteMarketApiClient({
      baseUrl: API_BASE_URL,
      appVersion: app.getVersion(),
      platform: process.platform === "darwin" ? "macos" : "windows",
      arch: process.arch === "arm64" ? "arm64" : "x64",
      releaseChannel:
        __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__ === "production"
          ? "stable"
          : __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__,
      buildId: __ROUTEMARKET_WORK_BUILD_ID__
    });
    routeMarketApiClient = apiClient;
    marketplaceCatalogClient = new MarketplaceCatalogClient(apiClient);
    developmentMarketplaceFixture = await loadDevelopmentMarketplaceFixture(
      process.env.ROUTEMARKET_MARKETPLACE_DEV_FIXTURE,
      __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__ === "development"
    );
    marketplacePluginInstaller = new MarketplacePluginInstaller(
      workDataPath,
      join(workDataPath, "work.db"),
      {
        ...MARKETPLACE_PUBLISHER_KEYS,
        ...(developmentMarketplaceFixture?.publisherKeys ?? {})
      },
      app.getVersion()
    );
    if (
      __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__ === "development" &&
      !developmentMarketplaceFixture &&
      (await marketplacePluginInstaller.list()).some((item) => item.pluginId === "ai.routemarket.pdf-toolkit")
    ) {
      await marketplacePluginInstaller.remove("ai.routemarket.pdf-toolkit");
    }
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
      handleLocalWorkflowRunEvent
    );
    for (const item of transientActivities.reverse()) activityStore.append(item);
    transientActivities.length = 0;

    const installationId = await loadInstallationId(dataPaths.installationId);
    const skillSigner = new DeviceSkillSigner(
      dataPaths.skillSigningKey
    );
    deviceSkillSigner = skillSigner;
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
      skillSigner,
      onActivity: addActivity,
      executeDesktopJob: executeExternalDesktopJob
    });
    switchDataScopeRuntime = async (account) => {
      const nextScope = routeMarketDataScopePaths(dataPaths, dataScopeIdentity(account));
      if (nextScope.scopeId === activeDataScopeId) return;
      if (dataScopeSwitching) throw new Error("A workspace switch is already in progress.");
      dataScopeSwitching = true;
      try {
        const activeSpace = account.spaces?.find((space) => space.id === account.activeSpaceId);
        await dataScopeIndex?.upsert(nextScope, {
          accountName: account.displayName,
          spaceName: activeSpace?.name ?? trMain("ui.712b770f5105"),
          spaceKind: activeSpace?.kind ?? "personal"
        });
        await migrateUnscopedRouteMarketData(dataPaths, nextScope.root, nextScope.scopeId);
        const clearedLegacyRequest = await clearLocalDataOnStartup(
          nextScope.root,
          join(userDataPath, ".clear-local-data-on-restart")
        );
        const clearedCurrentRequest = await clearLocalDataOnStartup(
          nextScope.root,
          join(nextScope.root, ".clear-local-data-on-restart")
        );
        await mkdir(nextScope.root, { recursive: true });
        if (clearedLegacyRequest || clearedCurrentRequest) {
          await markLegacyRouteMarketDataImported(nextScope.root);
        }
        await recoverLocalDatabase(nextScope.root);

        projectChatClient?.stopAll();
        projectChatClient = null;
        projectChatToolRunner = null;
        activeLocalChats.clear();
        selectedChatAttachments.clear();
        preparedMarketplacePluginInstalls.clear();
        cloudWorkerClient?.stop();
        cloudWorkerClient = null;
        localWorkflowRuntime?.cancelAll();
        localWorkflowRuntime = null;
        localTriggerManager?.close();
        localTriggerManager = null;
        managedBrowser?.destroy();
        managedBrowser = null;
        workerClient?.stop();
        workerClient = null;
        workflowDraftStore?.close();
        workflowDraftStore = null;
        workflowRunStore?.close();
        workflowRunStore = null;
        approvalStore?.close();
        approvalStore = null;
        activityStore?.close();
        activityStore = null;
        localChatStore?.close();
        localChatStore = null;
        agentCatalogStore?.close();
        agentCatalogStore = null;
        modelProviderStore = null;
        marketplacePluginInstaller = null;

        localDataPath = nextScope.root;
        activeDataScopeId = nextScope.scopeId;
        activeDataScopeContext = {
          scope: "account-space",
          accountName: account.displayName,
          spaceName: activeSpace?.name ?? trMain("ui.712b770f5105"),
          accountsRoot: dataPaths.accountsRoot
        };
        workerClient = new WorkerClient(nextScope.root);
        workerClient.start();
        approvalStore = new ApprovalStore(join(nextScope.root, "work.db"));
        activityStore = new ActivityStore(join(nextScope.root, "work.db"));
        localChatStore = new LocalChatStore(join(nextScope.root, "work.db"));
        agentCatalogStore = await createAccountAgentCatalogStore(
          dataPaths.accountsRoot,
          nextScope.accountKey
        );
        modelProviderStore = await createAccountModelProviderStore(
          dataPaths.accountsRoot,
          nextScope.accountKey
        );
        localTriggerManager = createScopedLocalTriggerManager(nextScope.root);
        workflowDraftStore = new WorkflowDraftStore(join(nextScope.root, "work.db"));
        workflowRunStore = new WorkflowRunStore(join(nextScope.root, "work.db"));
        marketplacePluginInstaller = new MarketplacePluginInstaller(
          nextScope.root,
          join(nextScope.root, "work.db"),
          {
            ...MARKETPLACE_PUBLISHER_KEYS,
            ...(developmentMarketplaceFixture?.publisherKeys ?? {})
          },
          app.getVersion()
        );
        if (
          __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__ === "development" &&
          !developmentMarketplaceFixture &&
          (await marketplacePluginInstaller.list()).some((item) => item.pluginId === "ai.routemarket.pdf-toolkit")
        ) {
          await marketplacePluginInstaller.remove("ai.routemarket.pdf-toolkit");
        }
        localWorkflowRuntime = createScopedLocalWorkflowRuntime(apiClient);
        for (const item of transientActivities.reverse()) activityStore.append(item);
        transientActivities.length = 0;
        cloudWorkerClient = new CloudWorkerClient({
          apiClient,
          installationId,
          deviceName: hostname(),
          platform,
          arch,
          appVersion: app.getVersion(),
          workerVersion: app.getVersion(),
          workerClient,
          skillSigner,
          onActivity: addActivity,
          executeDesktopJob: executeExternalDesktopJob
        });
        cloudWorkerClient.setAccessToken(desktopAuthManager?.getAccessToken());
        createScopedProjectChatRuntime(apiClient);
        await refreshMarketplacePluginActivation();
        if (mainWindow) {
          managedBrowser = new ManagedBrowserManager(mainWindow, {
            dataScopeId: nextScope.scopeId,
            onPersistentPartition: (partition) => {
              void dataScopeIndex?.addBrowserPartition(nextScope.scopeId, partition);
            },
            resolveProjectRoot: (localProjectId) => {
              if (!workerClient) throw new Error("RouteMarket Worker is offline.");
              return workerClient.projectRoot(localProjectId);
            }
          });
        }
        await localTriggerManager.startAll();
        await cloudWorkerClient.start();
      } finally {
        dataScopeSwitching = false;
      }
    };
    desktopAuthManager = new DesktopAuthManager({
      apiClient,
      webBaseUrl: WEB_BASE_URL,
      installationId,
      deviceName: hostname(),
      platform,
      arch,
      appVersion: app.getVersion(),
      credentialStore,
      openExternal: (url) => shell.openExternal(url),
      onAccessToken: (token) => {
        apiClient.setAccessToken(token);
        cloudWorkerClient?.setAccessToken(token);
      },
      onSpaceChanged: (teamId) => {
        apiClient.setTeamId(teamId);
        cloudWorkerClient?.refreshWorkspace();
      },
      onDataScopeChanged: () => undefined
    });
    projectChatToolRunner = new ProjectChatToolRunner({
      workerClient,
      toolBroker,
      getBrowser: () => requireBrowser(),
      getAttachedBrowser: () => attachedBrowser,
      mcpClient: workerClient,
      skillClient: workerClient,
      pdfClient: {
        createProjectPdf: (input) => new ProjectPdfService(
          (localProjectId) => workerClient!.projectRoot(localProjectId)
        ).create(input)
      },
      onActivity: addActivity
    });
    await refreshMarketplacePluginActivation();
    projectChatClient = new ProjectChatClient({
      apiClient,
      agentCache: agentCatalogStore,
      modelProviderStore,
      recordUsage: (record) => desktopUsageStore?.record(record) ?? Promise.resolve(),
      onEvent: handleProjectChatEvent,
      toolRunner: projectChatToolRunner
    });
    localApiGateway = new LocalApiGateway({
      filePath: join(dirname(dataPaths.settings), "local-api-gateway.json"),
      listModels: () => projectChatClient?.listModels() ?? Promise.resolve([]),
      resolveExternalModel: (code) => modelProviderStore?.resolveModel(code) ?? Promise.resolve(null),
      getApiClient: () => routeMarketApiClient,
      recordUsage: (record) => desktopUsageStore?.record(record) ?? Promise.resolve(),
      listUsage: (limit) => desktopUsageStore?.list(limit) ?? Promise.resolve([])
    });
    await localApiGateway.initialize();
    await desktopAuthManager.initialize();
    registerIpc();
    createWindow();
    void desktopAnalytics.track({ name: "desktop_app_opened" });
    desktopUpdateManager = new DesktopUpdateManager(
      __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__,
      __ROUTEMARKET_WORK_DEFAULT_UPDATE_URL__,
      () => mainWindow,
      addActivity,
      (state) => mainWindow?.webContents.send("work:update-state", state)
    );
    desktopUpdateManager.start();
    await localTriggerManager.startAll();

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

app.on("before-quit", (event) => {
  if (
    !quitAttachmentCleanupComplete &&
    selectedChatAttachments.size > 0 &&
    desktopAuthManager?.getAccessToken()
  ) {
    event.preventDefault();
    if (!quitAttachmentCleanupStarted) {
      quitAttachmentCleanupStarted = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 2_000);
      });
      void Promise.race([
        releaseAllTrackedChatAttachments().catch(() => undefined),
        timeoutPromise
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
        quitAttachmentCleanupComplete = true;
        app.quit();
      });
    }
    return;
  }
  desktopUpdateManager?.stop();
  desktopUpdateManager = null;
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
  void localApiGateway?.close();
  localApiGateway = null;
  projectChatToolRunner = null;
  cloudWorkerClient?.stop();
  workerClient?.stop();
  approvalStore?.close();
  approvalStore = null;
  activityStore?.close();
  activityStore = null;
  localChatStore?.close();
  localChatStore = null;
  agentCatalogStore?.close();
  agentCatalogStore = null;
  routeMarketApiClient = null;
  marketplaceCatalogClient = null;
  developmentMarketplaceFixture = null;
  preparedMarketplacePluginInstalls.clear();
  marketplacePluginInstaller?.close();
  marketplacePluginInstaller = null;
});

app.on("will-quit", () => {
  void desktopExtensionHost?.close();
  desktopExtensionHost = null;
  void localAssetService?.close();
  localAssetService = null;
  void pluginMediaCapabilityService?.close();
  pluginMediaCapabilityService = null;
});
