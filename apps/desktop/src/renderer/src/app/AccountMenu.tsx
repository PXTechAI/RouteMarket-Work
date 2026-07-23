import {
  Check,
  Crown,
  Database,
  Download,
  FolderOpen,
  LoaderCircle,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Trash2,
  UserRound,
  UsersRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  LocalDataInfo,
  RouteMarketWorkApi,
  WorkState
} from "../../../shared/desktop-api";
import {
  applyThemePreference,
  getStoredThemePreference,
  setThemePreference,
  watchSystemTheme,
  type ThemePreference
} from "./theme";

export function AccountMenu({
  state,
  dataApi,
  busy,
  expanded,
  onSignIn,
  onSignOut,
  onSwitchSpace
}: {
  state: WorkState;
  dataApi: Pick<
    RouteMarketWorkApi,
    "getLocalDataInfo" | "showLocalData" | "exportLocalData" | "clearLocalData"
  >;
  busy: boolean;
  expanded: boolean;
  onSignIn(): void;
  onSignOut(): void;
  onSwitchSpace(spaceId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getStoredThemePreference);
  const [localData, setLocalData] = useState<LocalDataInfo | null>(null);
  const [localDataBusy, setLocalDataBusy] = useState(false);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const account = state.account;
  const spaces = account?.spaces ?? [];
  const activeSpace = spaces.find((space) => space.id === account?.activeSpaceId) ?? spaces[0];
  const canClearAuth =
    !account && (state.authStatus === "authorizing" || state.authStatus === "error");

  useEffect(() => {
    applyThemePreference(theme);
    return watchSystemTheme(theme, () => {
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

  useEffect(() => {
    if (!open) return;
    setLocalDataError(null);
    void dataApi.getLocalDataInfo()
      .then(setLocalData)
      .catch((error: unknown) => {
        setLocalDataError(error instanceof Error ? error.message : "无法读取本地数据");
      });
  }, [dataApi, open]);

  function selectTheme(nextTheme: ThemePreference) {
    setTheme(nextTheme);
    setThemePreference(nextTheme);
  }

  async function runLocalDataAction(
    action: "show" | "export" | "clear"
  ) {
    setLocalDataBusy(true);
    setLocalDataError(null);
    try {
      if (action === "show") await dataApi.showLocalData();
      if (action === "export") await dataApi.exportLocalData();
      if (action === "clear") await dataApi.clearLocalData();
      setLocalData(await dataApi.getLocalDataInfo());
    } catch (error) {
      setLocalDataError(error instanceof Error ? error.message : "本地数据操作失败");
    } finally {
      setLocalDataBusy(false);
    }
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

          {account && state.authError && (
            <div className="rm-account-sync-alert" role="alert">
              {state.authError}
            </div>
          )}

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

          <div className="rm-account-menu-section rm-theme-section">
            <span className="rm-account-menu-label">外观</span>
            <div className="rm-theme-control" role="group" aria-label="主题">
              <ThemeButton
                active={theme === "light"}
                label="浅色"
                onClick={() => selectTheme("light")}
              >
                <Sun size={13} />
              </ThemeButton>
              <ThemeButton
                active={theme === "dark"}
                label="深色"
                onClick={() => selectTheme("dark")}
              >
                <Moon size={13} />
              </ThemeButton>
              <ThemeButton
                active={theme === "system"}
                label="系统"
                onClick={() => selectTheme("system")}
              >
                <Monitor size={13} />
              </ThemeButton>
            </div>
          </div>

          <div className="rm-account-menu-section rm-local-data-section">
            <span className="rm-account-menu-label">本地数据</span>
            <div className="rm-local-data-summary">
              <Database size={16} />
              <div>
                <strong>
                  {localData ? formatBytes(localData.totalBytes) : "正在计算占用空间"}
                </strong>
                <span title={localData?.dataPath}>
                  {localData
                    ? localData.databaseHealth === "healthy"
                      ? "数据库正常"
                      : localData.databaseHealth === "empty"
                        ? "暂无本地数据"
                        : "数据库需要恢复"
                    : "本机项目、对话与运行记录"}
                </span>
                {localData?.lastRecoveredAt && (
                  <small>
                    已于 {new Date(localData.lastRecoveredAt).toLocaleString("zh-CN")} 自动保留损坏副本
                  </small>
                )}
              </div>
            </div>
            {localDataError && (
              <div className="rm-account-sync-alert" role="alert">
                {localDataError}
              </div>
            )}
            <div className="rm-local-data-actions">
              <button
                type="button"
                disabled={localDataBusy}
                onClick={() => void runLocalDataAction("show")}
              >
                <FolderOpen size={14} />打开目录
              </button>
              <button
                type="button"
                disabled={localDataBusy}
                onClick={() => void runLocalDataAction("export")}
              >
                <Download size={14} />导出
              </button>
              <button
                className="danger"
                type="button"
                disabled={localDataBusy}
                onClick={() => void runLocalDataAction("clear")}
              >
                <Trash2 size={14} />清空
              </button>
            </div>
            <small className="rm-local-data-note">
              导出不包含登录令牌；清空不会删除已关联文件夹中的文件。
            </small>
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
      </div>
    </div>
  );
}

function ThemeButton({
  active,
  label,
  onClick,
  children
}: {
  active: boolean;
  label: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {label}
    </button>
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}
