import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { findOpenAppSession, type NativeAppInfo, type OpenAppSession } from "./nativeSessions.js";
import { type SessionSource } from "./sessionIndex.js";

export interface OpenSessionRequest {
  source?: SessionSource;
  sessionId?: string;
  target?: "native" | "claude" | "codex";
}

export interface OpenSessionResult {
  ok: boolean;
  source?: SessionSource;
  target?: SessionSource;
  cwd?: string;
  action?: "open-chat" | "open-project" | "focus-app";
  exact?: boolean;
  launched?: string;
  note?: string;
  error?: string;
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function spawnDetached(file: string, args: string[], cwd?: string): void {
  const child = spawn(file, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function runPowerShell(script: string): void {
  spawnDetached("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    script,
  ]);
}

function startUri(uri: string): void {
  if (platform() === "win32") {
    spawnDetached("explorer.exe", [uri]);
    return;
  }
  if (platform() === "darwin") {
    spawnDetached("open", [uri]);
    return;
  }
  spawnDetached("xdg-open", [uri]);
}

function focusWindow(title: string): void {
  if (platform() !== "win32") return;
  runPowerShell(
    [
      "Start-Sleep -Milliseconds 250",
      "$shell = New-Object -ComObject WScript.Shell",
      `[void]$shell.AppActivate(${psString(title)})`,
    ].join("\n"),
  );
}

function openCodexChat(session: OpenAppSession): OpenSessionResult {
  const uri = session.launch.url ?? `codex:///local/${encodeURIComponent(session.sessionId)}`;
  startUri(uri);
  focusWindow("Codex");
  return {
    ok: true,
    source: session.source,
    target: "codex",
    cwd: session.cwd,
    action: "open-chat",
    exact: true,
    launched: uri,
    note: "Opened the Codex desktop local conversation route.",
  };
}

function claudeResumeUrl(session: OpenAppSession): string {
  const cliSessionId = session.cliSessionId ?? session.sessionId;
  return `claude://resume?session=${encodeURIComponent(cliSessionId)}`;
}

function claudeCodeNewUrl(cwd?: string): string {
  const params = new URLSearchParams();
  if (cwd) params.set("folder", cwd);
  const query = params.toString();
  return `claude://code/new${query ? `?${query}` : ""}`;
}

function openClaudeChat(session: OpenAppSession): OpenSessionResult {
  const uri = session.launch.url ?? claudeResumeUrl(session);
  startUri(uri);
  focusWindow("Claude");
  return {
    ok: true,
    source: session.source,
    target: "claude",
    cwd: session.cwd,
    action: "open-chat",
    exact: true,
    launched: uri,
    note: "Opened the Claude desktop Claude Code session.",
  };
}

function openCodexProject(session: OpenAppSession, app: NativeAppInfo): OpenSessionResult {
  if (session.cwdExists && app.executablePath && existsSync(app.executablePath)) {
    spawnDetached(app.executablePath, ["--open-project", session.cwd], session.cwd);
    focusWindow("Codex");
    return {
      ok: true,
      source: session.source,
      target: "codex",
      cwd: session.cwd,
      action: "open-project",
      exact: false,
      launched: `${app.executablePath} --open-project ${session.cwd}`,
      note: "Opened the connected folder in Codex desktop.",
    };
  }
  startUri("codex:");
  focusWindow("Codex");
  return {
    ok: true,
    source: session.source,
    target: "codex",
    cwd: session.cwd,
    action: "focus-app",
    exact: false,
    launched: "codex:",
    note: "Focused Codex desktop. The folder could not be passed because the Codex executable was not discoverable.",
  };
}

function openClaudeApp(session: OpenAppSession): OpenSessionResult {
  const uri = session.cwdExists ? claudeCodeNewUrl(session.cwd) : "claude:";
  startUri(uri);
  focusWindow("Claude");
  return {
    ok: true,
    source: session.source,
    target: "claude",
    cwd: session.cwd,
    action: session.cwdExists ? "open-project" : "focus-app",
    exact: false,
    launched: uri,
    note: session.cwdExists
      ? "Opened Claude desktop with the connected folder."
      : "Opened Claude desktop.",
  };
}

export function openSession(request: OpenSessionRequest): OpenSessionResult {
  if (
    (request.source !== "claude" && request.source !== "codex") ||
    typeof request.sessionId !== "string" ||
    !request.sessionId
  ) {
    return { ok: false, error: "source and sessionId are required." };
  }

  const { payload, session } = findOpenAppSession(request.source, request.sessionId);
  if (!session) {
    return {
      ok: false,
      error: "That chat is not currently open in the native app.",
    };
  }

  const target = request.target === "native" || !request.target ? session.source : request.target;
  try {
    if (target === "codex") {
      if (session.source === "codex") return openCodexChat(session);
      return openCodexProject(session, payload.apps.codex);
    }
    if (target === "claude") {
      if (session.source === "claude") return openClaudeChat(session);
      return openClaudeApp(session);
    }
    return { ok: false, error: `Unknown target: ${String(target)}` };
  } catch (err) {
    return {
      ok: false,
      source: session.source,
      target,
      cwd: session.cwd,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
