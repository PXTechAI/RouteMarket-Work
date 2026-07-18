import { CheckCircle2, CirclePause, Download, LoaderCircle, X } from "lucide-react";
import type { ManagedBrowserDownload } from "../../../../shared/desktop-api";

type BrowserDownloadPanelProps = {
  downloads: ManagedBrowserDownload[];
  onClose(): void;
};

export function BrowserDownloadPanel({
  downloads,
  onClose
}: BrowserDownloadPanelProps) {
  return (
    <aside className="browser-download-panel">
      <header>
        <div>
          <strong>下载</strong>
          <span>保存到项目的 .routemarket/downloads</span>
        </div>
        <button type="button" title="关闭下载面板" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="browser-download-list">
        {downloads.length === 0 ? (
          <div className="browser-download-empty">
            <Download size={22} />
            <span>暂无下载</span>
          </div>
        ) : downloads.map((download) => {
          const progress = download.totalBytes > 0
            ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))
            : null;
          return (
            <article key={download.downloadId} className="browser-download-item">
              <div className="browser-download-title">
                <DownloadStatus status={download.status} />
                <strong title={download.fileName}>{download.fileName}</strong>
                <span>{statusLabel(download.status)}</span>
              </div>
              <div className="browser-download-progress">
                <span style={{ width: `${progress ?? (download.status === "completed" ? 100 : 12)}%` }} />
              </div>
              <small>
                {formatBytes(download.receivedBytes)}
                {download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ""}
              </small>
              <code title={download.relativePath}>{download.relativePath}</code>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function DownloadStatus({ status }: Pick<ManagedBrowserDownload, "status">) {
  if (status === "completed") return <CheckCircle2 size={14} />;
  if (status === "paused") return <CirclePause size={14} />;
  if (status === "progressing") return <LoaderCircle className="spin" size={14} />;
  return <X size={14} />;
}

function statusLabel(status: ManagedBrowserDownload["status"]): string {
  if (status === "progressing") return "下载中";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "已中断";
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}
