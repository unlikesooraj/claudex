import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAEMON_PID } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  started?: boolean;
  reason?: string;
}

function readPid(): number | undefined {
  if (!existsSync(DAEMON_PID)) return undefined;
  const pid = Number(readFileSync(DAEMON_PID, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function pidIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function daemonStatus(): DaemonStatus {
  const pid = readPid();
  if (!pid) return { running: false, reason: "no pid file" };
  if (pidIsRunning(pid)) return { running: true, pid };
  try {
    unlinkSync(DAEMON_PID);
  } catch {
    // Best effort cleanup.
  }
  return { running: false, pid, reason: "stale pid file" };
}

function nodeRuntime(): string {
  const exe = basename(process.execPath).toLowerCase();
  return exe.includes("electron") ? "node" : process.execPath;
}

export function ensureDaemonRunning(): DaemonStatus {
  const current = daemonStatus();
  if (current.running) return current;

  const entry = join(__dirname, "daemon.js");
  const child = spawn(nodeRuntime(), [entry], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { running: true, pid: child.pid, started: true, reason: current.reason };
}
