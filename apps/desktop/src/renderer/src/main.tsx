import React from "react";
import ReactDOM from "react-dom/client";
import type { DesktopPreferences } from "../../shared/desktop-api";
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/primitives.css";
import "./styles/workspace.css";
import "./app/app-shell.css";
import "./app/output-menu.css";
import "./app/account-menu.css";
import "./app/auth-gate.css";
import "./app/activity-menu.css";
import "./app/runtime-error.css";
import "./features/projects/project-sidebar.css";
import "./features/projects/project-dialog.css";
import "./features/project-skills/project-skills.css";
import "./features/chat/chat.css";
import "./features/agent/agent.css";
import "./features/approvals/approval.css";
import "./features/browser/browser.css";
import "./features/files/files.css";
import "./features/settings/settings.css";
import "./features/mcp/mcp.css";
import "./features/terminal/terminal.css";
import "./features/workflow/workflow.css";
import { resolveBuildEnvironment } from "./app/build-environment";
import { RuntimeErrorBoundary } from "./app/RuntimeErrorBoundary";
import { hydrateDesktopPreferences } from "./app/desktop-preferences";
import { applyThemePreference, getStoredThemePreference } from "./app/theme";
import { initializeLocale } from "./i18n";

const buildEnvironment = resolveBuildEnvironment(import.meta.env.MODE, import.meta.env.DEV);
document.title = buildEnvironment
  ? `RouteMarket Work · ${buildEnvironment.label}`
  : "RouteMarket Work";

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
      <RuntimeErrorBoundary><App /></RuntimeErrorBoundary>
    </React.StrictMode>
  );
}
