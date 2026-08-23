import "./browser-operation-panel.scss";
import { getActiveLocale, tr } from "../../i18n";
import { Bot, CheckCircle2, CircleAlert, Clock3, Cloud, MessageSquare, RotateCcw, UserRound, Workflow, X } from "lucide-react";
import type { ManagedBrowserOperation, ManagedBrowserOperationSource } from "../../../../shared/desktop-api";
type BrowserOperationPanelProps = {
    operations: ManagedBrowserOperation[];
    busy: boolean;
    onRetry(operationId: string): void;
    onClose(): void;
};
const SOURCE_LABELS: Record<ManagedBrowserOperationSource, string> = {
    user: tr("ui.9ba763ea3423"),
    chat: tr("ui.5358b2ddde5a"),
    agent: "Agent",
    workflow: "Workflow",
    cloud_job: tr("ui.d86a906d628b")
};
export function BrowserOperationPanel({ operations, busy, onRetry, onClose }: BrowserOperationPanelProps) {
    const failedCount = operations.filter((operation) => operation.status === "failed").length;
    return (<aside className="browser-operation-panel" aria-label={tr("ui.8234774e7989")}>
      <header>
        <div>
          <strong>{tr("ui.6fcdba1f7183")}</strong>
          <span>{operations.length}{tr("ui.0eaa31b6e011")}{failedCount}{tr("ui.8470dc7fa8a9")}</span>
        </div>
        <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={onClose}>
          <X size={14}/>
        </button>
      </header>

      <div className="browser-operation-list">
        {operations.map((operation) => (<article className="browser-operation-item" data-status={operation.status} key={operation.operationId}>
            <div className="browser-operation-status">
              <OperationStatus operation={operation}/>
              <div>
                <strong>{operation.title}</strong>
                <span>
                  <SourceIcon source={operation.source}/>
                  {SOURCE_LABELS[operation.source]} · {formatOperationTime(operation.startedAt)}
                </span>
              </div>
              {operation.status === "failed" && operation.retryable && (<button type="button" title={tr("ui.ac1ba6c42a82")} disabled={busy} onClick={() => onRetry(operation.operationId)}>
                  <RotateCcw size={13}/>
                </button>)}
            </div>
            <code title={operation.detail}>{operation.detail}</code>
            {operation.error && <p>{operation.error}</p>}
            <small title={operation.url}>{compactUrl(operation.url)}</small>
          </article>))}
        {operations.length === 0 && (<div className="browser-operation-empty">
            <Clock3 size={18}/>
            <span>{tr("ui.5f2d3a96ff98")}</span>
          </div>)}
      </div>
    </aside>);
}
function OperationStatus({ operation }: {
    operation: ManagedBrowserOperation;
}) {
    if (operation.status === "failed")
        return <CircleAlert size={15}/>;
    if (operation.status === "running")
        return <Clock3 className="spin" size={15}/>;
    return <CheckCircle2 size={15}/>;
}
function SourceIcon({ source }: {
    source: ManagedBrowserOperationSource;
}) {
    if (source === "agent")
        return <Bot size={10}/>;
    if (source === "workflow")
        return <Workflow size={10}/>;
    if (source === "cloud_job")
        return <Cloud size={10}/>;
    if (source === "chat")
        return <MessageSquare size={10}/>;
    return <UserRound size={10}/>;
}
function formatOperationTime(value: string): string {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime()))
        return value;
    return new Intl.DateTimeFormat(getActiveLocale(), {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(timestamp);
}
function compactUrl(value: string): string {
    if (!value || value === "about:blank")
        return "about:blank";
    try {
        const url = new URL(value);
        return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
    }
    catch {
        return value;
    }
}
