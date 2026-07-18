import {
  Crown,
  LoaderCircle,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Sun,
  UserRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkState } from "../../../shared/desktop-api";
import {
  applyThemePreference,
  getStoredThemePreference,
  setThemePreference,
  watchSystemTheme,
  type ThemePreference
} from "./theme";

export function AccountMenu({
  state,
  busy,
  onSignIn,
  onSignOut
}: {
  state: WorkState;
  busy: boolean;
  onSignIn(): void;
  onSignOut(): void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(getStoredThemePreference);
  const rootRef = useRef<HTMLDivElement>(null);
  const account = state.account;
  const canClearAuth =
    !account && (state.authStatus === "authorizing" || state.authStatus === "error");

  useEffect(() => {
    applyThemePreference(theme);
    return watchSystemTheme(theme, () => applyThemePreference(theme));
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

  function selectTheme(nextTheme: ThemePreference) {
    setTheme(nextTheme);
    setThemePreference(nextTheme);
  }

  return (
    <div className="rm-account-menu-root" ref={rootRef}>
      {open && (
        <section className="rm-account-menu" role="dialog" aria-label="账户与外观">
          <div className="rm-account-menu-profile">
            <AccountAvatar displayName={account?.displayName} />
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

          <div className="rm-account-menu-section">
            <span className="rm-account-menu-label">外观</span>
            <div className="rm-theme-control" aria-label="主题模式">
              <ThemeButton
                label="浅色"
                active={theme === "light"}
                onClick={() => selectTheme("light")}
              >
                <Sun size={14} />
              </ThemeButton>
              <ThemeButton
                label="深色"
                active={theme === "dark"}
                onClick={() => selectTheme("dark")}
              >
                <Moon size={14} />
              </ThemeButton>
              <ThemeButton
                label="系统"
                active={theme === "system"}
                onClick={() => selectTheme("system")}
              >
                <Monitor size={14} />
              </ThemeButton>
            </div>
          </div>

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

      <button
        className={`rm-rail-account ${open ? "active" : ""}`}
        type="button"
        title={account ? account.displayName : "RouteMarket 账户"}
        aria-label={account ? `打开 ${account.displayName} 的账户菜单` : "打开账户菜单"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {account ? getInitials(account.displayName) : <UserRound size={17} />}
        <span className={`rm-account-presence ${account ? "online" : ""}`} />
      </button>
    </div>
  );
}

function AccountAvatar({ displayName }: { displayName?: string }) {
  return (
    <div className="rm-account-menu-avatar" aria-hidden="true">
      {displayName ? getInitials(displayName) : <UserRound size={18} />}
    </div>
  );
}

function ThemeButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      aria-pressed={active}
      title={`${label}模式`}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
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
