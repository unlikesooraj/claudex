import { app, BrowserWindow, ipcMain } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARD_HTML } from "./dashboard.js";
import { getSessionsPayload } from "./sessionPayload.js";
import { openSession, type OpenSessionRequest } from "./sessionLauncher.js";
import { CLAUDEX_HOME } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function appLog(message: string): void {
  try {
    mkdirSync(CLAUDEX_HOME, { recursive: true });
    appendFileSync(join(CLAUDEX_HOME, "app.log"), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // best effort only
  }
}

function createWindow(): void {
  appLog("creating window");
  mkdirSync(CLAUDEX_HOME, { recursive: true });
  const htmlPath = join(CLAUDEX_HOME, "app.html");
  writeFileSync(htmlPath, DASHBOARD_HTML, "utf8");

  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "Claudex",
    backgroundColor: "#0d1115",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "appPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("did-finish-load", () => appLog("window loaded"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    appLog(`window failed to load: ${code} ${description}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    appLog(`renderer gone: ${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    appLog(`renderer console ${level}: ${message}`);
  });

  void mainWindow.loadFile(htmlPath);

  if (process.env.CLAUDEX_APP_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

ipcMain.handle("claudex:sessions", () => {
  appLog("sessions requested");
  const started = Date.now();
  const payload = getSessionsPayload();
  appLog(`sessions returned in ${Date.now() - started}ms`);
  return payload;
});
ipcMain.handle("claudex:open", (_event, request: OpenSessionRequest) => {
  appLog(`open requested: ${request?.source ?? "unknown"} ${request?.target ?? "native"}`);
  return openSession(request);
});

app.setName("Claudex");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  appLog("second instance quit");
  app.quit();
} else {
  app.on("second-instance", () => {
    appLog("second instance focus");
    focusMainWindow();
  });

  app.whenReady().then(() => {
    appLog("app ready");
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    appLog("window-all-closed");
    if (process.platform !== "darwin") app.quit();
  });
}

process.on("uncaughtException", (err) => appLog(`uncaughtException: ${err.stack ?? err.message}`));
process.on("unhandledRejection", (err) => appLog(`unhandledRejection: ${String(err)}`));
