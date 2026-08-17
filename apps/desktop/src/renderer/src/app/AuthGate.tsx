import { tr, useLocale } from "../i18n";
import { ArrowRight, Globe2, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import type { RouteMarketWorkApi, WorkState } from "../../../shared/desktop-api";
import brandIcon from "../assets/routemarket-2a-naked";
import { LOCALE_OPTIONS, type LocalePreference } from "../i18n/locales";
import { RouteMarketSelect } from "./RouteMarketSelect";
export function AuthGate({ api, loading, state, busy, connectionError, onSignIn, onRegister, onCancel }: {
    api: RouteMarketWorkApi;
    loading: boolean;
    state: WorkState;
    busy: boolean;
    connectionError: string | null;
    onSignIn(): void;
    onRegister(): void;
    onCancel(): void;
}) {
    const authorizing = state.authStatus === "authorizing";
    const message = state.authError ?? connectionError;
    const { locale, preference, setPreference } = useLocale();
    const languageOptions = LOCALE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.value === "system"
            ? `${tr("settings.language.system")} · ${tr(`settings.language.${locale}`)}`
            : tr(`settings.language.${option.value}`)
    }));
    useEffect(() => {
        const sync = () => {
            const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
            void api.setTitleBarTheme(theme);
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        return () => observer.disconnect();
    }, [api]);
    return (<main className="auth-gate">
      <div className="auth-gate-drag-region" aria-hidden="true"/>
      <div className="auth-gate-orb auth-gate-orb-one" aria-hidden="true"/>
      <div className="auth-gate-orb auth-gate-orb-two" aria-hidden="true"/>
      <div className="auth-gate-language">
        <Globe2 size={14} aria-hidden="true"/>
        <RouteMarketSelect label={tr("settings.language.label")} value={preference} options={languageOptions} onChange={(value) => setPreference(value as LocalePreference)}/>
      </div>
      <section className="auth-gate-card" aria-label={tr("ui.b2d90eadf9fe")}>
        <div className="auth-gate-brand">
          <img src={brandIcon} alt=""/>
          <span>RouteMarket Work</span>
        </div>
        <h1>{authorizing ? tr("ui.a971f67a855a") : tr("authGate.title")}</h1>
        {message && <div className="auth-gate-error" role="alert">{message}</div>}
        {loading && !message ? (<div className="auth-gate-loading"><LoaderCircle className="spin" size={18}/>{tr("ui.cf4e7111f226")}</div>) : (<div className="auth-gate-actions">
            <button className="primary-button auth-gate-primary" type="button" disabled={busy} onClick={onSignIn}>
              {busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>}
              {authorizing ? tr("ui.1ece23584f21") : tr("authGate.login")}
            </button>
            {authorizing && (<button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{tr("ui.f21bbc4eadf4")}</button>)}
            {!authorizing && (<div className="auth-gate-register">
              <span>{tr("authGate.registerPrompt")}</span>
              <button type="button" disabled={busy} onClick={onRegister}>{tr("authGate.register")}</button>
            </div>)}
          </div>)}
      </section>
    </main>);
}
