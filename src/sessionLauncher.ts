import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { CLAUDEX_HOME } from "./paths.js";
import { scanAllSessions, type SessionSource, type SessionSummary } from "./sessionIndex.js";

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
  command?: string;
  scriptPath?: string;
  error?: string;
}

function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteSh(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandFor(session: SessionSummary, target: "native" | "claude" | "codex"): string {
  const resolvedTarget = target === "native" ? session.source : target;
  if (resolvedTarget === "claude") {
    return session.source === "claude"
      ? `claude --resume ${quoteCmd(session.sessionId)}`
      : "claude";
  }
  return session.source === "codex"
    ? `codex resume ${quoteCmd(session.sessionId)}`
    : "codex";
}

function writeLaunchScript(session: SessionSummary, command: string): string {
  const dir = join(CLAUDEX_HOME, "launchers");
  mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (platform() === "win32") {
    const path = join(dir, `launch-${stamp}.cmd`);
    writeFileSync(
      path,
      [`@echo off`, `cd /d ${quoteCmd(session.cwd)}`, command, ""].join("\r\n"),
      "utf8",
    );
    return path;
  }
  const path = join(dir, `launch-${stamp}.sh`);
  writeFileSync(
    path,
    [`#!/usr/bin/env sh`, `cd ${quoteSh(session.cwd)} || exit 1`, command, ""].join("\n"),
    { encoding: "utf8", mode: 0o700 },
  );
  return path;
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

function openScriptInTerminal(scriptPath: string, cwd: string): void {
  const os = platform();
  if (os === "win32") {
    spawnDetached("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", scriptPath], cwd);
    return;
  }
  if (os === "darwin") {
    const escaped = quoteSh(scriptPath).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `tell application "Terminal" to do script "sh ${escaped}"`;
    spawnDetached("osascript", ["-e", script], cwd);
    return;
  }
  const terminals = [
    ["x-terminal-emulator", ["-e", "sh", scriptPath]],
    ["gnome-terminal", ["--", "sh", scriptPath]],
    ["konsole", ["-e", "sh", scriptPath]],
    ["xterm", ["-e", "sh", scriptPath]],
  ] as const;
  for (const [bin, args] of terminals) {
    try {
      spawnDetached(bin, [...args], cwd);
      return;
    } catch {
      // try the next terminal
    }
  }
  throw new Error(`No supported terminal found. Run: sh ${scriptPath}`);
}

function findSession(source: SessionSource, sessionId: string): SessionSummary | undefined {
  return scanAllSessions().find((s) => s.source === source && s.sessionId === sessionId);
}

export function openSession(request: OpenSessionRequest): OpenSessionResult {
  if (
    (request.source !== "claude" && request.source !== "codex") ||
    typeof request.sessionId !== "string" ||
    !request.sessionId
  ) {
    return { ok: false, error: "source and sessionId are required." };
  }

  const session = findSession(request.source, request.sessionId);
  if (!session) {
    return { ok: false, error: "Session was not found in local transcripts." };
  }

  const target = request.target ?? "native";
  const command = commandFor(session, target);
  const scriptPath = writeLaunchScript(session, command);
  try {
    openScriptInTerminal(scriptPath, session.cwd);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      scriptPath,
      command,
    };
  }

  return {
    ok: true,
    source: session.source,
    target: target === "native" ? session.source : target,
    cwd: session.cwd,
    command,
    scriptPath,
  };
}
