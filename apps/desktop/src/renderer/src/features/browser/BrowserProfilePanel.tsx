import { Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ManagedBrowserProfile,
  ManagedBrowserProfileInput,
  ManagedBrowserState
} from "../../../../shared/desktop-api";

type BrowserProfilePanelProps = {
  state: ManagedBrowserState;
  busy: boolean;
  onClose(): void;
  onCreate(input: ManagedBrowserProfileInput): void;
  onUpdate(profileId: string, input: ManagedBrowserProfileInput): void;
  onDelete(profileId: string): void;
};

export function BrowserProfilePanel({
  state,
  busy,
  onClose,
  onCreate,
  onUpdate,
  onDelete
}: BrowserProfilePanelProps) {
  const [selectedId, setSelectedId] = useState(state.activeProfileId);
  const [creating, setCreating] = useState(false);
  const selected = state.profiles.find((profile) => profile.profileId === selectedId)
    ?? state.profiles[0];
  const [draft, setDraft] = useState<ManagedBrowserProfileInput>(() => profileDraft(selected));

  useEffect(() => {
    if (creating) return;
    setDraft(profileDraft(selected));
  }, [creating, selected?.profileId, selected?.name, selected?.userAgent, selected?.proxyRules, selected?.proxyBypassRules]);

  function startCreate() {
    setCreating(true);
    setDraft({
      name: "新 Profile",
      userAgent: "",
      proxyRules: "",
      proxyBypassRules: "<local>",
      persistence: "persistent"
    });
  }

  return (
    <aside className="browser-profile-panel" aria-label="浏览器 Profile 设置">
      <header>
        <div>
          <strong>Browser Profiles</strong>
          <span>登录状态、UA 与代理隔离空间</span>
        </div>
        <button type="button" title="关闭设置" onClick={onClose}><X size={15} /></button>
      </header>

      <div className="browser-profile-list">
        {state.profiles.map((profile) => (
          <button
            key={profile.profileId}
            className={!creating && profile.profileId === selected?.profileId ? "active" : ""}
            type="button"
            onClick={() => {
              setCreating(false);
              setSelectedId(profile.profileId);
            }}
          >
            <span>{profile.name}</span>
            <small>{profile.proxyRules ? "代理" : "直连"} · {profile.persistence === "persistent" ? "持久" : "临时"}</small>
          </button>
        ))}
        <button className={creating ? "active create" : "create"} type="button" onClick={startCreate}>
          <Plus size={13} />
          新建 Profile
        </button>
      </div>

      <div className="browser-profile-form">
        <label>
          名称
          <input
            value={draft.name}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          User Agent
          <input
            value={draft.userAgent}
            placeholder="留空使用 Electron Chromium 默认 UA"
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, userAgent: event.target.value })}
          />
        </label>
        <label>
          代理规则
          <input
            value={draft.proxyRules}
            placeholder="例如 http=127.0.0.1:7890;https=127.0.0.1:7890"
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, proxyRules: event.target.value })}
          />
        </label>
        <label>
          代理绕过规则
          <input
            value={draft.proxyBypassRules}
            placeholder="<local>;localhost;127.0.0.1"
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, proxyBypassRules: event.target.value })}
          />
        </label>
        <label>
          存储方式
          <select
            value={draft.persistence}
            disabled={busy || (!creating && state.pages.some((page) => page.profileId === selected?.profileId))}
            onChange={(event) => setDraft({
              ...draft,
              persistence: event.target.value === "ephemeral" ? "ephemeral" : "persistent"
            })}
          >
            <option value="persistent">持久化登录状态</option>
            <option value="ephemeral">临时会话</option>
          </select>
        </label>
        <p>同一 Profile 下的页面共享 Cookie 和代理；需要不同代理时请新建 Profile。</p>
        <div className="browser-profile-actions">
          {!creating && selected && (
            <button
              className="danger"
              type="button"
              disabled={busy || state.profiles.length <= 1}
              onClick={() => onDelete(selected.profileId)}
            >
              <Trash2 size={13} />
              删除
            </button>
          )}
          <button
            className="primary"
            type="button"
            disabled={busy || !draft.name.trim()}
            onClick={() => {
              if (creating) onCreate(draft);
              else if (selected) onUpdate(selected.profileId, draft);
            }}
          >
            {creating ? <Plus size={13} /> : <Save size={13} />}
            {creating ? "创建并打开" : "保存设置"}
          </button>
        </div>
      </div>
    </aside>
  );
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
