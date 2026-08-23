import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(value: any) => void>>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    channel: "latest",
    setFeedURL: vi.fn(),
    on: vi.fn((event: string, listener: (value: any) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return updater;
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    emit(event: string, value: any) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    }
  };
  return {
    updater
  };
});

vi.mock("electron-updater", () => ({ autoUpdater: mocks.updater }));

import { DesktopUpdateManager } from "./desktop-update-manager";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ROUTEMARKET_WORK_UPDATE_CHANNEL", "stable");
  vi.stubEnv("ROUTEMARKET_WORK_UPDATE_URL", "");
  mocks.updater.setFeedURL.mockClear();
  mocks.updater.checkForUpdates.mockClear();
  mocks.updater.downloadUpdate.mockClear();
  mocks.updater.quitAndInstall.mockClear();
  mocks.updater.removeAllListeners();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("DesktopUpdateManager", () => {
  it("configures a signed feed, checks periodically and downloads on request", async () => {
    const activity = vi.fn();
    const onState = vi.fn();
    const window = { setProgressBar: vi.fn() } as unknown as BrowserWindow;
    const manager = new DesktopUpdateManager(
      "production",
      "https://downloads.example.com/work",
      () => window,
      activity,
      onState
    );
    manager.start();

    expect(mocks.updater.autoDownload).toBe(false);
    expect(mocks.updater.autoInstallOnAppQuit).toBe(true);
    expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://downloads.example.com/work",
      channel: "latest",
      useMultipleRangeRequest: false
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);

    mocks.updater.emit("update-available", { version: "0.3.0" });
    expect(manager.getState()).toMatchObject({ status: "available", version: "0.3.0" });
    await manager.downloadUpdate();
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledWith(
      "job.started",
      "正在下载桌面更新",
      "0.3.0"
    );

    mocks.updater.emit("download-progress", {
      percent: 42.4,
      transferred: 4_240,
      total: 10_000,
      bytesPerSecond: 2_000
    });
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "downloading",
      percent: 42.4,
      transferredBytes: 4_240,
      totalBytes: 10_000
    }));
    expect(window.setProgressBar).toHaveBeenLastCalledWith(0.424);

    manager.stop();
    expect(mocks.updater.removeAllListeners).toHaveBeenCalled();
  });

  it("installs a downloaded update only after the renderer requests restart", () => {
    const window = { setProgressBar: vi.fn() } as unknown as BrowserWindow;
    const manager = new DesktopUpdateManager(
      "production",
      "https://downloads.example.com/work",
      () => window,
      vi.fn()
    );
    manager.start();
    mocks.updater.emit("update-downloaded", { version: "0.3.0" });
    expect(manager.getState()).toMatchObject({ status: "downloaded", version: "0.3.0" });
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(manager.installUpdate()).toBe(true);
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    manager.stop();
  });

  it("does not register update work in development builds", () => {
    const manager = new DesktopUpdateManager(
      "development",
      null,
      () => null,
      vi.fn()
    );
    const callsBefore = mocks.updater.on.mock.calls.length;
    manager.start();
    expect(mocks.updater.on.mock.calls).toHaveLength(callsBefore);
    manager.stop();
  });
});
