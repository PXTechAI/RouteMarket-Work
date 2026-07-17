import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  ActivityItem,
  ProjectSummary,
  WorkState
} from "../shared/desktop-api";
import { CloudWorkerClient } from "./cloud-worker-client";
import { DesktopAuthManager } from "./desktop-auth-manager";
import { DeviceCredentialStore } from "./device-credential-store";
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
let pendingDeepLink: string | null = null;
const activities: ActivityItem[] = [];

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
  activities.unshift({
    id: `activity_${randomUUID().replaceAll("-", "")}`,
    kind,
    title,
    detail,
    occurredAt: new Date().toISOString()
  });
  activities.splice(100);
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
    activities
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
      onActivity: addActivity
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
    await desktopAuthManager.initialize();
    await cloudWorkerClient.start();

    registerIpc();
    createWindow();

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
  cloudWorkerClient?.stop();
  workerClient?.stop();
});
