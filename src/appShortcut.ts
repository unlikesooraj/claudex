import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLAUDEX_HOME } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

export interface AppShortcutResult {
  ok: boolean;
  paths: string[];
  reason?: string;
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shortcutScript(paths: string[], target: string, args: string, workingDir: string, icon: string): string {
  const shortcutPaths = `@(${paths.map(psString).join(",")})`;
  return `
$ErrorActionPreference = "Stop"
$paths = ${shortcutPaths}
foreach ($path in $paths) {
  $dir = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = ${psString(target)}
  $shortcut.Arguments = ${psString(args)}
  $shortcut.WorkingDirectory = ${psString(workingDir)}
  $shortcut.WindowStyle = 1
  $shortcut.Description = "Claudex local session bridge"
  if (Test-Path ${psString(icon)}) {
    $shortcut.IconLocation = ${psString(icon)}
  }
  $shortcut.Save()
}
`;
}

function windowsSystemExe(name: string): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", name);
}

function writeHiddenNodeLauncher(cliPath: string): string {
  mkdirSync(CLAUDEX_HOME, { recursive: true });
  const scriptPath = join(CLAUDEX_HOME, "launch-claudex.vbs");
  const command = `"${process.execPath}" "${cliPath}" app`;
  const escapedCommand = command.replace(/"/g, '""');
  writeFileSync(
    scriptPath,
    [
      "Set shell = CreateObject(\"WScript.Shell\")",
      `shell.Run "${escapedCommand}", 0, False`,
      "Set shell = Nothing",
      "",
    ].join("\r\n"),
    "utf8",
  );
  return scriptPath;
}

export function installAppShortcuts(): AppShortcutResult {
  if (platform() !== "win32") {
    return {
      ok: false,
      paths: [],
      reason: "App shortcuts are currently implemented for Windows only.",
    };
  }

  const cliPath = join(PKG_ROOT, "dist", "cli.js");
  if (!existsSync(cliPath)) {
    return {
      ok: false,
      paths: [],
      reason: `Missing CLI entry: ${cliPath}. Run npm run build first.`,
    };
  }

  const startMenu = join(
    process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Claudex.lnk",
  );
  const desktop = join(homedir(), "Desktop", "Claudex.lnk");
  const electronExe = join(PKG_ROOT, "node_modules", "electron", "dist", "electron.exe");
  const appMainPath = join(PKG_ROOT, "dist", "appMain.js");
  const target = existsSync(electronExe) ? electronExe : windowsSystemExe("wscript.exe");
  const args = existsSync(electronExe) ? `"${appMainPath}"` : `"${writeHiddenNodeLauncher(cliPath)}"`;
  const icon = existsSync(electronExe) ? electronExe : cliPath;
  const ps = shortcutScript([startMenu, desktop], target, args, PKG_ROOT, icon);

  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return {
      ok: false,
      paths: [],
      reason: result.stderr || result.stdout || `PowerShell exited with ${result.status}`,
    };
  }

  return { ok: true, paths: [startMenu, desktop] };
}
