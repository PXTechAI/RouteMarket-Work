import { tr } from "../../i18n";
import { ChevronLeft, ChevronRight, FolderOpen, PackageOpen, ShieldCheck } from "lucide-react";
import type { ProjectArtifactPreview } from "../../../../shared/desktop-api";
import { WorkspaceState } from "../../app/WorkspaceState";
import "./artifact-preview.scss";
export function ArtifactPreview({
  preview,
  selectedFilePath,
  exportBusy,
  onExport,
  onSelectSheet,
  onSelectPdfPage,
}: {
  preview: ProjectArtifactPreview;
  selectedFilePath: string | null;
  exportBusy: boolean;
  onExport(): void;
  onSelectSheet(sheetId: string): void;
  onSelectPdfPage(pageNumber: number): void;
}) {
  const details =
    preview.kind === "unavailable"
      ? viewerLabel(preview.providerId)
      : `${preview.mimeType} · ${preview.bytesRead} bytes${preview.kind === "table" && preview.truncated ? tr("ui.61c54972d507") : ""}`;
  return (
    <article className="asset-preview">
      <div className="file-meta">
        <span>{preview.uri}</span>
        <div className="file-editor-actions">
          <span>{details}</span>
          <button className="secondary-button" type="button" disabled={exportBusy} onClick={onExport}>
            <FolderOpen size={13} />
            {tr("ui.188896795f1d")}
          </button>
        </div>
      </div>
      {preview.kind === "table" && <TablePreview preview={preview} onSelectSheet={onSelectSheet} />}
      {preview.kind === "pdf" && (
        <PdfPreview preview={preview} selectedFilePath={selectedFilePath} onSelectPage={onSelectPdfPage} />
      )}
      {preview.kind === "media" && (
        <div className="asset-preview-stage">
          {preview.mimeType.startsWith("image/") ? (
            <img src={preview.dataUrl} alt={selectedFilePath ?? tr("ui.5be49fff93a1")} />
          ) : preview.mimeType.startsWith("audio/") ? (
            <audio src={preview.dataUrl} controls />
          ) : preview.mimeType.startsWith("video/") ? (
            <video src={preview.dataUrl} controls />
          ) : null}
        </div>
      )}
      {preview.kind === "unavailable" && (
        <div className="artifact-unavailable">
          <WorkspaceState
            kind="empty"
            icon={<PackageOpen size={24} />}
            title={localizedUnavailableTitle(preview.viewerId)}
            description={localizedUnavailableReason(preview.viewerId)}
          />
        </div>
      )}
    </article>
  );
}
function PdfPreview({
  preview,
  selectedFilePath,
  onSelectPage,
}: {
  preview: Extract<
    ProjectArtifactPreview,
    {
      kind: "pdf";
    }
  >;
  selectedFilePath: string | null;
  onSelectPage(pageNumber: number): void;
}) {
  return (
    <div className="artifact-pdf-preview">
      <div className="artifact-pdf-toolbar">
        <span className="artifact-pdf-security">
          <ShieldCheck size={13} />
          {tr("pdf.preview.isolated")}
        </span>
        <div className="artifact-pdf-pagination">
          <button
            type="button"
            aria-label={tr("pdf.preview.previous")}
            disabled={preview.pageNumber <= 1}
            onClick={() => onSelectPage(preview.pageNumber - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>{tr("pdf.preview.page", [preview.pageNumber, preview.pageCount])}</span>
          <button
            type="button"
            aria-label={tr("pdf.preview.next")}
            disabled={preview.pageNumber >= preview.pageCount}
            onClick={() => onSelectPage(preview.pageNumber + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="artifact-pdf-stage">
        <img
          src={preview.dataUrl}
          width={preview.width}
          height={preview.height}
          alt={tr("pdf.preview.alt", [selectedFilePath ?? "PDF", preview.pageNumber])}
        />
      </div>
    </div>
  );
}
function TablePreview({
  preview,
  onSelectSheet,
}: {
  preview: Extract<
    ProjectArtifactPreview,
    {
      kind: "table";
    }
  >;
  onSelectSheet(sheetId: string): void;
}) {
  return (
    <div className="artifact-table-preview">
      {preview.sheets && preview.sheets.length > 0 && (
        <div className="artifact-sheet-tabs" role="tablist" aria-label={tr("ui.f5808491e5c4")}>
          {preview.sheets.map((sheet) => (
            <button
              key={sheet.id}
              role="tab"
              type="button"
              aria-selected={sheet.id === preview.activeSheetId}
              className={sheet.id === preview.activeSheetId ? "active" : ""}
              onClick={() => onSelectSheet(sheet.id)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      {preview.rows.length === 0 ? (
        <div className="artifact-unavailable">
          <WorkspaceState kind="empty" title={tr("ui.c12fa40f90b1")} description={tr("ui.79c00ad53b04")} />
        </div>
      ) : (
        <div className="artifact-table-stage">
          <table className="artifact-table">
            <thead>
              <tr>
                <th className="artifact-row-number" scope="col">
                  #
                </th>
                {Array.from({ length: preview.columnCount }, (_, index) => (
                  <th key={index} scope="col">
                    {columnLabel(index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="artifact-row-number" scope="row">
                    {rowIndex + 1}
                  </th>
                  {Array.from({ length: preview.columnCount }, (_, columnIndex) => (
                    <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
function viewerLabel(
  providerId: Extract<
    ProjectArtifactPreview,
    {
      kind: "unavailable";
    }
  >["providerId"],
): string {
  return providerId === "ai.routemarket.pdf" ? tr("ui.c03fc59fec3a") : tr("ui.b6294ad3e953");
}
function localizedUnavailableTitle(
  viewerId: Extract<
    ProjectArtifactPreview,
    {
      kind: "unavailable";
    }
  >["viewerId"],
): string {
  return viewerId === "pdf.viewer" ? tr("ui.9fdd7a068b2c") : tr("ui.05d635d52a98");
}
function localizedUnavailableReason(
  viewerId: Extract<
    ProjectArtifactPreview,
    {
      kind: "unavailable";
    }
  >["viewerId"],
): string {
  return viewerId === "pdf.viewer" ? tr("ui.26277472210a") : tr("ui.284bf3eda243");
}
