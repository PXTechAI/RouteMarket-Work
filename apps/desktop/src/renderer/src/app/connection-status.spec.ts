import { describe, expect, it } from "vitest";
import type { WorkState } from "../../../shared/desktop-api";
import {
  cloudStatusLabel,
  withWorkerOffline,
  workerStatusLabel
} from "./connection-status";

const state: WorkState = {
  workerStatus: "online",
  cloudStatus: "online",
  runtimeId: "runtime_1",
  cloudError: null,
  authStatus: "signed_in",
  authError: null,
  projects: [],
  activities: [],
  approvals: [],
  approvalPolicies: []
};

describe("connection status", () => {
  it("distinguishes startup, online and offline worker states", () => {
    expect(workerStatusLabel("starting")).toBe("正在启动");
    expect(workerStatusLabel("online")).toBe("本地已连接");
    expect(workerStatusLabel("offline")).toBe("本地离线");
    expect(workerStatusLabel("offline", true)).toBe("已离线");
  });

  it("provides a label for every cloud state", () => {
    expect([
      "disabled",
      "connecting",
      "online",
      "degraded",
      "error",
      "access_required"
    ].map((status) => cloudStatusLabel(
      status as WorkState["cloudStatus"]
    ))).toEqual([
      "云端未登录",
      "云端连接中",
      "云端已连接",
      "云端连接不稳定",
      "云端异常",
      "云端需要重新授权"
    ]);
  });

  it("marks both local and active cloud connections unavailable", () => {
    expect(withWorkerOffline(state, "bridge unavailable")).toMatchObject({
      workerStatus: "offline",
      cloudStatus: "error",
      cloudError: "bridge unavailable"
    });
    expect(withWorkerOffline(
      { ...state, cloudStatus: "disabled" },
      "bridge unavailable"
    ).cloudStatus).toBe("disabled");
  });
});
