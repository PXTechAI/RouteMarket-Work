import React from "react";
import ReactDOM from "react-dom/client";
import type { DesktopPreferences, DesktopUpdateState } from "../../shared/desktop-api";
import "@xyflow/react/dist/style.css";
import "./styles/tokens.scss";
import "./styles/reset.scss";
import "./styles/primitives.scss";
import "./styles/workspace.scss";
import { App } from "./App";
import { resolveBuildEnvironment } from "./app/build-environment";
import { RuntimeErrorBoundary } from "./app/RuntimeErrorBoundary";
import { DesktopUpdateCard } from "./app/DesktopUpdateCard";
import { hydrateDesktopPreferences } from "./app/desktop-preferences";
import { applyThemePreference, getStoredThemePreference } from "./app/theme";
import { initializeLocale } from "./i18n";

const buildEnvironment = resolveBuildEnvironment(import.meta.env.MODE, import.meta.env.DEV);
const updatePreviewState: DesktopUpdateState | undefined =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("desktop-update-preview") === "downloading"
    ? {
        status: "downloading",
        version: "0.3.0",
        percent: 68,
        transferredBytes: 24.8 * 1_024 * 1_024,
        totalBytes: 36.2 * 1_024 * 1_024,
        bytesPerSecond: 2.4 * 1_024 * 1_024,
        error: null,
      }
    : undefined;
document.title = buildEnvironment ? `RouteMarket Work · ${buildEnvironment.label}` : "RouteMarket Work";

void bootstrap();

async function bootstrap(): Promise<void> {
  const bridge = window.routeMarketWork;
  bridge?.onRuntimeError((message) => {
    window.dispatchEvent(new CustomEvent("routemarket:runtime-error", { detail: message }));
  });
  const preferences: DesktopPreferences = bridge
    ? await hydrateDesktopPreferences(bridge).catch((): DesktopPreferences => ({}))
    : {};
  applyThemePreference(preferences.theme ?? getStoredThemePreference());
  initializeLocale(preferences.locale);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <RuntimeErrorBoundary>
        <App />
        <DesktopUpdateCard api={bridge} initialState={updatePreviewState} />
      </RuntimeErrorBoundary>
    </React.StrictMode>,
  );
}
