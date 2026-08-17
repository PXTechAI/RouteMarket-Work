import { tr } from "../../i18n";
import { CheckCircle2, CirclePause, Download, LoaderCircle, X } from "lucide-react";
import type { ManagedBrowserDownload } from "../../../../shared/desktop-api";
type BrowserDownloadPanelProps = {
    downloads: ManagedBrowserDownload[];
    onClose(): void;
};
export function BrowserDownloadPanel({ downloads, onClose }: BrowserDownloadPanelProps) {
    return (<aside className="browser-download-panel">
      <header>
        <div>
          <strong>{tr("ui.2b9d013177da")}</strong>
          <span>{tr("ui.296101208b70")}</span>
        </div>
        <button type="button" title={tr("ui.e28562bb65ad")} onClick={onClose}>
          <X size={14}/>
        </button>
      </header>
      <div className="browser-download-list">
        {downloads.length === 0 ? (<div className="browser-download-empty">
            <Download size={22}/>
            <span>{tr("ui.fba30a043d9a")}</span>
          </div>) : downloads.map((download) => {
            const progress = download.totalBytes > 0
                ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))
                : null;
            return (<article key={download.downloadId} className="browser-download-item">
              <div className="browser-download-title">
                <DownloadStatus status={download.status}/>
                <strong title={download.fileName}>{download.fileName}</strong>
                <span>{statusLabel(download.status)}</span>
              </div>
              <div className="browser-download-progress">
                <span style={{ width: `${progress ?? (download.status === "completed" ? 100 : 12)}%` }}/>
              </div>
              <small>
                {formatBytes(download.receivedBytes)}
                {download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ""}
              </small>
              <code title={download.relativePath}>{download.relativePath}</code>
            </article>);
        })}
      </div>
    </aside>);
}
function DownloadStatus({ status }: Pick<ManagedBrowserDownload, "status">) {
    if (status === "completed")
        return <CheckCircle2 size={14}/>;
    if (status === "paused")
        return <CirclePause size={14}/>;
    if (status === "progressing")
        return <LoaderCircle className="spin" size={14}/>;
    return <X size={14}/>;
}
function statusLabel(status: ManagedBrowserDownload["status"]): string {
    if (status === "progressing")
        return tr("ui.327d59b5bd11");
    if (status === "paused")
        return tr("ui.fcbae46bf890");
    if (status === "completed")
        return tr("ui.e99b48a29bdf");
    if (status === "cancelled")
        return tr("ui.a5ffdc95eeb0");
    return tr("ui.8dd5ad764e4b");
}
function formatBytes(value: number): string {
    if (value < 1024)
        return `${value} B`;
    if (value < 1048576)
        return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1073741824)
        return `${(value / 1048576).toFixed(1)} MB`;
    return `${(value / 1073741824).toFixed(1)} GB`;
}
