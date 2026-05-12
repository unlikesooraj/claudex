import { contextBridge, ipcRenderer } from "electron";
import type { OpenSessionRequest } from "./sessionLauncher.js";

contextBridge.exposeInMainWorld("claudex", {
  sessions: () => ipcRenderer.invoke("claudex:sessions"),
  open: (request: OpenSessionRequest) => ipcRenderer.invoke("claudex:open", request),
});
