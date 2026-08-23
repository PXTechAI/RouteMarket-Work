import { tr } from "../../i18n";
import "./files.scss";
import "./file-content.scss";
import {
  ChevronRight,
  CircleAlert,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  ProjectArtifactPreview,
  ProjectFileEntry,
  ProjectFileTree,
  ProjectSearchResult,
  ProjectSummary,
  ReadResult,
} from "../../../../shared/desktop-api";
import { WorkspaceState } from "../../app/WorkspaceState";
import { ArtifactPreview } from "./ArtifactPreview";
export interface FilesPageModel {
  selectedProject: ProjectSummary | null;
  navigatorTitle?: string;
  navigatorSubtitle?: string;
  projectFiles: ProjectFileTree | null;
  treeLoading: boolean;
  searchQuery: string;
  searchResult: ProjectSearchResult | null;
  searching: boolean;
  selectedFilePath: string | null;
  readResult: ReadResult | null;
  assetPreview: ProjectArtifactPreview | null;
  fileDraft: string;
  loading: boolean;
  savingFile: boolean;
  fileVersionBusy: boolean;
  newFileDraft: boolean;
  hasFileChanges: boolean;
  error: string | null;
}
export interface FilesPageActions {
  onChooseProject(): void;
  onRefreshFiles(): void;
  onCreateFile(): void;
  onSearch(query: string): void;
  onSelectFile(relativePath: string): void;
  onSelectSheet(sheetId: string): void;
  onSelectPdfPage(pageNumber: number): void;
  onExportFile(): void;
  onOpenVersions(): void;
  onReviewChanges(): void;
  onDraftChange(value: string): void;
  onDismissError(): void;
}
export function FilesPage({ model, actions }: { model: FilesPageModel; actions: FilesPageActions }) {
  return (
    <section className="rm-files-page">
      <ProjectFileNavigator model={model} actions={actions} />
      <div className="document-pane">
        {!model.selectedProject && (
          <WorkspaceState
            kind="empty"
            icon={<FolderPlus size={24} />}
            title={tr("ui.bd77bb05df82")}
            description={tr("ui.8924603ef390")}
            action={
              <button className="primary-button" type="button" onClick={actions.onChooseProject}>
                <FolderPlus size={16} />
                {tr("ui.ed358091bc9c")}
              </button>
            }
          />
        )}
        {model.selectedProject && !model.readResult && !model.assetPreview && !model.loading && (
          <WorkspaceState
            kind="empty"
            icon={<FileText size={24} />}
            title={model.selectedFilePath ?? tr("ui.bcf75e6043b6")}
          />
        )}
        {model.loading && (
          <WorkspaceState
            kind="loading"
            title={tr("ui.248efa004f56", [model.selectedFilePath ?? tr("ui.bcf75e6043b6")])}
          />
        )}
        {model.assetPreview && (
          <ArtifactPreview
            preview={model.assetPreview}
            selectedFilePath={model.selectedFilePath}
            exportBusy={model.fileVersionBusy}
            onExport={actions.onExportFile}
            onSelectSheet={actions.onSelectSheet}
            onSelectPdfPage={actions.onSelectPdfPage}
          />
        )}
        {model.readResult && (
          <article className="readme-view">
            <div className="file-meta">
              <span>{model.readResult.uri}</span>
              <div className="file-editor-actions">
                <span>{model.readResult.bytesRead} bytes</span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={model.fileVersionBusy || model.newFileDraft}
                  onClick={actions.onOpenVersions}
                >
                  <RefreshCw size={13} />
                  {tr("ui.be78b2058534")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={model.fileVersionBusy || model.newFileDraft}
                  onClick={actions.onExportFile}
                >
                  <FolderOpen size={13} />
                  {tr("ui.188896795f1d")}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={model.savingFile || !model.hasFileChanges}
                  onClick={actions.onReviewChanges}
                >
                  {model.savingFile ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                  {model.newFileDraft ? tr("ui.fcbd0932929e") : tr("ui.fadf24dbc5a9")}
                </button>
              </div>
            </div>
            <textarea
              className="file-editor"
              value={model.fileDraft}
              spellCheck={false}
              aria-label={tr("ui.77e8292fc61d", [model.selectedFilePath ?? tr("ui.bcf75e6043b6")])}
              onChange={(event) => actions.onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  actions.onReviewChanges();
                }
              }}
            />
          </article>
        )}
        {model.error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={18} />
            <span>{model.error}</span>
            <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={actions.onDismissError}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
function ProjectFileNavigator({ model, actions }: { model: FilesPageModel; actions: FilesPageActions }) {
  return (
    <aside className="rm-file-navigator">
      <div className="rm-file-navigator-header">
        <div>
          <strong>{model.navigatorTitle ?? tr("ui.2b6b5d89b5fb")}</strong>
          <span>{model.navigatorSubtitle ?? model.selectedProject?.displayName ?? tr("ui.2e2bb61ef72f")}</span>
        </div>
        <div className="rm-file-navigator-actions">
          <button
            className="rm-icon-button"
            type="button"
            title={tr("ui.d4526eb925c9")}
            disabled={!model.selectedProject}
            onClick={actions.onCreateFile}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="rm-icon-button"
            type="button"
            title={tr("ui.ab6784a28338")}
            disabled={!model.selectedProject || model.treeLoading}
            onClick={actions.onRefreshFiles}
          >
            {model.treeLoading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>
      <label className="rm-file-navigator-search">
        <Search size={14} />
        <input
          value={model.searchQuery}
          placeholder={tr("ui.2a76936195bd")}
          aria-label={tr("ui.82c10888393c")}
          onChange={(event) => actions.onSearch(event.target.value)}
        />
        {model.searching && <LoaderCircle className="spin" size={13} />}
        {model.searchQuery && !model.searching && (
          <button type="button" title={tr("ui.318ea18eede5")} onClick={() => actions.onSearch("")}>
            <X size={13} />
          </button>
        )}
      </label>
      <div className="rm-file-navigator-tree">
        {model.searchQuery && model.searchResult && (
          <div className="rm-file-search-results">
            {model.searchResult.matches.map((match, index) => (
              <button
                key={`${match.relativePath}:${match.matchKind}:${match.line ?? 0}:${index}`}
                type="button"
                onClick={() => actions.onSelectFile(match.relativePath)}
              >
                <strong>
                  {match.relativePath}
                  {match.line ? `:${match.line}` : ""}
                </strong>
                <span>{match.preview}</span>
              </button>
            ))}
            {model.searchResult.matches.length === 0 && (
              <FileNavigatorState icon={<Search size={17} />} label={tr("ui.a5c9672e0e84")} />
            )}
          </div>
        )}
        {!model.searchQuery && model.projectFiles && model.projectFiles.entries.length > 0 && (
          <FileTree
            entries={model.projectFiles.entries}
            selectedPath={model.selectedFilePath}
            onSelect={actions.onSelectFile}
          />
        )}
        {!model.searchQuery && model.selectedProject && model.treeLoading && !model.projectFiles && (
          <FileNavigatorState icon={<LoaderCircle className="spin" size={18} />} />
        )}
        {!model.searchQuery &&
          model.selectedProject &&
          !model.treeLoading &&
          model.projectFiles?.entries.length === 0 && (
            <FileNavigatorState icon={<Folder size={18} />} label={tr("ui.5b3095e2a41d")} />
          )}
        {!model.selectedProject && <FileNavigatorState icon={<Folder size={18} />} label={tr("ui.2e2bb61ef72f")} />}
      </div>
      <div className="rm-file-navigator-footer">
        <span>{model.projectFiles ? tr("ui.2f9578aeadfd", [model.projectFiles.totalEntries]) : ""}</span>
        {model.projectFiles?.truncated && <span>{tr("ui.5e1fd797ca0e")}</span>}
      </div>
    </aside>
  );
}
function FileNavigatorState({ icon, label }: { icon: ReactNode; label?: string }) {
  return (
    <div className="rm-file-navigator-state">
      {icon}
      {label && <span>{label}</span>}
    </div>
  );
}
function FileTree({
  entries,
  selectedPath,
  onSelect,
}: {
  entries: ProjectFileEntry[];
  selectedPath: string | null;
  onSelect(relativePath: string): void;
}) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeRow key={entry.relativePath} entry={entry} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </>
  );
}
function FileTreeRow({
  entry,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: ProjectFileEntry;
  depth: number;
  selectedPath: string | null;
  onSelect(relativePath: string): void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDirectory = entry.kind === "directory";
  return (
    <div>
      <button
        className={`rm-file-navigator-row ${selectedPath === entry.relativePath ? "active" : ""}`}
        type="button"
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => {
          if (isDirectory) {
            setExpanded((current) => !current);
          } else {
            onSelect(entry.relativePath);
          }
        }}
      >
        <span className="rm-file-navigator-disclosure">
          {isDirectory && <ChevronRight className={expanded ? "expanded" : ""} size={12} />}
        </span>
        {isDirectory ? expanded ? <FolderOpen size={15} /> : <Folder size={15} /> : <File size={15} />}
        <span>{entry.name}</span>
      </button>
      {isDirectory &&
        expanded &&
        entry.children?.map((child) => (
          <FileTreeRow
            key={child.relativePath}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}
