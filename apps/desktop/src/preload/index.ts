import { contextBridge, ipcRenderer } from "electron";
import type {
  ProjectChatEvent,
  RouteMarketWorkApi
} from "../shared/desktop-api";

const api: RouteMarketWorkApi = {
  getState: () => ipcRenderer.invoke("work:get-state"),
  signIn: () => ipcRenderer.invoke("work:sign-in"),
  signOut: () => ipcRenderer.invoke("work:sign-out"),
  chooseProject: () => ipcRenderer.invoke("work:choose-project"),
  listProjectFiles: (localProjectId) =>
    ipcRenderer.invoke("work:list-project-files", localProjectId),
  readProjectFile: (localProjectId, relativePath) =>
    ipcRenderer.invoke("work:read-project-file", localProjectId, relativePath),
  listChatModels: () => ipcRenderer.invoke("work:list-chat-models"),
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
