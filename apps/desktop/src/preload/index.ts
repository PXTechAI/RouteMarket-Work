import { contextBridge, ipcRenderer } from "electron";
import type { RouteMarketWorkApi } from "../shared/desktop-api";

const api: RouteMarketWorkApi = {
  getState: () => ipcRenderer.invoke("work:get-state"),
  chooseProject: () => ipcRenderer.invoke("work:choose-project"),
  readReadme: (localProjectId) => ipcRenderer.invoke("work:read-readme", localProjectId)
};

contextBridge.exposeInMainWorld("routeMarketWork", api);
