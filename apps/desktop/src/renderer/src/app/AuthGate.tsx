import { ArrowRight, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import type { WorkState } from "../../../shared/desktop-api";
import brandIcon from "../../../../build/icon.png";

export function AuthGate({
  loading,
  state,
  busy,
  connectionError,
  onSignIn,
  onCancel
}: {
  loading: boolean;
  state: WorkState;
  busy: boolean;
  connectionError: string | null;
  onSignIn(): void;
  onCancel(): void;
}) {
  const authorizing = state.authStatus === "authorizing";
  const message = state.authError ?? connectionError;

  return (
    <main className="auth-gate">
      <div className="auth-gate-orb auth-gate-orb-one" />
      <div className="auth-gate-orb auth-gate-orb-two" />
      <section className="auth-gate-card" aria-label="登录 RouteMarket Work">
        <div className="auth-gate-brand">
          <img src={brandIcon} alt="" />
          <span>RouteMarket Work</span>
        </div>
        <div className="auth-gate-icon"><LockKeyhole size={25} /></div>
        <h1>{authorizing ? "请在浏览器中完成登录" : "登录后开始使用"}</h1>
        <p>
          {authorizing
            ? "完成登录或注册后，本窗口会自动进入工作台。"
            : "使用 RouteMarket 账户登录。项目、文件和桌面对话仍保存在这台电脑。"}
        </p>
        {message && <div className="auth-gate-error" role="alert">{message}</div>}
        {loading && !message ? (
          <div className="auth-gate-loading"><LoaderCircle className="spin" size={18} />正在检查登录状态…</div>
        ) : (
          <div className="auth-gate-actions">
            <button className="primary-button auth-gate-primary" type="button" disabled={busy} onClick={onSignIn}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
              {authorizing ? "重新打开登录页" : "登录或注册"}
            </button>
            {authorizing && (
              <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>取消登录</button>
            )}
          </div>
        )}
        <div className="auth-gate-security"><ShieldCheck size={15} />登录信息由系统安全存储加密保存</div>
      </section>
    </main>
  );
}
