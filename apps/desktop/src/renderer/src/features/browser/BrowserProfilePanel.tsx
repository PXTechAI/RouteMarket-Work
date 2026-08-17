import { tr } from "../../i18n";
import { Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ManagedBrowserProfile, ManagedBrowserProfileInput, ManagedBrowserState } from "../../../../shared/desktop-api";
type BrowserProfilePanelProps = {
    state: ManagedBrowserState;
    busy: boolean;
    onClose(): void;
    onCreate(input: ManagedBrowserProfileInput): void;
    onUpdate(profileId: string, input: ManagedBrowserProfileInput): void;
    onDelete(profileId: string): void;
};
export function BrowserProfilePanel({ state, busy, onClose, onCreate, onUpdate, onDelete }: BrowserProfilePanelProps) {
    const [selectedId, setSelectedId] = useState(state.activeProfileId);
    const [creating, setCreating] = useState(false);
    const selected = state.profiles.find((profile) => profile.profileId === selectedId)
        ?? state.profiles[0];
    const [draft, setDraft] = useState<ManagedBrowserProfileInput>(() => profileDraft(selected));
    useEffect(() => {
        if (creating)
            return;
        setDraft(profileDraft(selected));
    }, [creating, selected?.profileId, selected?.name, selected?.userAgent, selected?.proxyRules, selected?.proxyBypassRules]);
    function startCreate() {
        setCreating(true);
        setDraft({
            name: tr("ui.92487cd68fce"),
            userAgent: "",
            proxyRules: "",
            proxyBypassRules: "<local>",
            persistence: "persistent"
        });
    }
    return (<aside className="browser-profile-panel" aria-label={tr("ui.84aa25fe9b80")}>
      <header>
        <div>
          <strong>Browser Profiles</strong>
          <span>{tr("ui.dc318fab8cea")}</span>
        </div>
        <button type="button" title={tr("ui.7346c035697d")} onClick={onClose}><X size={15}/></button>
      </header>

      <div className="browser-profile-list">
        {state.profiles.map((profile) => (<button key={profile.profileId} className={!creating && profile.profileId === selected?.profileId ? "active" : ""} type="button" onClick={() => {
                setCreating(false);
                setSelectedId(profile.profileId);
            }}>
            <span>{profile.name}</span>
            <small>{profile.proxyRules ? tr("ui.9c66e33d9989") : tr("ui.a7dd3b61f256")} · {profile.persistence === "persistent" ? tr("ui.feb46bc764ac") : tr("ui.5df07c0bd4fb")}</small>
          </button>))}
        <button className={creating ? "active create" : "create"} type="button" onClick={startCreate}>
          <Plus size={13}/>{tr("ui.445c30b5aede")}</button>
      </div>

      <div className="browser-profile-form">
        <label>{tr("ui.1be7ae4fc257")}<input value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/>
        </label>
        <label>
          User Agent
          <input value={draft.userAgent} placeholder={tr("ui.f591ea29ff10")} disabled={busy} onChange={(event) => setDraft({ ...draft, userAgent: event.target.value })}/>
        </label>
        <label>{tr("ui.a3a9e8cdbc9e")}<input value={draft.proxyRules} placeholder={tr("ui.dd974f695c46")} disabled={busy} onChange={(event) => setDraft({ ...draft, proxyRules: event.target.value })}/>
        </label>
        <label>{tr("ui.dd4ce19b2488")}<input value={draft.proxyBypassRules} placeholder="<local>;localhost;127.0.0.1" disabled={busy} onChange={(event) => setDraft({ ...draft, proxyBypassRules: event.target.value })}/>
        </label>
        <label>{tr("ui.30a088f8d448")}<select value={draft.persistence} disabled={busy || (!creating && state.pages.some((page) => page.profileId === selected?.profileId))} onChange={(event) => setDraft({
            ...draft,
            persistence: event.target.value === "ephemeral" ? "ephemeral" : "persistent"
        })}>
            <option value="persistent">{tr("ui.fb62f37374fd")}</option>
            <option value="ephemeral">{tr("ui.bf20752090ab")}</option>
          </select>
        </label>
        <p>{tr("ui.0377f697b266")}</p>
        <div className="browser-profile-actions">
          {!creating && selected && (<button className="danger" type="button" disabled={busy || state.profiles.length <= 1} onClick={() => onDelete(selected.profileId)}>
              <Trash2 size={13}/>{tr("ui.3755f56f2f83")}</button>)}
          <button className="primary" type="button" disabled={busy || !draft.name.trim()} onClick={() => {
            if (creating)
                onCreate(draft);
            else if (selected)
                onUpdate(selected.profileId, draft);
        }}>
            {creating ? <Plus size={13}/> : <Save size={13}/>}
            {creating ? tr("ui.220a824a2f4d") : tr("ui.bb79ec7c152f")}
          </button>
        </div>
      </div>
    </aside>);
}
function profileDraft(profile?: ManagedBrowserProfile): ManagedBrowserProfileInput {
    return profile
        ? {
            name: profile.name,
            userAgent: profile.userAgent,
            proxyRules: profile.proxyRules,
            proxyBypassRules: profile.proxyBypassRules,
            persistence: profile.persistence
        }
        : {
            name: "Default",
            userAgent: "",
            proxyRules: "",
            proxyBypassRules: "<local>",
            persistence: "persistent"
        };
}
