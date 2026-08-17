import { trMain } from "./i18n";
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
        trMain("ui.25b06be4ccfa"),
        error.message
      );
    });
    autoUpdater.on("update-available", (info) => {
      void this.promptForDownload(info.version).catch((error) =>
        this.reportError(trMain("ui.f23403014a2e"), error)
      );
    });
    autoUpdater.on("update-downloaded", (info) => {
      void this.promptForRestart(info.version).catch((error) =>
        this.reportError(trMain("ui.382b8734b9dc"), error)
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

  getInfo(): { enabled: boolean; channel: "stable" | "beta" } {
    return { enabled: this.policy.enabled, channel: this.policy.channel };
  }

  async checkNow(): Promise<boolean> {
    if (!this.policy.enabled) return false;
    await autoUpdater.checkForUpdates();
    return true;
  }

  private async check(): Promise<void> {
    try {
      await this.checkNow();
    } catch (error) {
      this.onActivity(
        "job.failed",
        trMain("ui.25b06be4ccfa"),
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
        title: trMain("ui.e835fb998e3a"),
        message: trMain("ui.0db03464c288", [version]),
        detail:
          trMain("ui.37c8fa15a15a"),
        buttons: [trMain("ui.479fcc1cc066"), trMain("ui.c1f18f4e0a0d")],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      });
      if (result.response !== 1) return;
      this.onActivity("job.started", trMain("ui.58cc34112c7e"), version);
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
      this.onActivity("job.succeeded", trMain("ui.346224f66468"), version);
      const result = await dialog.showMessageBox(window, {
        type: "info",
        title: trMain("ui.be493d7e0b78"),
        message: trMain("ui.6c37ba61f5f5", [version]),
        detail: trMain("ui.c843aed0d102"),
        buttons: [trMain("ui.479fcc1cc066"), trMain("ui.33292ab3427c")],
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
