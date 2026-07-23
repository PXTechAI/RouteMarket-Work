import {
  Check,
  Crown,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Sun,
  UserRound,
  UsersRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkState } from "../../../shared/desktop-api";
import {
  applyThemePreference,
  getStoredThemePreference,
  setThemePreference,
  watchSystemTheme
} from "./theme";

export function AccountMenu({
  state,
  busy,
  expanded,
  onSignIn,
  onSignOut,
  onSwitchSpace
}: {
  state: WorkState;
  busy: boolean;
  expanded: boolean;
  onSignIn(): void;
  onSignOut(): void;
  onSwitchSpace(spaceId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getStoredThemePreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const rootRef = useRef<HTMLDivElement>(null);
  const account = state.account;
  const spaces = account?.spaces ?? [];
  const activeSpace = spaces.find((space) => space.id === account?.activeSpaceId) ?? spaces[0];
  const canClearAuth =
    !account && (state.authStatus === "authorizing" || state.authStatus === "error");

  useEffect(() => {
    applyThemePreference(theme);
    return watchSystemTheme(theme, () => {
      setSystemDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      applyThemePreference(theme);
    });
  }, [theme]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const darkMode = theme === "dark" || (theme === "system" && systemDark);

  function selectTheme(nextTheme: "light" | "dark") {
    setTheme(nextTheme);
    setThemePreference(nextTheme);
  }

  return (
    <div className="rm-account-menu-root" ref={rootRef}>
      {open && (
        <section className="rm-account-menu" role="dialog" aria-label="账户与外观">
          <div className="rm-account-menu-profile">
            <AccountAvatar displayName={account?.displayName} avatarUrl={account?.avatarUrl} />
            <div>
              <strong>{account?.displayName ?? "RouteMarket 账户"}</strong>
              <span>
                {account?.email ??
                  state.authError ??
                  (state.authStatus === "authorizing"
                    ? "等待浏览器授权"
                    : "登录后同步账户与会员信息")}
              </span>
            </div>
          </div>

          {account && (
            <div className="rm-membership-summary">
              <Crown size={15} />
              <div>
                <span>当前会员</span>
                <strong>{membershipLabel(account.membership)}</strong>
                {account.membership?.expiresAt && (
                  <small>
                    有效至 {new Date(account.membership.expiresAt).toLocaleDateString("zh-CN")}
                  </small>
                )}
              </div>
            </div>
          )}

          {account && spaces.length > 0 && (
            <div className="rm-account-menu-section rm-space-section">
              <span className="rm-account-menu-label">空间</span>
              <div className="rm-space-list" role="listbox" aria-label="选择工作空间">
                {spaces.map((space) => {
                  const active = space.id === activeSpace?.id;
                  return (
                    <button
                      key={space.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={active ? "active" : ""}
                      disabled={busy}
                      onClick={() => onSwitchSpace(space.id)}
                    >
                      <span className="rm-space-avatar">
                        {space.avatarUrl ? (
                          <AvatarImage src={space.avatarUrl} fallback={getInitials(space.name)} />
                        ) : space.kind === "team" ? (
                          <UsersRound size={14} />
                        ) : (
                          getInitials(space.name)
                        )}
                      </span>
                      <span className="rm-space-copy">
                        <strong>{space.name}</strong>
                        <small>{space.kind === "team" ? "Team 空间" : "个人空间"}</small>
                      </span>
                      {active && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            className="rm-account-session-action"
            type="button"
            disabled={busy}
            onClick={() => {
              if (account || canClearAuth) onSignOut();
              else onSignIn();
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : account ? (
              <LogOut size={15} />
            ) : (
              <LogIn size={15} />
            )}
            <span>
              {account
                ? "退出登录"
                : canClearAuth
                  ? "取消并清除登录"
                  : "登录 RouteMarket"}
            </span>
          </button>
        </section>
      )}

      <div className="rm-rail-account-row">
        <button
          className={`rm-rail-account ${open ? "active" : ""}`}
          type="button"
          title={account ? account.displayName : "RouteMarket 账户"}
          aria-label={account ? `打开 ${account.displayName} 的账户菜单` : "打开账户菜单"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="rm-rail-account-avatar">
            {account?.avatarUrl ? (
              <AvatarImage src={account.avatarUrl} fallback={getInitials(account.displayName)} />
            ) : account ? getInitials(account.displayName) : <UserRound size={17} />}
            <span className={`rm-account-presence ${account ? "online" : ""}`} />
          </span>
          {expanded && (
            <span className="rm-rail-account-copy">
              <strong>{account?.displayName ?? "RouteMarket 账户"}</strong>
              <small>{account ? "已登录" : "点击登录"}</small>
            </span>
          )}
        </button>
        {expanded && (
          <button
            className="rm-rail-theme-toggle"
            type="button"
            title={darkMode ? "切换到浅色模式" : "切换到深色模式"}
            aria-label={darkMode ? "切换到浅色模式" : "切换到深色模式"}
            onClick={() => selectTheme(darkMode ? "light" : "dark")}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

function AccountAvatar({
  displayName,
  avatarUrl
}: {
  displayName?: string;
  avatarUrl?: string | null;
}) {
  return (
    <div className="rm-account-menu-avatar" aria-hidden="true">
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} fallback={displayName ? getInitials(displayName) : "RM"} />
      ) : displayName ? getInitials(displayName) : <UserRound size={18} />}
    </div>
  );
}

function AvatarImage({ src, fallback }: { src: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? fallback : (
    <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}

function membershipLabel(
  membership: NonNullable<WorkState["account"]>["membership"]
) {
  if (membership === undefined) return "会员信息暂不可用";
  if (membership === null) return "未开通会员";
  return membership.planName;
}

function getInitials(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "RM";
}
