import { tr } from "../../i18n";
import { FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
export function ProjectCreateDialog({ open, busy, onClose, onCreate }: {
    open: boolean;
    busy: boolean;
    onClose(): void;
    onCreate(name: string, attachFolder: boolean): void;
}) {
    const [name, setName] = useState("");
    useEffect(() => {
        if (open)
            setName("");
    }, [open]);
    if (!open)
        return null;
    const normalizedName = name.trim();
    return (<div className="project-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="project-dialog-title">{tr("ui.80f5dfd187ff")}</h2>
            <p>{tr("ui.fcb77a7bb574")}</p>
          </div>
          <button type="button" title={tr("ui.6c14bd7f6f9e")} disabled={busy} onClick={onClose}><X size={17}/></button>
        </header>
        <label>
          <span>{tr("ui.3e7255522b33")}</span>
          <input autoFocus maxLength={120} value={name} placeholder={tr("ui.8b18b6f690a9")} disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && normalizedName && !busy)
                onCreate(normalizedName, false);
            if (event.key === "Escape" && !busy)
                onClose();
        }}/>
        </label>
        <footer>
          <button className="secondary-button" type="button" disabled={!normalizedName || busy} onClick={() => onCreate(normalizedName, true)}>
            <FolderPlus size={15}/>{tr("ui.5f947d0c1c92")}</button>
          <button className="primary-button" type="button" disabled={!normalizedName || busy} onClick={() => onCreate(normalizedName, false)}>
            {busy ? tr("ui.1680b04bf67f") : tr("ui.80f5dfd187ff")}
          </button>
        </footer>
      </section>
    </div>);
}
