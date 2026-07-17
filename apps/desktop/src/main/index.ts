import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  ActivityItem,
  ProjectSummary,
  WorkState
} from "../shared/desktop-api";
import { CloudWorkerClient } from "./cloud-worker-client";
import { WorkerClient } from "./worker-client";

let mainWindow: BrowserWindow | null = null;
let workerClient: WorkerClient | null = null;
let cloudWorkerClient: CloudWorkerClient | null = null;
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
      preload: join(__dirname, "../preload/index.mjs"),
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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

function registerIpc(): void {
  ipcMain.handle("work:get-state", async (): Promise<WorkState> => {
    const projects = await workerClient?.listProjects() ?? [];
    const cloudState = cloudWorkerClient?.getState() ?? {
      status: "disabled" as const,
      runtimeId: null,
      error: null
    };
    return {
      workerStatus: workerClient ? "online" : "offline",
      cloudStatus: cloudState.status,
      runtimeId: cloudState.runtimeId,
      cloudError: cloudState.error,
      projects,
      activities
    };
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

  ipcMain.handle("work:read-readme", async (_event, localProjectId: string) => {
    if (!workerClient) {
      throw new Error("RouteMarket Worker is offline.");
    }
    addActivity("job.started", "读取 README", localProjectId);
    try {
      const result = await workerClient.readReadme(localProjectId);
      addActivity("job.succeeded", "README 读取完成", `${result.bytesRead} bytes`);
      return result;
    } catch (error) {
      addActivity(
        "job.failed",
        "README 读取失败",
        error instanceof Error ? error.message : "Unknown worker error"
      );
      throw error;
    }
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

app.whenReady().then(async () => {
  const workDataPath = join(app.getPath("userData"), "worker");
  await mkdir(workDataPath, { recursive: true });
  workerClient = new WorkerClient(workDataPath);
  workerClient.start();
  registerIpc();
  createWindow();
  const installationId = await loadInstallationId(workDataPath);
  const platform = process.platform === "darwin" ? "macos" : "windows";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  cloudWorkerClient = new CloudWorkerClient({
    apiBaseUrl: (process.env.ROUTEMARKET_WORK_API_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, ""),
    sessionToken: process.env.ROUTEMARKET_WORK_SESSION_TOKEN,
    installationId,
    deviceName: hostname(),
    platform,
    arch,
    appVersion: app.getVersion(),
    workerVersion: app.getVersion(),
    workerClient,
    onActivity: addActivity
  });
  void cloudWorkerClient.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  cloudWorkerClient?.stop();
  workerClient?.stop();
});
