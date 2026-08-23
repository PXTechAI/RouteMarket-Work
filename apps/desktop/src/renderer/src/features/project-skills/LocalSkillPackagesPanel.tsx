import { Archive, CircleAlert, FileCode2, FileUp, FolderInput, LoaderCircle, PackagePlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LocalSkillImportKind, LocalSkillInstallReceipt } from "../../../../shared/desktop-api";
import { tr } from "../../i18n";
import type { ProjectSkillManagerActions } from "./ProjectSkillsPanel";
import { skillReceiptStatusCopy } from "./ProjectSkillsPanel";

export function LocalSkillPackagesPanel({ actions, projectName }: {
  actions: ProjectSkillManagerActions | null;
  projectName: string | null;
}) {
  const [items, setItems] = useState<LocalSkillInstallReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!actions) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await actions.list());
    } catch (nextError) {
      setError(messageOf(nextError, tr("settings.extensions.localSkills.readError")));
    } finally {
      setLoading(false);
    }
  }, [actions?.localProjectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function install(importKind: LocalSkillImportKind) {
    if (!actions) return;
    setBusySkillId(`install:${importKind}`);
    setError(null);
    try {
      const installed = await actions.install(importKind);
      if (!installed) return;
      await Promise.all([refresh(), actions.onChanged()]);
    } catch (nextError) {
      setError(messageOf(nextError, tr("settings.extensions.localSkills.installError")));
    } finally {
      setBusySkillId(null);
    }
  }

  async function remove(item: LocalSkillInstallReceipt) {
    if (!actions) return;
    setBusySkillId(item.skillId);
    setError(null);
    try {
      if (!await actions.remove(item.skillId)) return;
      await Promise.all([refresh(), actions.onChanged()]);
    } catch (nextError) {
      setError(messageOf(nextError, tr("settings.extensions.localSkills.removeError")));
    } finally {
      setBusySkillId(null);
    }
  }

  return (
    <section className="local-skill-packages">
      <header>
        <div>
          <span><Archive size={18}/></span>
          <div>
            <strong>{tr("settings.extensions.localSkills.title")}</strong>
            <p>{actions
              ? tr("settings.extensions.localSkills.projectScope", [projectName ?? actions.localProjectId])
              : tr("settings.extensions.localSkills.noProject")}</p>
          </div>
        </div>
        <div className="local-skill-import-actions" role="group" aria-label={tr("settings.extensions.localSkills.importLabel")}>
          <button className="secondary-button" type="button" disabled={!actions || busySkillId !== null} onClick={() => void install("markdown")}>
            {busySkillId === "install:markdown" ? <LoaderCircle className="spin" size={14}/> : <FileUp size={14}/>}
            {tr("settings.extensions.localSkills.importMarkdown")}
          </button>
          <button className="secondary-button" type="button" disabled={!actions || busySkillId !== null} onClick={() => void install("directory")}>
            {busySkillId === "install:directory" ? <LoaderCircle className="spin" size={14}/> : <FolderInput size={14}/>}
            {tr("settings.extensions.localSkills.importDirectory")}
          </button>
          <button className="primary-button" type="button" disabled={!actions || busySkillId !== null} onClick={() => void install("archive")}>
            {busySkillId === "install:archive" ? <LoaderCircle className="spin" size={14}/> : <PackagePlus size={14}/>}
            {tr("settings.extensions.localSkills.installZip")}
          </button>
        </div>
      </header>

      <div className="local-skill-packages-note">
        {tr("settings.extensions.localSkills.note")}
      </div>

      {error && <div className="local-skill-packages-error" role="alert"><CircleAlert size={15}/><span>{error}</span></div>}

      <div className="local-skill-packages-list">
        {loading ? (
          <div className="local-skill-packages-empty"><LoaderCircle className="spin" size={20}/>{tr("settings.extensions.localSkills.loading")}</div>
        ) : items.length ? items.map((item) => (
          <article key={item.skillId} className={item.status}>
            <span className="local-skill-package-icon"><FileCode2 size={17}/></span>
            <div>
              <div className="local-skill-package-title">
                <strong>{item.name}</strong>
                <code>{item.skillId}@{item.version}</code>
                <span className={`project-skill-status ${item.status}`}>{skillReceiptStatusCopy(item.status)}</span>
              </div>
              <p>{item.description || tr("settings.extensions.localSkills.noDescription")}</p>
              <small>{tr("settings.extensions.localSkills.source", [item.sourceLabel])}</small>
            </div>
            {item.managed ? (
              <button className="danger-icon-button" type="button" title={tr("settings.extensions.localSkills.remove")} disabled={busySkillId !== null || item.status === "modified"} onClick={() => void remove(item)}>
                {busySkillId === item.skillId ? <LoaderCircle className="spin" size={14}/> : <Trash2 size={14}/>}
              </button>
            ) : null}
          </article>
        )) : (
          <div className="local-skill-packages-empty"><Archive size={23}/><strong>{tr("settings.extensions.localSkills.empty")}</strong><p>{tr("settings.extensions.localSkills.emptyDescription")}</p></div>
        )}
      </div>
    </section>
  );
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}
