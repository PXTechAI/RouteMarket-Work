import { tr } from "../i18n";
import type { WorkState } from "../../../shared/desktop-api";
export function workerStatusLabel(status: WorkState["workerStatus"], compact = false): string {
    if (status === "online")
        return compact ? tr("ui.65fe35c45e4e") : tr("ui.45e3bc49af55");
    if (status === "offline")
        return compact ? tr("ui.af3ca4aeac32") : tr("ui.501e0abd6c17");
    return compact ? tr("ui.7e0798ca5201") : tr("ui.6017dccf86b2");
}
export function cloudStatusLabel(status: WorkState["cloudStatus"]): string {
    if (status === "online")
        return tr("ui.21fb2db65f6a");
    if (status === "connecting")
        return tr("ui.358342a01947");
    if (status === "degraded")
        return tr("ui.2b1d2b4e44db");
    if (status === "access_required")
        return tr("ui.df235b080fa3");
    if (status === "error")
        return tr("ui.09d87c64e726");
    return tr("ui.fd68312e3405");
}
export function withWorkerOffline(state: WorkState, message: string): WorkState {
    return {
        ...state,
        workerStatus: "offline",
        cloudStatus: state.cloudStatus === "disabled" ? "disabled" : "error",
        cloudError: message
    };
}
