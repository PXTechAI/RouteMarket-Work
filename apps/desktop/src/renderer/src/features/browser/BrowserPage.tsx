import "./browser.scss";
import { tr } from "../../i18n";
import { ArrowLeft, ArrowRight, Camera, CircleAlert, Download, Globe2, History, LoaderCircle, LogOut, Plug, RefreshCw, Search, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BrowserProfilePanel } from "./BrowserProfilePanel";
import { BrowserDownloadPanel } from "./BrowserDownloadPanel";
import { BrowserOperationPanel } from "./BrowserOperationPanel";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { WorkspaceState } from "../../app/WorkspaceState";
import type { BrowserPageProps } from "./types";
export function BrowserPage({ model, actions, viewportRef, addressRef }: BrowserPageProps) {
    const [profilesOpen, setProfilesOpen] = useState(false);
    const [downloadsOpen, setDownloadsOpen] = useState(false);
    const [operationsOpen, setOperationsOpen] = useState(false);
    const [chromeHandoffDismissed, setChromeHandoffDismissed] = useState(() => window.localStorage.getItem(CHROME_HANDOFF_DISMISSED_KEY) === "1");
    const showChromeHandoff = model.mode === "managed" && Boolean(model.localProjectId) && !chromeHandoffDismissed;
    useEffect(() => {
        let settledFrame = 0;
        const frame = window.requestAnimationFrame(() => {
            actions.onViewportLayoutChange();
            settledFrame = window.requestAnimationFrame(actions.onViewportLayoutChange);
        });
        const settleTimer = window.setTimeout(actions.onViewportLayoutChange, 180);
        return () => {
            window.cancelAnimationFrame(frame);
            window.cancelAnimationFrame(settledFrame);
            window.clearTimeout(settleTimer);
        };
    }, [profilesOpen, downloadsOpen, operationsOpen, showChromeHandoff, actions.onViewportLayoutChange]);
    const activeProfile = model.state?.profiles.find((profile) => profile.profileId === model.state?.activeProfileId);
    return (<section className={`browser-pane browser-pane-${model.mode}${showChromeHandoff ? " browser-pane-with-handoff" : ""}`}>
      {model.mode === "managed" && model.state && (<BrowserTabStrip state={model.state} disabled={model.busy} onCreatePage={() => actions.onCreatePage(model.state?.activeProfileId)} onSelectPage={actions.onSelectPage} onClosePage={actions.onClosePage}/>)}
      <div className="browser-toolbar">
        <div className="browser-mode-switch" role="group" aria-label={tr("ui.94f19e8db8fb")}>
          <button type="button" className={model.mode === "managed" ? "active" : ""} onClick={() => actions.onModeChange("managed")}>
            Managed
          </button>
          <button type="button" className={model.mode === "attached" ? "active" : ""} onClick={() => actions.onModeChange("attached")}>
            Attached
          </button>
        </div>
        <button className="browser-icon-button" type="button" title={tr("ui.4cf4c11a1b0b")} disabled={model.mode === "attached" || !model.state?.canGoBack} onClick={() => actions.onNavigate("back")}>
          <ArrowLeft size={15}/>
        </button>
        <button className="browser-icon-button" type="button" title={tr("ui.320ffeefca2c")} disabled={model.mode === "attached" || !model.state?.canGoForward} onClick={() => actions.onNavigate("forward")}>
          <ArrowRight size={15}/>
        </button>
        <button className="browser-icon-button" type="button" title={tr("ui.38108eaa1d32")} disabled={model.mode === "attached"} onClick={() => actions.onNavigate("reload")}>
          {model.state?.loading ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>}
        </button>
        <div className="browser-address">
          <Globe2 size={13}/>
          <input ref={addressRef} value={model.address} aria-label={tr("ui.cce5fe3be41b")} onChange={(event) => actions.onAddressChange(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter")
                actions.onAddressSubmit();
        }}/>
        </div>
        {model.mode === "managed" && (<>
            <button className={`browser-profile-button ${profilesOpen ? "active" : ""}`} type="button" title={tr("ui.84aa25fe9b80")} onClick={() => {
                setDownloadsOpen(false);
                setOperationsOpen(false);
                setProfilesOpen((open) => !open);
            }}>
              <Settings2 size={14}/>
              <span>{activeProfile?.name ?? "Profile"}</span>
            </button>
            <button className={`takeover-button ${model.state?.userTakeover ? "active" : ""}`} type="button" title={tr("ui.c667434c6465")} onClick={actions.onToggleTakeover}>
              {model.state?.userTakeover ? tr("ui.d73de59bf81e") : tr("ui.f04c0211c92f")}
            </button>
          </>)}
        <button className="browser-icon-button" type="button" title={tr("ui.49830b4f744c")} disabled={model.busy || !model.localProjectId} onClick={actions.onCaptureScreenshot}>
          <Camera size={15}/>
        </button>
        {model.mode === "managed" && (<button className={`browser-icon-button browser-download-button ${downloadsOpen ? "active" : ""}`} type="button" title={tr("ui.2b9d013177da")} disabled={!model.localProjectId} onClick={() => {
                setProfilesOpen(false);
                setOperationsOpen(false);
                setDownloadsOpen((open) => !open);
            }}>
            <Download size={15}/>
            {model.state && model.state.downloads.length > 0 && (<span>{Math.min(model.state.downloads.length, 99)}</span>)}
          </button>)}
        {model.mode === "managed" && (<button className={`browser-icon-button browser-operation-button ${operationsOpen ? "active" : ""}`} type="button" title={tr("ui.6fcdba1f7183")} aria-label={tr("ui.6fcdba1f7183")} disabled={!model.localProjectId} onClick={() => {
                setProfilesOpen(false);
                setDownloadsOpen(false);
                setOperationsOpen((open) => !open);
            }}>
            <History size={15}/>
            {model.state && model.state.operations.some((operation) => operation.status === "failed" || operation.status === "running") && (<span>
                {Math.min(model.state.operations.filter((operation) => operation.status === "failed" || operation.status === "running").length, 99)}
              </span>)}
          </button>)}
      </div>

      {showChromeHandoff && (<div className="browser-chrome-handoff" role="region" aria-label={tr("browser.chromeHandoff.title")}>
          <span className="browser-chrome-mark" aria-hidden="true"/>
          <div>
            <strong>{tr("browser.chromeHandoff.title")}</strong>
            <span>{tr("browser.chromeHandoff.description")}</span>
          </div>
          <button className="browser-chrome-handoff-action" type="button" onClick={() => {
              setProfilesOpen(false);
              setDownloadsOpen(false);
              setOperationsOpen(false);
              actions.onModeChange("attached");
          }}>{tr("browser.chromeHandoff.connect")}</button>
          <button className="browser-chrome-handoff-close" type="button" title={tr("browser.chromeHandoff.dismiss")} aria-label={tr("browser.chromeHandoff.dismiss")} onClick={() => {
              window.localStorage.setItem(CHROME_HANDOFF_DISMISSED_KEY, "1");
              setChromeHandoffDismissed(true);
          }}><X size={14}/></button>
        </div>)}

      <div className="browser-content">
        <div className="browser-viewport" ref={viewportRef}>
          {model.screenshot && (<div className="browser-screenshot-preview">
              <div>
                <strong>{tr("ui.f9f41507ac2a")}</strong>
                <button type="button" onClick={actions.onCloseScreenshot}><X size={14}/>{tr("ui.bf7630879471")}</button>
              </div>
              <img src={model.screenshot} alt={`${model.mode === "managed" ? "Managed" : "Attached"} Browser screenshot`}/>
            </div>)}

          {!model.screenshot && model.mode === "attached" && (<div className="attached-browser-setup">
              <div className="attached-browser-card">
                <div className="attached-browser-heading">
                  <div><Globe2 size={22}/><div><h2>Attached Browser</h2><p>{tr("ui.58129bdd8424")}</p></div></div>
                  <span className={model.attachedState.connected ? "connected" : ""}>{model.attachedState.connected ? tr("ui.65fe35c45e4e") : tr("ui.f2f3e9803ccb")}</span>
                </div>
                <label>{tr("ui.24c58c042d1e")}</label>
                <div className="attached-browser-row">
                  <input value={model.attachedEndpoint} disabled={model.attachedState.connected} onChange={(event) => actions.onAttachedEndpointChange(event.target.value)}/>
                  <button type="button" disabled={model.busy || model.attachedState.connected} onClick={actions.onDiscoverAttachedTargets}>
                    {model.busy ? <LoaderCircle className="spin" size={13}/> : <Search size={13}/>}{tr("ui.3533405d7c38")}</button>
                </div>
                <label>{tr("ui.a5249f3a6fdf")}</label>
                <select value={model.selectedAttachedTargetId} disabled={model.attachedState.connected || model.attachedTargets.length === 0} onChange={(event) => actions.onSelectedAttachedTargetChange(event.target.value)}>
                  {model.attachedTargets.length === 0 && <option value="">{tr("ui.685837752999")}</option>}
                  {model.attachedTargets.map((target) => <option key={target.targetId} value={target.targetId}>{target.title || target.url}</option>)}
                </select>
                <button className={`attached-connect-button ${model.attachedState.connected ? "disconnect" : ""}`} type="button" disabled={model.busy || (!model.attachedState.connected && !model.selectedAttachedTargetId)} onClick={actions.onToggleAttachedConnection}>
                  {model.attachedState.connected ? <><LogOut size={14}/>{tr("ui.eb7246121725")}</> : <><Plug size={14}/>{tr("ui.4378fc43b551")}</>}
                </button>
                {model.attachedState.target && <div className="attached-browser-target"><strong>{model.attachedState.target.title || tr("ui.5a131f787f5e")}</strong><span>{model.attachedState.target.url}</span></div>}
                <p className="attached-browser-note">{tr("ui.0be313febcaa")}</p>
              </div>
            </div>)}

          {!model.screenshot && model.mode === "managed" && !model.localProjectId && (<WorkspaceState kind="empty" icon={<Globe2 size={24}/>} title={tr("ui.54400ff0196d")} description={tr("ui.66c606575b1a")}/>)}
          {!model.screenshot && model.mode === "managed" && model.localProjectId && model.state?.url === "about:blank" && (<WorkspaceState kind="empty" icon={<Globe2 size={24}/>} title="Managed Browser" description={tr("ui.9744fae766b5")}/>)}
        </div>

        {profilesOpen && model.mode === "managed" && model.state && (<BrowserProfilePanel state={model.state} busy={model.busy} onClose={() => setProfilesOpen(false)} onCreate={actions.onCreateProfile} onUpdate={actions.onUpdateProfile} onDelete={actions.onDeleteProfile}/>)}
        {downloadsOpen && model.mode === "managed" && model.state && (<BrowserDownloadPanel downloads={model.state.downloads} onClose={() => setDownloadsOpen(false)}/>)}
        {operationsOpen && model.mode === "managed" && model.state && (<BrowserOperationPanel operations={model.state.operations} busy={model.busy} onRetry={actions.onRetryOperation} onClose={() => setOperationsOpen(false)}/>)}
      </div>

      {model.error && (<div className="error-banner" role="alert">
          <CircleAlert size={18}/><span>{model.error}</span>
          <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={actions.onDismissError}><X size={14}/></button>
        </div>)}
    </section>);
}

const CHROME_HANDOFF_DISMISSED_KEY = "routemarket.browser.chrome-handoff.dismissed.v1";
