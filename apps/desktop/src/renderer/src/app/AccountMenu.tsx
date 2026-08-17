import { tr } from "../i18n";
import { ChartBar, Check, ChevronDown, CreditCard, ExternalLink, LoaderCircle, LogIn, LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkState } from "../../../shared/desktop-api";

export function AccountMenu({ state, busy, expanded, onSignIn, onSignOut, onSwitchSpace, onUpgrade, onTopUpCredits, onOpenCreditsUsage, onOpenAccountCenter }: {
    state: WorkState;
    busy: boolean;
    expanded: boolean;
    onSignIn(): void;
    onSignOut(): void;
    onSwitchSpace(spaceId: string): Promise<boolean>;
    onUpgrade(): void;
    onTopUpCredits(): void;
    onOpenCreditsUsage(): void;
    onOpenAccountCenter(): void;
}) {
    const [open, setOpen] = useState(false);
    const [spacesOpen, setSpacesOpen] = useState(false);
    const [creditsOpen, setCreditsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const account = state.account;
    const spaces = account?.spaces ?? [];
    const activeSpace = spaces.find((space) => space.id === account?.activeSpaceId) ?? spaces[0];
    const canClearAuth = !account && (state.authStatus === "authorizing" || state.authStatus === "error");
    useEffect(() => {
        if (!open) {
            setSpacesOpen(false);
            setCreditsOpen(false);
        }
    }, [open]);
    useEffect(() => {
        if (!open)
            return;
        const close = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node))
                setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape")
                setOpen(false);
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    return (<div className="rm-account-menu-root" ref={rootRef}>
      {open && (<section className="rm-account-menu" role="dialog" aria-label={tr("account.menu.title")}>
          <div className="rm-account-menu-profile">
            <AccountAvatar displayName={account?.displayName} avatarUrl={account?.avatarUrl}/>
            <div className="rm-account-menu-profile-copy">
              <strong>{account?.displayName ?? tr("ui.6b882773fd47")}</strong>
              <span>{account?.email ?? state.authError ?? tr("ui.bce82bc54f2f")}</span>
            </div>
            {account && <button className="rm-account-profile-settings" type="button" aria-label={tr("account.center.open")} title={tr("account.center.open")} onClick={() => { setOpen(false); onOpenAccountCenter(); }}><ExternalLink size={15}/></button>}
          </div>
          {account && (<div className="rm-account-overview">
              <div className="rm-account-overview-row"><span>{account.membership?.planName ?? tr("ui.c152cd8ac13b")}</span><button type="button" onClick={() => { setOpen(false); onUpgrade(); }}>{tr("account.plan.upgrade")}</button></div>
              <div className={`rm-credit-section ${creditsOpen ? "open" : ""}`}>
                <button className="rm-credit-summary" type="button" aria-expanded={creditsOpen} onClick={() => setCreditsOpen((value) => !value)}>
                  <span>{tr("account.credits.label")}</span>
                  <span className="rm-credit-summary-value"><strong>{formatCreditsBalance(account.creditsBalance)}</strong><ChevronDown size={14}/></span>
                </button>
                {creditsOpen && (<div className="rm-credit-actions" role="menu" aria-label={tr("account.credits.actions")}>
                  <button type="button" role="menuitem" onClick={() => { setOpen(false); onTopUpCredits(); }}><CreditCard size={14}/><span>{tr("account.credits.topUp")}</span><ExternalLink size={12}/></button>
                  <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenCreditsUsage(); }}><ChartBar size={14}/><span>{tr("account.credits.usage")}</span><ExternalLink size={12}/></button>
                </div>)}
              </div>
            </div>)}
          {account && spaces.length > 0 && (<div className="rm-account-menu-section rm-space-section">
              <div className="rm-current-space-row">
                <span className="rm-account-menu-label">{tr("account.space.current")}</span>
                <div className="rm-current-space">
                  <strong>{activeSpace?.name}</strong>
                  {spaces.length > 1 && <button className="rm-space-switch" type="button" aria-label={tr("account.space.switch")} title={tr("account.space.switch")} aria-expanded={spacesOpen} onClick={() => setSpacesOpen((value) => !value)}><ChevronDown size={15}/></button>}
                </div>
              </div>
              {spacesOpen && spaces.length > 1 && (<div className="rm-space-list" role="listbox" aria-label={tr("ui.8ed04ed0151c")}>
                  {spaces.map((space) => {
                      const active = space.id === activeSpace?.id;
                      return (<button key={space.id} className={`rm-space-select ${active ? "active" : ""}`} type="button" role="option" aria-selected={active} disabled={busy} onClick={() => { void onSwitchSpace(space.id).then((switched) => { if (switched) setSpacesOpen(false); }); }}><span>{space.name}</span>{active && <Check size={14}/>}</button>);
                  })}
                </div>)}
            </div>)}
          <button className="rm-account-session-action" type="button" disabled={busy} onClick={() => account || canClearAuth ? onSignOut() : onSignIn()}>
            {busy ? <LoaderCircle className="spin" size={14}/> : account ? <LogOut size={14}/> : <LogIn size={14}/>}
            <span>{account ? tr("ui.094774b4a77b") : canClearAuth ? tr("ui.9940d7d9eaa6") : tr("ui.bc23dccbf868")}</span>
          </button>
        </section>)}
      <div className="rm-rail-account-row">
        <button className={`rm-rail-account ${open ? "active" : ""}`} type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span className="rm-rail-account-avatar">{account?.avatarUrl ? <AvatarImage src={account.avatarUrl} fallback={getInitials(account.displayName)}/> : account ? getInitials(account.displayName) : <UserRound size={17}/>}<span className={`rm-account-presence ${account ? "online" : ""}`}/></span>
          {expanded && (<span className="rm-rail-account-copy"><strong>{account?.displayName ?? tr("ui.6b882773fd47")}</strong>{!account && <small>{tr("ui.f1519207c301")}</small>}</span>)}
        </button>
      </div>
    </div>);
}

function AccountAvatar({ displayName, avatarUrl }: { displayName?: string; avatarUrl?: string | null }) {
    return (<div className="rm-account-menu-avatar">{avatarUrl ? <AvatarImage src={avatarUrl} fallback={displayName ? getInitials(displayName) : "RM"}/> : displayName ? getInitials(displayName) : <UserRound size={18}/>}</div>);
}
function AvatarImage({ src, fallback }: { src: string; fallback: string }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    return failed ? fallback : <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}
function formatCreditsBalance(value: number | undefined) {
    return value === undefined ? tr("ui.4dddd9200cc9") : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
function getInitials(displayName: string) {
    return displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "RM";
}
