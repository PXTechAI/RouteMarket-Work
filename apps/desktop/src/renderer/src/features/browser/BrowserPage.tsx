import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CircleAlert,
  Download,
  Globe2,
  LoaderCircle,
  LogOut,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  X
} from "lucide-react";
import { useState } from "react";
import { BrowserProfilePanel } from "./BrowserProfilePanel";
import { BrowserDownloadPanel } from "./BrowserDownloadPanel";
import { BrowserTabStrip } from "./BrowserTabStrip";
import type { BrowserPageProps } from "./types";

export function BrowserPage({ model, actions, viewportRef, addressRef }: BrowserPageProps) {
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const activeProfile = model.state?.profiles.find(
    (profile) => profile.profileId === model.state?.activeProfileId
  );

  return (
    <section className={`browser-pane browser-pane-${model.mode}`}>
      {model.mode === "managed" && model.state && (
        <BrowserTabStrip
          state={model.state}
          disabled={model.busy}
          onCreatePage={() => actions.onCreatePage(model.state?.activeProfileId)}
          onSelectPage={actions.onSelectPage}
          onClosePage={actions.onClosePage}
        />
      )}
      <div className="browser-toolbar">
        <div className="browser-mode-switch" role="group" aria-label="浏览器模式">
          <button type="button" className={model.mode === "managed" ? "active" : ""} onClick={() => actions.onModeChange("managed")}>
            Managed
          </button>
          <button type="button" className={model.mode === "attached" ? "active" : ""} onClick={() => actions.onModeChange("attached")}>
            Attached
          </button>
        </div>
        <button className="browser-icon-button" type="button" title="后退" disabled={model.mode === "attached" || !model.state?.canGoBack} onClick={() => actions.onNavigate("back")}>
          <ArrowLeft size={15} />
        </button>
        <button className="browser-icon-button" type="button" title="前进" disabled={model.mode === "attached" || !model.state?.canGoForward} onClick={() => actions.onNavigate("forward")}>
          <ArrowRight size={15} />
        </button>
        <button className="browser-icon-button" type="button" title="刷新" disabled={model.mode === "attached"} onClick={() => actions.onNavigate("reload")}>
          {model.state?.loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
        </button>
        <div className="browser-address">
          <Globe2 size={13} />
          <input
            ref={addressRef}
            value={model.address}
            aria-label="网页地址"
            onChange={(event) => actions.onAddressChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") actions.onAddressSubmit();
            }}
          />
        </div>
        {model.mode === "managed" && (
          <>
            <button className={`browser-profile-button ${profilesOpen ? "active" : ""}`} type="button" title="浏览器 Profile 设置" onClick={() => {
              setDownloadsOpen(false);
              setProfilesOpen((open) => !open);
            }}>
              <Settings2 size={14} />
              <span>{activeProfile?.name ?? "Profile"}</span>
            </button>
            <button className={`takeover-button ${model.state?.userTakeover ? "active" : ""}`} type="button" title="切换用户接管与 Agent 模式" onClick={actions.onToggleTakeover}>
              {model.state?.userTakeover ? "用户接管" : "Agent 控制"}
            </button>
          </>
        )}
        <button className="browser-icon-button" type="button" title="截图" disabled={model.busy || !model.localProjectId} onClick={actions.onCaptureScreenshot}>
          <Camera size={15} />
        </button>
        {model.mode === "managed" && (
          <button
            className={`browser-icon-button browser-download-button ${downloadsOpen ? "active" : ""}`}
            type="button"
            title="下载"
            disabled={!model.localProjectId}
            onClick={() => {
              setProfilesOpen(false);
              setDownloadsOpen((open) => !open);
            }}
          >
            <Download size={15} />
            {model.state && model.state.downloads.length > 0 && (
              <span>{Math.min(model.state.downloads.length, 99)}</span>
            )}
          </button>
        )}
      </div>

      <div className="browser-content">
        <div className="browser-viewport" ref={viewportRef}>
          {model.screenshot && (
            <div className="browser-screenshot-preview">
              <div>
                <strong>网页截图</strong>
                <button type="button" onClick={actions.onCloseScreenshot}><X size={14} />关闭预览</button>
              </div>
              <img src={model.screenshot} alt={`${model.mode === "managed" ? "Managed" : "Attached"} Browser screenshot`} />
            </div>
          )}

          {!model.screenshot && model.mode === "attached" && (
            <div className="attached-browser-setup">
              <div className="attached-browser-card">
                <div className="attached-browser-heading">
                  <div><Globe2 size={22} /><div><h2>Attached Browser</h2><p>连接本机已开启调试端口的 Chromium 页面。</p></div></div>
                  <span className={model.attachedState.connected ? "connected" : ""}>{model.attachedState.connected ? "已连接" : "未连接"}</span>
                </div>
                <label>本机发现地址</label>
                <div className="attached-browser-row">
                  <input value={model.attachedEndpoint} disabled={model.attachedState.connected} onChange={(event) => actions.onAttachedEndpointChange(event.target.value)} />
                  <button type="button" disabled={model.busy || model.attachedState.connected} onClick={actions.onDiscoverAttachedTargets}>
                    {model.busy ? <LoaderCircle className="spin" size={13} /> : <Search size={13} />}发现页面
                  </button>
                </div>
                <label>页面目标</label>
                <select value={model.selectedAttachedTargetId} disabled={model.attachedState.connected || model.attachedTargets.length === 0} onChange={(event) => actions.onSelectedAttachedTargetChange(event.target.value)}>
                  {model.attachedTargets.length === 0 && <option value="">先发现页面</option>}
                  {model.attachedTargets.map((target) => <option key={target.targetId} value={target.targetId}>{target.title || target.url}</option>)}
                </select>
                <button className={`attached-connect-button ${model.attachedState.connected ? "disconnect" : ""}`} type="button" disabled={model.busy || (!model.attachedState.connected && !model.selectedAttachedTargetId)} onClick={actions.onToggleAttachedConnection}>
                  {model.attachedState.connected ? <><LogOut size={14} />断开连接</> : <><Plug size={14} />连接所选页面</>}
                </button>
                {model.attachedState.target && <div className="attached-browser-target"><strong>{model.attachedState.target.title || "未命名页面"}</strong><span>{model.attachedState.target.url}</span></div>}
                <p className="attached-browser-note">仅允许 localhost DevTools 发现地址与本机 WebSocket，不接受远程调试端点。</p>
              </div>
            </div>
          )}

          {!model.screenshot && model.mode === "managed" && !model.localProjectId && (
            <div className="browser-empty"><Globe2 size={30} /><h2>选择一个项目</h2><p>浏览器页面、登录状态和自动化操作都归属于项目。</p></div>
          )}
          {!model.screenshot && model.mode === "managed" && model.localProjectId && model.state?.url === "about:blank" && (
            <div className="browser-empty"><Globe2 size={30} /><h2>Managed Browser</h2><p>输入网址开始浏览；Agent 可以在当前项目页面中继续操作。</p></div>
          )}
        </div>

        {profilesOpen && model.mode === "managed" && model.state && (
          <BrowserProfilePanel
            state={model.state}
            busy={model.busy}
            onClose={() => setProfilesOpen(false)}
            onCreate={actions.onCreateProfile}
            onUpdate={actions.onUpdateProfile}
            onDelete={actions.onDeleteProfile}
          />
        )}
        {downloadsOpen && model.mode === "managed" && model.state && (
          <BrowserDownloadPanel
            downloads={model.state.downloads}
            onClose={() => setDownloadsOpen(false)}
          />
        )}
      </div>

      {model.error && (
        <div className="error-banner" role="alert">
          <CircleAlert size={18} /><span>{model.error}</span>
          <button type="button" title="关闭" onClick={actions.onDismissError}><X size={14} /></button>
        </div>
      )}
    </section>
  );
}
