import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopWorkflowRunEvent,
  ProjectChatEvent,
  RouteMarketWorkApi
} from "../shared/desktop-api";

const api: RouteMarketWorkApi = {
  getState: () => ipcRenderer.invoke("work:get-state"),
  getLocalDataInfo: () => ipcRenderer.invoke("work:local-data-info"),
  showLocalData: () => ipcRenderer.invoke("work:local-data-show"),
  exportLocalData: () => ipcRenderer.invoke("work:local-data-export"),
  clearLocalData: () => ipcRenderer.invoke("work:local-data-clear"),
  clearActivities: () => ipcRenderer.invoke("work:activities-clear"),
  signIn: () => ipcRenderer.invoke("work:sign-in"),
  signOut: () => ipcRenderer.invoke("work:sign-out"),
  switchSpace: (spaceId) => ipcRenderer.invoke("work:switch-space", spaceId),
  removeApprovalPolicy: (policyId) =>
    ipcRenderer.invoke("work:approval-policy-remove", policyId),
  chooseProject: () => ipcRenderer.invoke("work:choose-project"),
  createProject: (displayName) => ipcRenderer.invoke("work:create-project", displayName),
  attachProjectFolder: (localProjectId) =>
    ipcRenderer.invoke("work:attach-project-folder", localProjectId),
  deleteProject: (localProjectId) => ipcRenderer.invoke("work:delete-project", localProjectId),
  getProjectContext: (localProjectId) =>
    ipcRenderer.invoke("work:get-project-context", localProjectId),
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
  runDesktopWorkflow: (localProjectId, workflowId, input) =>
    ipcRenderer.invoke("work:workflow-run", localProjectId, workflowId, input),
  getDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-get", runId),
  listDesktopWorkflowRuns: (localProjectId, workflowId) =>
    ipcRenderer.invoke("work:workflow-run-list", localProjectId, workflowId),
  cancelDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-cancel", runId),
  retryDesktopWorkflowRun: (runId) =>
    ipcRenderer.invoke("work:workflow-run-retry", runId),
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
  getLocalProjectChat: (localProjectId) =>
    ipcRenderer.invoke("work:get-local-project-chat", localProjectId),
  truncateLocalProjectChat: (localProjectId, messageId) =>
    ipcRenderer.invoke("work:truncate-local-project-chat", localProjectId, messageId),
  sendProjectMessage: (input) =>
    ipcRenderer.invoke("work:send-project-message", input),
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
