import "./project-dialog.scss";
import { FolderPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSummary } from "../../../../shared/desktop-api";
import { AppDialog } from "../../app/AppDialog";
import { tr } from "../../i18n";

export function ProjectEditDialog({ project, busy, onClose, onSave, onAttachFolder, onRemoveFolder, onRemove }: {
  project: ProjectSummary | null;
  busy: boolean;
  onClose(): void;
  onSave(name: string): void;
  onAttachFolder(): void;
  onRemoveFolder(folderId: string): void;
  onRemove(): void;
}) {
  const [name, setName] = useState("");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  useEffect(() => {
    setName(project?.displayName ?? "");
    setConfirmingRemoval(false);
  }, [project?.localProjectId]);
  if (!project) return null;
  const normalizedName = name.trim();
  const folders = project.folders ?? [];

  if (confirmingRemoval) {
    return <AppDialog title={tr("project.removeConfirmTitle")} description={project.displayName} width="small" onClose={() => { if (!busy) setConfirmingRemoval(false); }} footer={<><button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmingRemoval(false)}>{tr("project.cancel")}</button><button className="app-dialog-danger-button" type="button" disabled={busy} onClick={onRemove}><Trash2 size={14}/>{tr("project.remove")}</button></>}>
      <div className="app-dialog-danger-copy">{tr("project.removeConfirmDescription")}</div>
    </AppDialog>;
  }

  return <AppDialog title={tr("project.edit")} width="large" className="project-edit-dialog" onClose={onClose} footer={<><button className="project-remove-button" type="button" disabled={busy} onClick={() => setConfirmingRemoval(true)}><Trash2 size={15}/>{tr("project.remove")}</button><span className="project-edit-footer-spacer"/><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{tr("project.cancel")}</button><button className="primary-button" type="button" disabled={!normalizedName || busy} onClick={() => onSave(normalizedName)}>{tr("project.save")}</button></>}>
    <label className="app-dialog-field">
      <span>{tr("project.name")}</span>
      <input className="app-dialog-input" autoFocus maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && normalizedName && !busy) onSave(normalizedName);
      }}/>
    </label>
    <section className="project-local-folders" aria-labelledby="project-local-folders-title">
      <div className="project-local-folders-heading">
        <div><strong id="project-local-folders-title">{tr("project.sourceFolder")}</strong><p>{tr("project.localFoldersDescription")}</p></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={onAttachFolder}><FolderPlus size={15}/>{tr("project.addFolder")}</button>
      </div>
      <div className="project-local-folder-list">
        {folders.map((folder) => <div className="project-local-folder" key={folder.folderId}>
          <div><strong>{folder.name}</strong><span title={folder.path}>{folder.path}</span></div>
          <button type="button" disabled={busy} title={tr("project.removeFolder")} aria-label={`${tr("project.removeFolder")} ${folder.name}`} onClick={() => onRemoveFolder(folder.folderId)}><Trash2 size={15}/></button>
        </div>)}
        {folders.length === 0 && <div className="project-local-folders-empty">{tr("project.noFolder")}</div>}
      </div>
    </section>
  </AppDialog>;
}
