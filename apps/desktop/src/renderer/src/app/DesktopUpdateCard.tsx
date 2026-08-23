import "./desktop-update-card.scss";
import { CheckCircle2, CircleAlert, Download, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DesktopUpdateState, RouteMarketWorkApi } from "../../../shared/desktop-api";
import { tr, useLocale } from "../i18n";

export function DesktopUpdateCard({ api, initialState }: {
  api: RouteMarketWorkApi | undefined;
  initialState?: DesktopUpdateState;
}) {
  useLocale();
  const [state, setState] = useState<DesktopUpdateState | null>(initialState ?? null);
  const [busy, setBusy] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.getUpdateState || !api.onDesktopUpdateState) return;
    let active = true;
    void api.getUpdateState().then((next) => {
      if (active) setState(next);
    }).catch(() => undefined);
    const unsubscribe = api.onDesktopUpdateState((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const stateKey = state ? `${state.status}:${state.version ?? ""}:${state.error ?? ""}` : "";
  const view = useMemo(() => updateCardView(state), [api, state]);
  if (!state || !view || dismissedKey === stateKey) return null;

  async function run(action: (() => Promise<boolean>) | undefined): Promise<void> {
    if (!action || busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      // The main process publishes the actionable updater error state.
    } finally {
      setBusy(false);
    }
  }

  const percent = Math.round(state.percent ?? 0);
  return (
    <aside className={`rm-update-card ${state.status}`} aria-live="polite" aria-label={tr("desktop.update.title")}>
      <div className="rm-update-brand" aria-hidden="true">RM</div>
      <div className="rm-update-content">
        <div className="rm-update-heading">
          <strong>{tr("desktop.update.title")}</strong>
          {state.status === "downloading" && <b>{percent}%</b>}
        </div>
        <p>{view.message}</p>
        {state.status === "downloading" && (
          <>
            <div
              className="rm-update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <small>{downloadDetail(state)}</small>
          </>
        )}
        {state.status === "error" && state.error && <small className="rm-update-error">{state.error}</small>}
        {view.action && (
          <button className="rm-update-action" type="button" disabled={busy} onClick={() => void run(view.action)}>
            {busy ? <LoaderCircle className="spin" size={14} /> : view.icon}
            {view.actionLabel}
          </button>
        )}
      </div>
      <button
        className="rm-update-dismiss"
        type="button"
        title={tr("desktop.update.dismiss")}
        aria-label={tr("desktop.update.dismiss")}
        onClick={() => setDismissedKey(stateKey)}
      >
        <X size={14} />
      </button>
    </aside>
  );

  function updateCardView(current: DesktopUpdateState | null) {
    if (!current || current.status === "idle" || current.status === "checking") return null;
    const version = current.version ?? "";
    if (current.status === "available") {
      return {
        message: tr("desktop.update.available", [version]),
        actionLabel: tr("desktop.update.download"),
        action: api?.downloadUpdate ? () => api.downloadUpdate!() : undefined,
        icon: <Download size={14} />
      };
    }
    if (current.status === "downloading") {
      return { message: tr("desktop.update.downloading", [version]), action: undefined, actionLabel: "", icon: null };
    }
    if (current.status === "downloaded") {
      return {
        message: tr("desktop.update.downloaded", [version]),
        actionLabel: tr("desktop.update.restart"),
        action: api?.installUpdate ? () => api.installUpdate!() : undefined,
        icon: <CheckCircle2 size={14} />
      };
    }
    return {
      message: tr("desktop.update.failed"),
      actionLabel: tr("desktop.update.retry"),
      action: () => api?.checkForUpdates() ?? Promise.resolve(false),
      icon: current.error ? <CircleAlert size={14} /> : <RefreshCw size={14} />
    };
  }
}

function downloadDetail(state: DesktopUpdateState): string {
  const transferred = formatUpdateBytes(state.transferredBytes);
  const total = state.totalBytes > 0 ? formatUpdateBytes(state.totalBytes) : "—";
  const speed = state.bytesPerSecond > 0
    ? ` · ${formatUpdateBytes(state.bytesPerSecond)}/s`
    : "";
  return `${transferred} / ${total}${speed}`;
}

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}
