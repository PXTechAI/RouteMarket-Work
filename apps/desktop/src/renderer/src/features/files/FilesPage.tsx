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
  X
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  ProjectAssetPreview,
  ProjectFileEntry,
  ProjectFileTree,
  ProjectSearchResult,
  ProjectSummary,
  ReadResult
} from "../../../../shared/desktop-api";

export interface FilesPageModel {
  selectedProject: ProjectSummary | null;
  projectFiles: ProjectFileTree | null;
  treeLoading: boolean;
  searchQuery: string;
  searchResult: ProjectSearchResult | null;
  searching: boolean;
  selectedFilePath: string | null;
  readResult: ReadResult | null;
  assetPreview: ProjectAssetPreview | null;
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
  onExportFile(): void;
  onOpenVersions(): void;
  onReviewChanges(): void;
  onDraftChange(value: string): void;
  onDismissError(): void;
}

export function FilesPage({
  model,
  actions
}: {
  model: FilesPageModel;
  actions: FilesPageActions;
}) {
  return (
    <section className="rm-files-page">
      <ProjectFileNavigator model={model} actions={actions} />
      <div className="document-pane">
        {!model.selectedProject && (
          <div className="blank-state">
            <div className="blank-icon"><FolderPlus size={28} /></div>
            <h2>选择一个已关联文件夹的项目</h2>
            <button className="primary-button" type="button" onClick={actions.onChooseProject}>
              <FolderPlus size={16} />
              选择文件夹
            </button>
          </div>
        )}
        {model.selectedProject && !model.readResult && !model.assetPreview && !model.loading && (
          <div className="ready-state">
            <FileText size={30} />
            <h2>{model.selectedFilePath ?? "从左侧选择项目文件"}</h2>
          </div>
        )}
        {model.loading && (
          <div className="ready-state">
            <LoaderCircle className="spin" size={30} />
            <h2>正在读取 {model.selectedFilePath}</h2>
          </div>
        )}
        {model.assetPreview && (
          <article className="asset-preview">
            <div className="file-meta">
              <span>{model.assetPreview.uri}</span>
              <div className="file-editor-actions">
                <span>{model.assetPreview.mimeType} · {model.assetPreview.bytesRead} bytes</span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={model.fileVersionBusy}
                  onClick={actions.onExportFile}
                >
                  <FolderOpen size={13} />导出
                </button>
              </div>
            </div>
            <div className="asset-preview-stage">
              {model.assetPreview.mimeType.startsWith("image/") ? (
                <img src={model.assetPreview.dataUrl} alt={model.selectedFilePath ?? "项目素材"} />
              ) : model.assetPreview.mimeType.startsWith("audio/") ? (
                <audio src={model.assetPreview.dataUrl} controls />
              ) : model.assetPreview.mimeType.startsWith("video/") ? (
                <video src={model.assetPreview.dataUrl} controls />
              ) : (
                <iframe
                  src={model.assetPreview.dataUrl}
                  title={model.selectedFilePath ?? "PDF 预览"}
                />
              )}
            </div>
          </article>
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
                  <RefreshCw size={13} />历史
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={model.fileVersionBusy || model.newFileDraft}
                  onClick={actions.onExportFile}
                >
                  <FolderOpen size={13} />导出
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={model.savingFile || !model.hasFileChanges}
                  onClick={actions.onReviewChanges}
                >
                  {model.savingFile
                    ? <LoaderCircle className="spin" size={15} />
                    : <Save size={15} />}
                  {model.newFileDraft ? "创建" : "保存"}
                </button>
              </div>
            </div>
            <textarea
              className="file-editor"
              value={model.fileDraft}
              spellCheck={false}
              aria-label={`编辑 ${model.selectedFilePath ?? "项目文件"}`}
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
            <button type="button" title="关闭" onClick={actions.onDismissError}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectFileNavigator({
  model,
  actions
}: {
  model: FilesPageModel;
  actions: FilesPageActions;
}) {
  return (
    <aside className="rm-file-navigator">
      <div className="rm-file-navigator-header">
        <div>
          <strong>项目文件</strong>
          <span>{model.selectedProject?.displayName ?? "未选择项目"}</span>
        </div>
        <div className="rm-file-navigator-actions">
          <button
            className="rm-icon-button"
            type="button"
            title="新建文件"
            disabled={!model.selectedProject}
            onClick={actions.onCreateFile}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="rm-icon-button"
            type="button"
            title="刷新文件"
            disabled={!model.selectedProject || model.treeLoading}
            onClick={actions.onRefreshFiles}
          >
            {model.treeLoading
              ? <LoaderCircle className="spin" size={14} />
              : <RefreshCw size={14} />}
          </button>
        </div>
      </div>
      <label className="rm-file-navigator-search">
        <Search size={14} />
        <input
          value={model.searchQuery}
          placeholder="搜索当前项目"
          aria-label="搜索当前项目文件和内容"
          onChange={(event) => actions.onSearch(event.target.value)}
        />
        {model.searching && <LoaderCircle className="spin" size={13} />}
        {model.searchQuery && !model.searching && (
          <button type="button" title="清除搜索" onClick={() => actions.onSearch("")}>
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
                <strong>{match.relativePath}{match.line ? `:${match.line}` : ""}</strong>
                <span>{match.preview}</span>
              </button>
            ))}
            {model.searchResult.matches.length === 0 && (
              <FileNavigatorState icon={<Search size={17} />} label="没有匹配结果" />
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
            <FileNavigatorState icon={<Folder size={18} />} label="空项目" />
          )}
        {!model.selectedProject && (
          <FileNavigatorState icon={<Folder size={18} />} label="未选择项目" />
        )}
      </div>
      <div className="rm-file-navigator-footer">
        <span>{model.projectFiles ? `${model.projectFiles.totalEntries} 项` : ""}</span>
        {model.projectFiles?.truncated && <span>已截断</span>}
      </div>
    </aside>
  );
}

function FileNavigatorState({
  icon,
  label
}: {
  icon: ReactNode;
  label?: string;
}) {
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
  onSelect
}: {
  entries: ProjectFileEntry[];
  selectedPath: string | null;
  onSelect(relativePath: string): void;
}) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeRow
          key={entry.relativePath}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function FileTreeRow({
  entry,
  depth,
  selectedPath,
  onSelect
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
        {isDirectory
          ? expanded ? <FolderOpen size={15} /> : <Folder size={15} />
          : <File size={15} />}
        <span>{entry.name}</span>
      </button>
      {isDirectory && expanded && entry.children?.map((child) => (
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
