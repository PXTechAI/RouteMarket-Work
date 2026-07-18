import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cloud,
  MessageSquare,
  RotateCcw,
  UserRound,
  Workflow,
  X
} from "lucide-react";
import type {
  ManagedBrowserOperation,
  ManagedBrowserOperationSource
} from "../../../../shared/desktop-api";

type BrowserOperationPanelProps = {
  operations: ManagedBrowserOperation[];
  busy: boolean;
  onRetry(operationId: string): void;
  onClose(): void;
};

const SOURCE_LABELS: Record<ManagedBrowserOperationSource, string> = {
  user: "用户",
  chat: "聊天",
  agent: "Agent",
  workflow: "Workflow",
  cloud_job: "云端任务"
};

export function BrowserOperationPanel({
  operations,
  busy,
  onRetry,
  onClose
}: BrowserOperationPanelProps) {
  const failedCount = operations.filter((operation) => operation.status === "failed").length;

  return (
    <aside className="browser-operation-panel" aria-label="浏览器操作记录">
      <header>
        <div>
          <strong>操作记录</strong>
          <span>{operations.length} 条记录 · {failedCount} 条失败</span>
        </div>
        <button type="button" title="关闭" onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      <div className="browser-operation-list">
        {operations.map((operation) => (
          <article
            className="browser-operation-item"
            data-status={operation.status}
            key={operation.operationId}
          >
            <div className="browser-operation-status">
              <OperationStatus operation={operation} />
              <div>
                <strong>{operation.title}</strong>
                <span>
                  <SourceIcon source={operation.source} />
                  {SOURCE_LABELS[operation.source]} · {formatOperationTime(operation.startedAt)}
                </span>
              </div>
              {operation.status === "failed" && operation.retryable && (
                <button
                  type="button"
                  title="重新执行"
                  disabled={busy}
                  onClick={() => onRetry(operation.operationId)}
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
            <code title={operation.detail}>{operation.detail}</code>
            {operation.error && <p>{operation.error}</p>}
            <small title={operation.url}>{compactUrl(operation.url)}</small>
          </article>
        ))}
        {operations.length === 0 && (
          <div className="browser-operation-empty">
            <Clock3 size={18} />
            <span>浏览器操作会按项目记录在这里。</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function OperationStatus({ operation }: { operation: ManagedBrowserOperation }) {
  if (operation.status === "failed") return <CircleAlert size={15} />;
  if (operation.status === "running") return <Clock3 className="spin" size={15} />;
  return <CheckCircle2 size={15} />;
}

function SourceIcon({ source }: { source: ManagedBrowserOperationSource }) {
  if (source === "agent") return <Bot size={10} />;
  if (source === "workflow") return <Workflow size={10} />;
  if (source === "cloud_job") return <Cloud size={10} />;
  if (source === "chat") return <MessageSquare size={10} />;
  return <UserRound size={10} />;
}

function formatOperationTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
}

function compactUrl(value: string): string {
  if (!value || value === "about:blank") return "about:blank";
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}
