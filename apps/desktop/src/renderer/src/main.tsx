import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./styles/tokens.css";
import "./app/app-shell.css";
import "./app/account-menu.css";
import "./features/projects/project-sidebar.css";
import "./features/chat/chat.css";
import "./features/browser/browser.css";
import "./features/files/files.css";
import "./features/workflow/workflow.css";
import { applyThemePreference, getStoredThemePreference } from "./app/theme";

applyThemePreference(getStoredThemePreference());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
