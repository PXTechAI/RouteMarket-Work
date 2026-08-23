import { trMain } from "./i18n";
import type { BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { DesktopBuildEnvironment } from "../../build-endpoints";
import type { DesktopUpdateState } from "../shared/desktop-api";
import { resolveDesktopUpdatePolicy } from "./desktop-update-policy";

const INITIAL_CHECK_DELAY_MS = 15_000;

export class DesktopUpdateManager {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private readonly policy;
  private state: DesktopUpdateState = idleUpdateState();

  constructor(
    buildEnvironment: DesktopBuildEnvironment,
    defaultFeedUrl: string | null,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onActivity: (
      kind: "job.started" | "job.succeeded" | "job.failed",
      title: string,
      detail: string
    ) => void,
    private readonly onState: (state: DesktopUpdateState) => void = () => undefined
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
        channel: this.policy.channel === "beta" ? "beta" : "latest",
        useMultipleRangeRequest: false
      });
    }
    autoUpdater.on("checking-for-update", () => {
      this.publishState({ ...idleUpdateState(), status: "checking" });
    });
    autoUpdater.on("update-not-available", () => {
      this.publishState(idleUpdateState());
    });
    autoUpdater.on("error", (error) => {
      this.reportError(trMain("ui.25b06be4ccfa"), error);
    });
    autoUpdater.on("update-available", (info) => {
      this.publishState({
        ...idleUpdateState(),
        status: "available",
        version: info.version
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      this.publishState({
        status: "downloading",
        version: this.state.version,
        percent: finiteNumber(progress.percent, 0, 100),
        transferredBytes: finiteNumber(progress.transferred),
        totalBytes: finiteNumber(progress.total),
        bytesPerSecond: finiteNumber(progress.bytesPerSecond),
        error: null
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.onActivity("job.succeeded", trMain("ui.346224f66468"), info.version);
      this.publishState({
        ...idleUpdateState(),
        status: "downloaded",
        version: info.version,
        percent: 100
      });
    });
    autoUpdater.on("update-cancelled", () => {
      this.publishState(idleUpdateState());
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
    this.setTaskbarProgress(-1);
  }

  getInfo(): { enabled: boolean; channel: "stable" | "beta" } {
    return { enabled: this.policy.enabled, channel: this.policy.channel };
  }

  getState(): DesktopUpdateState {
    return { ...this.state };
  }

  async checkNow(): Promise<boolean> {
    if (!this.policy.enabled) return false;
    this.publishState({ ...idleUpdateState(), status: "checking" });
    await autoUpdater.checkForUpdates();
    return true;
  }

  async downloadUpdate(): Promise<boolean> {
    if (!this.policy.enabled || this.state.status !== "available") return false;
    const version = this.state.version;
    this.publishState({
      ...idleUpdateState(),
      status: "downloading",
      version,
      percent: 0
    });
    this.onActivity("job.started", trMain("ui.58cc34112c7e"), version ?? "");
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      this.reportError(trMain("ui.f23403014a2e"), error);
      throw error;
    }
  }

  installUpdate(): boolean {
    if (!this.policy.enabled || this.state.status !== "downloaded") return false;
    autoUpdater.quitAndInstall(false, true);
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
    const message = error instanceof Error ? error.message : "Unknown update error";
    this.onActivity(
      "job.failed",
      title,
      message
    );
    this.publishState({
      ...idleUpdateState(),
      status: "error",
      version: this.state.version,
      error: message
    });
  }

  private publishState(state: DesktopUpdateState): void {
    this.state = state;
    this.setTaskbarProgress(
      state.status === "downloading" && state.percent !== null
        ? state.percent / 100
        : state.status === "downloaded"
          ? 1
          : -1
    );
    this.onState({ ...state });
  }

  private setTaskbarProgress(progress: number): void {
    const window = this.getWindow();
    if (!window) return;
    try {
      window.setProgressBar(progress);
    } catch {
      // The window may have closed while an updater event was in flight.
    }
  }
}

function idleUpdateState(): DesktopUpdateState {
  return {
    status: "idle",
    version: null,
    percent: null,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
    error: null
  };
}

function finiteNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
