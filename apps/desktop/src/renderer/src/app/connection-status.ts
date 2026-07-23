import type { WorkState } from "../../../shared/desktop-api";

export function workerStatusLabel(
  status: WorkState["workerStatus"],
  compact = false
): string {
  if (status === "online") return compact ? "已连接" : "本地已连接";
  if (status === "offline") return compact ? "已离线" : "本地离线";
  return compact ? "启动中" : "正在启动";
}

export function cloudStatusLabel(status: WorkState["cloudStatus"]): string {
  if (status === "online") return "云端已连接";
  if (status === "connecting") return "云端连接中";
  if (status === "degraded") return "云端连接不稳定";
  if (status === "access_required") return "云端需要重新授权";
  if (status === "error") return "云端异常";
  return "云端未登录";
}

export function withWorkerOffline(
  state: WorkState,
  message: string
): WorkState {
  return {
    ...state,
    workerStatus: "offline",
    cloudStatus:
      state.cloudStatus === "disabled" ? "disabled" : "error",
    cloudError: message
  };
}
