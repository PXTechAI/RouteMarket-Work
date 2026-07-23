import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import { autoUpdater } from "electron-updater";
import type { DesktopBuildEnvironment } from "../../build-endpoints";
import { resolveDesktopUpdatePolicy } from "./desktop-update-policy";

const INITIAL_CHECK_DELAY_MS = 15_000;

export class DesktopUpdateManager {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private prompting = false;
  private readonly policy;

  constructor(
    buildEnvironment: DesktopBuildEnvironment,
    defaultFeedUrl: string | null,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onActivity: (
      kind: "job.started" | "job.succeeded" | "job.failed",
      title: string,
      detail: string
    ) => void
  ) {
    this.policy = resolveDesktopUpdatePolicy(
      buildEnvironment,
      process.env,
      defaultFeedUrl
    );
  }

  start(): void {
    if (!this.policy.enabled) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = this.policy.allowPrerelease;
    if (this.policy.channel === "beta") autoUpdater.channel = "beta";
    if (this.policy.feedUrl) {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: this.policy.feedUrl,
        channel: this.policy.channel === "beta" ? "beta" : "latest"
      });
    }
    autoUpdater.on("error", (error) => {
      this.onActivity(
        "job.failed",
        "桌面更新检查失败",
        error.message
      );
    });
    autoUpdater.on("update-available", (info) => {
      void this.promptForDownload(info.version).catch((error) =>
        this.reportError("桌面更新下载失败", error)
      );
    });
    autoUpdater.on("update-downloaded", (info) => {
      void this.promptForRestart(info.version).catch((error) =>
        this.reportError("桌面更新安装提示失败", error)
      );
    });
    this.initialTimer = setTimeout(
      () => void this.check(),
      INITIAL_CHECK_DELAY_MS
    );
    this.timer = setInterval(
      () => void this.check(),
      this.policy.checkIntervalMs
    );
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.initialTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    autoUpdater.removeAllListeners();
  }

  private async check(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.onActivity(
        "job.failed",
        "桌面更新检查失败",
        error instanceof Error ? error.message : "Unknown update error"
      );
    }
  }

  private reportError(title: string, error: unknown): void {
    this.onActivity(
      "job.failed",
      title,
      error instanceof Error ? error.message : "Unknown update error"
    );
  }

  private async promptForDownload(version: string): Promise<void> {
    if (this.prompting) return;
    const window = this.getWindow();
    if (!window) return;
    this.prompting = true;
    try {
      const result = await dialog.showMessageBox(window, {
        type: "info",
        title: "RouteMarket Work 更新",
        message: `发现新版本 ${version}`,
        detail:
          "更新包会先完成签名与完整性校验，下载期间可以继续工作。",
        buttons: ["稍后", "下载更新"],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      });
      if (result.response !== 1) return;
      this.onActivity("job.started", "正在下载桌面更新", version);
      await autoUpdater.downloadUpdate();
    } finally {
      this.prompting = false;
    }
  }

  private async promptForRestart(version: string): Promise<void> {
    if (this.prompting) return;
    const window = this.getWindow();
    if (!window) return;
    this.prompting = true;
    try {
      this.onActivity("job.succeeded", "桌面更新已下载", version);
      const result = await dialog.showMessageBox(window, {
        type: "info",
        title: "RouteMarket Work 更新已就绪",
        message: `版本 ${version} 已准备完成`,
        detail: "立即重启会安装更新；选择稍后可在正常退出后自动安装。",
        buttons: ["稍后", "重启并安装"],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      });
      if (result.response === 1) {
        autoUpdater.quitAndInstall(false, true);
      }
    } finally {
      this.prompting = false;
    }
  }
}
