import { FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";

export function ProjectCreateDialog({
  open,
  busy,
  onClose,
  onCreate
}: {
  open: boolean;
  busy: boolean;
  onClose(): void;
  onCreate(name: string, attachFolder: boolean): void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  if (!open) return null;
  const normalizedName = name.trim();

  return (
    <div className="project-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="project-dialog-title">创建项目</h2>
            <p>可以先聊天，之后再关联本机文件夹。</p>
          </div>
          <button type="button" title="关闭" disabled={busy} onClick={onClose}><X size={17} /></button>
        </header>
        <label>
          <span>项目名称</span>
          <input
            autoFocus
            maxLength={120}
            value={name}
            placeholder="例如：新品发布计划"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && normalizedName && !busy) onCreate(normalizedName, false);
              if (event.key === "Escape" && !busy) onClose();
            }}
          />
        </label>
        <footer>
          <button className="secondary-button" type="button" disabled={!normalizedName || busy} onClick={() => onCreate(normalizedName, true)}>
            <FolderPlus size={15} />创建并关联文件夹
          </button>
          <button className="primary-button" type="button" disabled={!normalizedName || busy} onClick={() => onCreate(normalizedName, false)}>
            {busy ? "创建中…" : "创建项目"}
          </button>
        </footer>
      </section>
    </div>
  );
}
