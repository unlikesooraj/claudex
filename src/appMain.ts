import { app, BrowserWindow, ipcMain } from "electron";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARD_HTML } from "./dashboard.js";
import { getSessionsPayload } from "./sessionPayload.js";
import { openSession, type OpenSessionRequest } from "./sessionLauncher.js";
import { CLAUDEX_HOME } from "./paths.js";
import { daemonStatus, ensureDaemonRunning } from "./daemonSupervisor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const ASSET_DIR = join(PKG_ROOT, "assets");

let mainWindow: BrowserWindow | null = null;

function appLog(message: string): void {
  try {
    mkdirSync(CLAUDEX_HOME, { recursive: true });
    appendFileSync(join(CLAUDEX_HOME, "app.log"), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // best effort only
  }
}

function appIconPath(): string | undefined {
  const iconPath = join(ASSET_DIR, "claudex-icon.ico");
  return existsSync(iconPath) ? iconPath : undefined;
}

function installRuntimeAssets(): void {
  const runtimeAssetDir = join(CLAUDEX_HOME, "assets");
  mkdirSync(runtimeAssetDir, { recursive: true });
  for (const name of [
    "claudex-icon.png",
    "claudex-logo-transparent.png",
    "claudex-mark.svg",
    "claudex-wordmark.svg",
  ]) {
    const src = join(ASSET_DIR, name);
    if (existsSync(src)) copyFileSync(src, join(runtimeAssetDir, name));
  }
}

function createWindow(): void {
  appLog("creating window");
  mkdirSync(CLAUDEX_HOME, { recursive: true });
  installRuntimeAssets();
  const htmlPath = join(CLAUDEX_HOME, "app.html");
  writeFileSync(htmlPath, DASHBOARD_HTML, "utf8");

  mainWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 520,
    minHeight: 520,
    title: "Claudex",
    backgroundColor: "#0f1114",
    autoHideMenuBar: true,
    icon: appIconPath(),
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
  const daemon = ensureDaemonRunning();
  if (daemon.started) appLog(`daemon restarted from app pid=${daemon.pid ?? "unknown"}`);
  const started = Date.now();
  const payload = getSessionsPayload();
  appLog(`sessions returned in ${Date.now() - started}ms`);
  return payload;
});
ipcMain.handle("claudex:open", (_event, request: OpenSessionRequest) => {
  appLog(`open requested: ${request?.source ?? "unknown"} ${request?.target ?? "native"}`);
  ensureDaemonRunning();
  return openSession(request);
});
ipcMain.handle("claudex:health", () => daemonStatus());

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
    const daemon = ensureDaemonRunning();
    if (daemon.started) appLog(`daemon started from app pid=${daemon.pid ?? "unknown"}`);
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
