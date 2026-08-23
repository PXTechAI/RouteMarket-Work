import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopAnalyticsEvent,
  DesktopUpdateState,
  DesktopWorkflowRunEvent,
  ProjectChatEvent,
  RouteMarketWorkApi
} from "../shared/desktop-api";

function trackAnalytics(event: DesktopAnalyticsEvent): void {
  ipcRenderer.send("work:analytics-track", event);
}

const api: RouteMarketWorkApi = {
  onRuntimeError: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on("work:runtime-error", handler);
    return () => ipcRenderer.removeListener("work:runtime-error", handler);
  },
  getPreferences: () => ipcRenderer.invoke("work:get-preferences"),
  updatePreferences: (patch) => ipcRenderer.invoke("work:update-preferences", patch),
  setLocale: async (locale) => {
    await ipcRenderer.invoke("work:set-locale", locale);
    trackAnalytics({ name: "desktop_locale_changed", data: { locale } });
  },
  executeMenuCommand: (command) => ipcRenderer.invoke("work:execute-menu-command", command),
  setTitleBarTheme: (theme) => ipcRenderer.invoke("work:set-titlebar-theme", theme),
  setWorkbenchExpanded: (expanded, preferredPanelWidth) =>
    ipcRenderer.invoke("work:set-workbench-expanded", expanded, preferredPanelWidth),
  getState: () => ipcRenderer.invoke("work:get-state"),
  getAppInfo: () => ipcRenderer.invoke("work:get-app-info"),
  checkForUpdates: () => ipcRenderer.invoke("work:check-for-updates"),
  getUpdateState: () => ipcRenderer.invoke("work:get-update-state"),
  downloadUpdate: () => ipcRenderer.invoke("work:download-update"),
  installUpdate: () => ipcRenderer.invoke("work:install-update"),
  onDesktopUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => listener(state);
    ipcRenderer.on("work:update-state", handler);
    return () => ipcRenderer.removeListener("work:update-state", handler);
  },
  listMarketplaceCatalog: () => ipcRenderer.invoke("work:marketplace-catalog"),
  listDesktopExtensions: () => ipcRenderer.invoke("work:desktop-extensions-list"),
  refreshDesktopExtensions: () => ipcRenderer.invoke("work:desktop-extensions-refresh"),
  openDesktopExtensionPage: (pluginId, pageId) =>
    ipcRenderer.invoke("work:desktop-extension-open-page", pluginId, pageId),
  pickDesktopExtensionFile: (pluginId, request) =>
    ipcRenderer.invoke("work:desktop-extension-pick-file", pluginId, request),
  listMarketplacePluginInstallations: () => ipcRenderer.invoke("work:marketplace-plugin-installations"),
  prepareMarketplacePluginInstall: (pluginId) => ipcRenderer.invoke("work:marketplace-plugin-prepare", pluginId),
  prepareLocalPluginInstall: () => ipcRenderer.invoke("work:local-plugin-prepare"),
  cancelMarketplacePluginInstall: (installToken) => ipcRenderer.invoke("work:marketplace-plugin-cancel", installToken),
  installMarketplacePlugin: async (installToken) => {
    const result = await ipcRenderer.invoke("work:marketplace-plugin-install", installToken);
    trackAnalytics({ name: "desktop_marketplace_plugin_installed" });
    return result;
  },
  setMarketplacePluginEnabled: (pluginId, enabled) =>
    ipcRenderer.invoke("work:marketplace-plugin-set-enabled", pluginId, enabled),
  removeMarketplacePlugin: (pluginId) => ipcRenderer.invoke("work:marketplace-plugin-remove", pluginId),
  getLocalDataInfo: () => ipcRenderer.invoke("work:local-data-info"),
  listLocalDataScopes: () => ipcRenderer.invoke("work:local-data-scopes-list"),
  removeLocalDataScope: (scopeId) =>
    ipcRenderer.invoke("work:local-data-scope-remove", scopeId),
  showLocalData: () => ipcRenderer.invoke("work:local-data-show"),
  exportLocalData: () => ipcRenderer.invoke("work:local-data-export"),
  clearLocalData: () => ipcRenderer.invoke("work:local-data-clear"),
  clearActivities: () => ipcRenderer.invoke("work:activities-clear"),
  signIn: (intent) => {
    trackAnalytics({
      name: "desktop_auth_started",
      data: { intent: intent ?? "login" }
    });
    return ipcRenderer.invoke("work:sign-in", intent);
  },
  signOut: () => ipcRenderer.invoke("work:sign-out"),
  switchSpace: (spaceId) => ipcRenderer.invoke("work:switch-space", spaceId),
  removeApprovalPolicy: (policyId) =>
    ipcRenderer.invoke("work:approval-policy-remove", policyId),
  chooseProject: () => ipcRenderer.invoke("work:choose-project"),
  chooseWorkflowOutputDirectory: () =>
    ipcRenderer.invoke("work:workflow-output-directory-choose"),
  createProject: async (displayName) => {
    const result = await ipcRenderer.invoke("work:create-project", displayName);
    trackAnalytics({ name: "desktop_project_created" });
    return result;
  },
  renameProject: (localProjectId, displayName) =>
    ipcRenderer.invoke("work:rename-project", localProjectId, displayName),
  attachProjectFolder: (localProjectId) =>
    ipcRenderer.invoke("work:attach-project-folder", localProjectId),
  removeProjectFolder: (localProjectId, folderId) =>
    ipcRenderer.invoke("work:remove-project-folder", localProjectId, folderId),
  openProjectFolder: (localProjectId) => ipcRenderer.invoke("work:open-project-folder", localProjectId),
  deleteProject: (localProjectId) => ipcRenderer.invoke("work:delete-project", localProjectId),
  getProjectContext: (localProjectId) =>
    ipcRenderer.invoke("work:get-project-context", localProjectId),
  listProjectSkills: (localProjectId) =>
    ipcRenderer.invoke("work:local-skills-list", localProjectId),
  chooseAndInstallProjectSkill: (localProjectId, importKind) =>
    ipcRenderer.invoke("work:local-skill-install", localProjectId, importKind),
  listDownloadableCloudSkills: () =>
    ipcRenderer.invoke("work:cloud-skills-list"),
  installCloudSkill: (localProjectId, skillId, versionId) =>
    ipcRenderer.invoke(
      "work:cloud-skill-install",
      localProjectId,
      skillId,
      versionId
    ),
  removeInstalledProjectSkill: (localProjectId, skillId) =>
    ipcRenderer.invoke("work:local-skill-remove", localProjectId, skillId),
  getWorkflowNodeRegistry: (localProjectId) =>
    ipcRenderer.invoke("work:get-workflow-node-registry", localProjectId),
  listProjectFiles: (localProjectId) =>
    ipcRenderer.invoke("work:list-project-files", localProjectId),
  searchProject: (localProjectId, query) =>
    ipcRenderer.invoke("work:search-project", localProjectId, query),
  readProjectFile: (localProjectId, relativePath) =>
    ipcRenderer.invoke("work:read-project-file", localProjectId, relativePath),
  readProjectAsset: (localProjectId, relativePath) =>
    ipcRenderer.invoke("work:read-project-asset", localProjectId, relativePath),
  previewProjectArtifact: (localProjectId, relativePath, selectedSheetId, pageNumber) =>
    ipcRenderer.invoke("work:preview-project-artifact", localProjectId, relativePath, selectedSheetId, pageNumber),
  chooseChatAttachments: (maxCount) =>
    ipcRenderer.invoke("work:chat-attachments-choose", maxCount),
  uploadChatAttachments: (files) =>
    ipcRenderer.invoke("work:chat-attachments-upload", files),
  discardChatAttachment: (attachmentId) =>
    ipcRenderer.invoke("work:chat-attachment-discard", attachmentId),
  writeProjectFile: (localProjectId, relativePath, text, expectedSha256) =>
    ipcRenderer.invoke(
      "work:write-project-file",
      localProjectId,
      relativePath,
      text,
      expectedSha256
    ),
  createProjectFile: (localProjectId, relativePath, text) =>
    ipcRenderer.invoke("work:create-project-file", localProjectId, relativePath, text),
  listProjectFileVersions: (localProjectId, relativePath) =>
    ipcRenderer.invoke("work:file-versions-list", localProjectId, relativePath),
  readProjectFileVersion: (localProjectId, relativePath, versionId) =>
    ipcRenderer.invoke("work:file-version-read", localProjectId, relativePath, versionId),
  restoreProjectFileVersion: (localProjectId, relativePath, versionId) =>
    ipcRenderer.invoke("work:file-version-restore", localProjectId, relativePath, versionId),
  exportProjectFile: (localProjectId, relativePath, versionId) =>
    ipcRenderer.invoke("work:file-export", localProjectId, relativePath, versionId),
  startProcess: (localProjectId, executable, args) =>
    ipcRenderer.invoke("work:start-process", localProjectId, executable, args),
  listProcesses: () => ipcRenderer.invoke("work:list-processes"),
  stopProcess: (processId) => ipcRenderer.invoke("work:stop-process", processId),
  getBrowserState: (localProjectId) => ipcRenderer.invoke("work:browser-state", localProjectId),
  showBrowser: (localProjectId, bounds) =>
    ipcRenderer.invoke("work:browser-show", localProjectId, bounds),
  getWorkflowBrowserState: (localProjectId, workflowId) =>
    ipcRenderer.invoke("work:workflow-browser-state", localProjectId, workflowId),
  showWorkflowBrowser: (localProjectId, workflowId, bounds) =>
    ipcRenderer.invoke("work:workflow-browser-show", localProjectId, workflowId, bounds),
  hideBrowser: () => ipcRenderer.invoke("work:browser-hide"),
  setBrowserBounds: (bounds) => ipcRenderer.invoke("work:browser-bounds", bounds),
  createBrowserPage: (localProjectId, profileId) =>
    ipcRenderer.invoke("work:browser-page-create", localProjectId, profileId),
  selectBrowserPage: (localProjectId, pageId) =>
    ipcRenderer.invoke("work:browser-page-select", localProjectId, pageId),
  closeBrowserPage: (localProjectId, pageId) =>
    ipcRenderer.invoke("work:browser-page-close", localProjectId, pageId),
  createBrowserProfile: (localProjectId, input) =>
    ipcRenderer.invoke("work:browser-profile-create", localProjectId, input),
  updateBrowserProfile: (localProjectId, profileId, input) =>
    ipcRenderer.invoke("work:browser-profile-update", localProjectId, profileId, input),
  deleteBrowserProfile: (localProjectId, profileId) =>
    ipcRenderer.invoke("work:browser-profile-delete", localProjectId, profileId),
  navigateBrowser: (localProjectId, url, pageId) =>
    ipcRenderer.invoke("work:browser-navigate", localProjectId, url, pageId),
  browserBack: (localProjectId, pageId) =>
    ipcRenderer.invoke("work:browser-back", localProjectId, pageId),
  browserForward: (localProjectId, pageId) =>
    ipcRenderer.invoke("work:browser-forward", localProjectId, pageId),
  reloadBrowser: (localProjectId, pageId) =>
    ipcRenderer.invoke("work:browser-reload", localProjectId, pageId),
  setBrowserTakeover: (localProjectId, userTakeover, pageId) =>
    ipcRenderer.invoke("work:browser-takeover", localProjectId, userTakeover, pageId),
  clickBrowser: (localProjectId, selector, pageId) =>
    ipcRenderer.invoke("work:browser-click", localProjectId, selector, pageId),
  typeBrowser: (localProjectId, selector, text, pageId) =>
    ipcRenderer.invoke("work:browser-type", localProjectId, selector, text, pageId),
  uploadBrowser: (localProjectId, selector, relativePaths, pageId) =>
    ipcRenderer.invoke(
      "work:browser-upload",
      localProjectId,
      selector,
      relativePaths,
      pageId
    ),
  extractBrowser: (localProjectId, selector, pageId) =>
    ipcRenderer.invoke("work:browser-extract", localProjectId, selector, pageId),
  screenshotBrowser: (localProjectId, pageId) =>
    ipcRenderer.invoke("work:browser-screenshot", localProjectId, pageId),
  retryBrowserOperation: (localProjectId, operationId) =>
    ipcRenderer.invoke("work:browser-operation-retry", localProjectId, operationId),
  discoverAttachedBrowser: (endpoint) =>
    ipcRenderer.invoke("work:attached-browser-discover", endpoint),
  connectAttachedBrowser: (endpoint, targetId) =>
    ipcRenderer.invoke("work:attached-browser-connect", endpoint, targetId),
  disconnectAttachedBrowser: () => ipcRenderer.invoke("work:attached-browser-disconnect"),
  navigateAttachedBrowser: (url) => ipcRenderer.invoke("work:attached-browser-navigate", url),
  clickAttachedBrowser: (selector) => ipcRenderer.invoke("work:attached-browser-click", selector),
  typeAttachedBrowser: (selector, text) =>
    ipcRenderer.invoke("work:attached-browser-type", selector, text),
  extractAttachedBrowser: (selector) =>
    ipcRenderer.invoke("work:attached-browser-extract", selector),
  screenshotAttachedBrowser: () => ipcRenderer.invoke("work:attached-browser-screenshot"),
  listLocalTriggers: (localProjectId) => ipcRenderer.invoke("work:local-trigger-list", localProjectId),
  saveLocalTrigger: (input, triggerId) => ipcRenderer.invoke("work:local-trigger-save", input, triggerId),
  removeLocalTrigger: (triggerId) => ipcRenderer.invoke("work:local-trigger-remove", triggerId),
  fireLocalTrigger: (triggerId) => ipcRenderer.invoke("work:local-trigger-fire", triggerId),
  listNativeAppConnectors: () => ipcRenderer.invoke("work:native-app-list"),
  openNativeAppConnector: (connectorId, localProjectId, relativePath) =>
    ipcRenderer.invoke("work:native-app-open", connectorId, localProjectId, relativePath),
  listDesktopWorkflowDrafts: (localProjectId) => ipcRenderer.invoke("work:workflow-draft-list", localProjectId),
  getDesktopWorkflowDraft: (localProjectId, workflowId) => ipcRenderer.invoke("work:workflow-draft-get", localProjectId, workflowId),
  saveDesktopWorkflowDraft: (draft) => ipcRenderer.invoke("work:workflow-draft-save", draft),
  deleteDesktopWorkflowDraft: (localProjectId, workflowId) => ipcRenderer.invoke("work:workflow-draft-delete", localProjectId, workflowId),
  runDesktopWorkflow: async (localProjectId, workflowId, input) => {
    const result = await ipcRenderer.invoke("work:workflow-run", localProjectId, workflowId, input);
    trackAnalytics({ name: "desktop_workflow_run_started" });
    return result;
  },
  getDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-get", runId),
  listDesktopWorkflowRuns: (localProjectId, workflowId) =>
    ipcRenderer.invoke("work:workflow-run-list", localProjectId, workflowId),
  cancelDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-cancel", runId),
  resumeDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-resume", runId),
  retryDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-retry", runId),
  openDesktopWorkflowArtifact: (runId, action) =>
    ipcRenderer.invoke("work:workflow-artifact-open", runId, action),
  onDesktopWorkflowRunEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopWorkflowRunEvent
    ) => {
      listener(payload);
    };
    ipcRenderer.on("work:workflow-run-event", handler);
    return () => ipcRenderer.removeListener("work:workflow-run-event", handler);
  },
  installMcpServer: (input) => ipcRenderer.invoke("work:mcp-install", input),
  listMcpServers: () => ipcRenderer.invoke("work:mcp-list"),
  startMcpServer: (serverId) => ipcRenderer.invoke("work:mcp-start", serverId),
  stopMcpServer: (serverId) => ipcRenderer.invoke("work:mcp-stop", serverId),
  removeMcpServer: (serverId) => ipcRenderer.invoke("work:mcp-remove", serverId),
  refreshMcpTools: (serverId) => ipcRenderer.invoke("work:mcp-tools-refresh", serverId),
  callMcpTool: (serverId, name, args) =>
    ipcRenderer.invoke("work:mcp-tool-call", serverId, name, args),
  listAgentProfiles: () => ipcRenderer.invoke("work:list-agent-profiles"),
  listChatModels: () => ipcRenderer.invoke("work:list-chat-models"),
  listMediaModels: (kind) => ipcRenderer.invoke("work:list-media-models", kind),
  listMediaInspiration: (input) => ipcRenderer.invoke("work:list-media-inspiration", input),
  listMediaInspirationTags: (kind) => ipcRenderer.invoke("work:list-media-inspiration-tags", kind),
  generateMedia: (input) => ipcRenderer.invoke("work:generate-media", input),
  listModelProviders: () => ipcRenderer.invoke("work:model-providers-list"),
  saveModelProvider: (input) => ipcRenderer.invoke("work:model-provider-save", input),
  syncModelProvider: (providerId) => ipcRenderer.invoke("work:model-provider-sync", providerId),
  removeModelProvider: (providerId) => ipcRenderer.invoke("work:model-provider-remove", providerId),
  getLocalApiGateway: () => ipcRenderer.invoke("work:local-api-gateway-get"),
  updateLocalApiGateway: (input) => ipcRenderer.invoke("work:local-api-gateway-update", input),
  saveLocalApiGatewayRoute: (input) => ipcRenderer.invoke("work:local-api-route-save", input),
  removeLocalApiGatewayRoute: (routeId) => ipcRenderer.invoke("work:local-api-route-remove", routeId),
  listLocalApiGatewayUsage: (limit) => ipcRenderer.invoke("work:local-api-usage-list", limit),
  listLocalProjectChats: (localProjectId) => ipcRenderer.invoke("work:list-local-project-chats", localProjectId),
  listRecentLocalChats: (limit) => ipcRenderer.invoke("work:list-recent-local-chats", limit),
  createLocalProjectChat: async (localProjectId) => {
    const result = await ipcRenderer.invoke("work:create-local-project-chat", localProjectId);
    trackAnalytics({
      name: "desktop_chat_created",
      data: { scope: localProjectId ? "project" : "standalone" }
    });
    return result;
  },
  renameLocalProjectChat: (localProjectId, sessionId, title) =>
    ipcRenderer.invoke("work:rename-local-project-chat", localProjectId, sessionId, title),
  deleteLocalProjectChat: (localProjectId, sessionId) =>
    ipcRenderer.invoke("work:delete-local-project-chat", localProjectId, sessionId),
  moveLocalProjectChat: (localProjectId, sessionId, targetProjectId) =>
    ipcRenderer.invoke("work:move-local-project-chat", localProjectId, sessionId, targetProjectId),
  getLocalProjectChat: (localProjectId, sessionId) =>
    ipcRenderer.invoke("work:get-local-project-chat", localProjectId, sessionId),
  truncateLocalProjectChat: (localProjectId, messageId) =>
    ipcRenderer.invoke("work:truncate-local-project-chat", localProjectId, messageId),
  sendProjectMessage: async (input) => {
    await ipcRenderer.invoke("work:send-project-message", input);
    trackAnalytics({
      name: "desktop_message_sent",
      data: {
        scope: input.project ? "project" : "standalone",
        hasAttachments: Boolean(input.attachments?.length),
        hasAgent: Boolean(input.agent),
        webSearchEnabled: Boolean(input.webSearchMode && input.webSearchMode !== "off")
      }
    });
  },
  stopProjectMessage: (requestId) =>
    ipcRenderer.invoke("work:stop-project-message", requestId),
  onProjectChatEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ProjectChatEvent) => {
      listener(payload);
    };
    ipcRenderer.on("work:project-chat-event", handler);
    return () => ipcRenderer.removeListener("work:project-chat-event", handler);
  }
};

contextBridge.exposeInMainWorld("routeMarketWork", api);
