import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/primitives.css";
import "./styles/workspace.css";
import "./app/app-shell.css";
import "./app/account-menu.css";
import "./app/auth-gate.css";
import "./app/activity-menu.css";
import "./features/projects/project-sidebar.css";
import "./features/projects/project-dialog.css";
import "./features/chat/chat.css";
import "./features/agent/agent.css";
import "./features/approvals/approval.css";
import "./features/browser/browser.css";
import "./features/files/files.css";
import "./features/mcp/mcp.css";
import "./features/terminal/terminal.css";
import "./features/workflow/workflow.css";
import { resolveBuildEnvironment } from "./app/build-environment";
import { applyThemePreference, getStoredThemePreference } from "./app/theme";

applyThemePreference(getStoredThemePreference());
const buildEnvironment = resolveBuildEnvironment(import.meta.env.MODE, import.meta.env.DEV);
document.title = buildEnvironment
  ? `RouteMarket Work · ${buildEnvironment.label}`
  : "RouteMarket Work";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
