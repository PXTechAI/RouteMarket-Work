import { tr } from "../../i18n";
import "./project-skills.scss";
import { Archive, CircleAlert, FileCode2, LoaderCircle, PackagePlus, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DownloadableCloudSkill, LocalSkillImportKind, LocalSkillInstallReceipt } from "../../../../shared/desktop-api";
export type ProjectSkillManagerActions = {
    localProjectId: string;
    list(): Promise<LocalSkillInstallReceipt[]>;
    listCloud(): Promise<DownloadableCloudSkill[]>;
    install(importKind: LocalSkillImportKind): Promise<LocalSkillInstallReceipt | null>;
    installCloud(skillId: string, versionId: string): Promise<LocalSkillInstallReceipt>;
    remove(skillId: string): Promise<boolean>;
    onChanged(): Promise<void>;
};
export function ProjectSkillsPanel({ actions }: {
    actions: ProjectSkillManagerActions | null;
}) {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<LocalSkillInstallReceipt[]>([]);
    const [cloudItems, setCloudItems] = useState<DownloadableCloudSkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [busySkillId, setBusySkillId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cloudError, setCloudError] = useState<string | null>(null);
    const refresh = useCallback(async () => {
        if (!actions)
            return;
        setLoading(true);
        setError(null);
        setCloudError(null);
        try {
            const [localResult, cloudResult] = await Promise.allSettled([
                actions.list(),
                actions.listCloud()
            ]);
            if (localResult.status === "rejected")
                throw localResult.reason;
            setItems(localResult.value);
            if (cloudResult.status === "fulfilled") {
                setCloudItems(cloudResult.value);
            }
            else {
                setCloudItems([]);
                setCloudError(tr("ui.8d61416ada5f"));
            }
        }
        catch (nextError) {
            setError(messageOf(nextError, tr("ui.5cee101cc68f")));
        }
        finally {
            setLoading(false);
        }
    }, [actions?.localProjectId]);
    useEffect(() => {
        if (open)
            void refresh();
    }, [open, refresh]);
    useEffect(() => {
        if (!open)
            return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape")
                setOpen(false);
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);
    async function install() {
        if (!actions)
            return;
        setBusySkillId("install");
        setError(null);
        try {
            const installed = await actions.install("archive");
            if (!installed)
                return;
            await Promise.all([refresh(), actions.onChanged()]);
        }
        catch (nextError) {
            setError(messageOf(nextError, tr("ui.36b4d4e3b11b")));
        }
        finally {
            setBusySkillId(null);
        }
    }
    async function remove(item: LocalSkillInstallReceipt) {
        if (!actions)
            return;
        setBusySkillId(item.skillId);
        setError(null);
        try {
            if (!await actions.remove(item.skillId))
                return;
            await Promise.all([refresh(), actions.onChanged()]);
        }
        catch (nextError) {
            setError(messageOf(nextError, tr("ui.b1f634c81aa5")));
        }
        finally {
            setBusySkillId(null);
        }
    }
    async function installCloud(item: DownloadableCloudSkill) {
        if (!actions)
            return;
        setBusySkillId(`cloud:${item.skillId}`);
        setError(null);
        try {
            await actions.installCloud(item.skillId, item.versionId);
            await Promise.all([refresh(), actions.onChanged()]);
        }
        catch (nextError) {
            setError(messageOf(nextError, tr("ui.5daec9bf8888")));
        }
        finally {
            setBusySkillId(null);
        }
    }
    return (<>
      <button className="project-skill-manager-trigger" type="button" disabled={!actions} title={actions ? tr("ui.c3bb3a68ebd4") : tr("ui.3b577e27347f")} onClick={() => setOpen(true)}>
        <Archive size={13}/>{tr("ui.4b4d787d31f1")}</button>
      {open && typeof document !== "undefined" && createPortal(<div className="project-skill-manager-backdrop" role="presentation" onMouseDown={(event) => {
                if (event.target === event.currentTarget)
                    setOpen(false);
            }}>
          <section className="project-skill-manager" role="dialog" aria-modal="true" aria-labelledby="project-skill-manager-title">
            <header>
              <div>
                <span className="project-skill-manager-icon"><Archive size={18}/></span>
                <div>
                  <h2 id="project-skill-manager-title">{tr("ui.c6762fb3df84")}</h2>
                  <p>{tr("ui.a2c4b40b110a")}</p>
                </div>
              </div>
              <button className="icon-button" type="button" title={tr("ui.6c14bd7f6f9e")} onClick={() => setOpen(false)}>
                <X size={16}/>
              </button>
            </header>

            <div className="project-skill-safety-note">
              <ShieldCheck size={17}/>
              <span>{tr("ui.feba8be3859c")}</span>
            </div>

            <div className="project-skill-manager-toolbar">
              <div>
                <strong>{items.length}{tr("ui.7cf2f73f2b38")}</strong>
                <small>{tr("ui.ce3a57eeaa26")}</small>
              </div>
              <button className="primary-button" type="button" disabled={!actions || busySkillId !== null} onClick={() => void install()}>
                {busySkillId === "install"
                ? <LoaderCircle className="spin" size={14}/>
                : <PackagePlus size={14}/>}{tr("ui.675230f7aeed")}</button>
            </div>

            <div className="project-skill-manager-list">
              {loading ? (<div className="project-skill-manager-empty">
                  <LoaderCircle className="spin" size={20}/>{tr("ui.d6c116020864")}</div>) : (<>
                  <div className="project-skill-cloud-section">
                    <div>
                      <strong>{tr("ui.a98a78265973")}</strong>
                      <small>{tr("ui.1aee4c7513c9")}</small>
                    </div>
                    {cloudItems.length ? (<div className="project-skill-cloud-list">
                        {cloudItems.map((item) => {
                        const installed = isCloudSkillInstalled(items, item);
                        return (<article key={item.versionId}>
                              <div>
                                <strong>{item.name}</strong>
                                <small>{item.skillId}@{item.version}</small>
                                <p>{item.description}</p>
                              </div>
                              <button className="secondary-button" type="button" disabled={installed || busySkillId !== null} onClick={() => void installCloud(item)}>
                                {busySkillId === `cloud:${item.skillId}`
                                ? <LoaderCircle className="spin" size={13}/>
                                : <PackagePlus size={13}/>}
                                {installed ? tr("ui.eb88ff57c977") : tr("ui.7df4966272cc")}
                              </button>
                            </article>);
                    })}
                      </div>) : (<p className="project-skill-cloud-empty">
                        {cloudError ?? tr("ui.f5566cf73c83")}
                      </p>)}
                  </div>
                  <div className="project-skill-local-heading">
                    <strong>{tr("ui.727eeaa0f752")}</strong>
                    <small>{tr("ui.cbc757be5f09")}</small>
                  </div>
                  {items.length ? items.map((item) => (<article key={item.skillId} className={`project-skill-card ${item.status}`}>
                  <span className="project-skill-card-icon"><FileCode2 size={17}/></span>
                  <div className="project-skill-card-body">
                    <div className="project-skill-card-heading">
                      <div>
                        <strong>{item.name}</strong>
                        <code>{item.skillId}@{item.version}</code>
                      </div>
                      <span className={`project-skill-status ${item.status}`}>
                        {skillReceiptStatusCopy(item.status)}
                      </span>
                    </div>
                    <p>{item.description || tr("ui.3971c95645ed")}</p>
                    <dl>
                      <div>
                        <dt>{tr("ui.c63f79e6361e")}</dt>
                        <dd>{item.source === "web_library"
                        ? tr("ui.9911e0b282f5", [item.sourceLabel]) : item.source === "local_archive"
                        ? tr("ui.eb6fd5bbdea6", [item.sourceLabel]) : tr("ui.6e6f05f81646")}</dd>
                      </div>
                      <div>
                        <dt>{tr("ui.46d4c1b4e4be")}</dt>
                        <dd><code>{digestLabel(item.currentPackageDigest ?? item.packageDigest)}</code></dd>
                      </div>
                      <div>
                        <dt>{tr("ui.560165a6d758")}</dt>
                        <dd>{item.permissions.length
                        ? item.permissions.map(permissionCopy).join("、")
                        : tr("ui.4fa238384244")}</dd>
                      </div>
                    </dl>
                    {item.status === "modified" && (<div className="project-skill-card-warning">
                        <CircleAlert size={14}/>{tr("ui.6dfbe2f4ca6b")}</div>)}
                  </div>
                  {item.managed ? (<button className="danger-icon-button" type="button" title={item.status === "modified"
                            ? tr("ui.1292212f71b6") : tr("ui.7a65c31ea79b")} disabled={busySkillId !== null || item.status === "modified"} onClick={() => void remove(item)}>
                      {busySkillId === item.skillId
                            ? <LoaderCircle className="spin" size={14}/>
                            : <Trash2 size={14}/>}
                    </button>) : (<span className="project-skill-local-badge">{tr("ui.a0be294e1416")}</span>)}
                </article>)) : (<div className="project-skill-manager-empty">
                      <Archive size={24}/>
                      <strong>{tr("ui.b3a3314aa1c7")}</strong>
                      <span>{tr("ui.06d248f66286")}</span>
                    </div>)}
                </>)}
            </div>

            {error && (<div className="project-skill-manager-error" role="alert">
                <CircleAlert size={16}/>
                <span>{error}</span>
              </div>)}
          </section>
        </div>, document.body)}
    </>);
}
export function skillReceiptStatusCopy(status: LocalSkillInstallReceipt["status"]): string {
    if (status === "ready")
        return tr("ui.15e3d55c2675");
    if (status === "modified")
        return tr("ui.8e91bc17a741");
    if (status === "missing")
        return tr("ui.36b8d79933b5");
    return tr("ui.bb49b7a20843");
}
export function isCloudSkillInstalled(localItems: LocalSkillInstallReceipt[], cloudItem: DownloadableCloudSkill): boolean {
    return localItems.some((local) => local.skillId === cloudItem.skillId &&
        local.version === cloudItem.version &&
        local.status === "ready");
}
function digestLabel(value: string): string {
    return value ? `${value.slice(0, 19)}…` : tr("ui.5dbd015496af");
}
function permissionCopy(value: string): string {
    if (value === "project.read")
        return tr("ui.1a8deee99601");
    if (value === "project.write")
        return tr("ui.c25ee8b73838");
    if (value === "network")
        return tr("ui.cb959df3bf4a");
    if (value === "process")
        return tr("ui.45d07a9509f8");
    if (value === "external_apps")
        return tr("ui.1b3239ffe22e");
    return value;
}
function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}
