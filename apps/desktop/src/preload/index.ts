import { contextBridge, ipcRenderer } from "electron";
import type { RouteMarketWorkApi } from "../shared/desktop-api";

const api: RouteMarketWorkApi = {
  getState: () => ipcRenderer.invoke("work:get-state"),
  signIn: () => ipcRenderer.invoke("work:sign-in"),
  signOut: () => ipcRenderer.invoke("work:sign-out"),
  chooseProject: () => ipcRenderer.invoke("work:choose-project"),
  listProjectFiles: (localProjectId) =>
    ipcRenderer.invoke("work:list-project-files", localProjectId),
  readProjectFile: (localProjectId, relativePath) =>
    ipcRenderer.invoke("work:read-project-file", localProjectId, relativePath)
};

contextBridge.exposeInMainWorld("routeMarketWork", api);
