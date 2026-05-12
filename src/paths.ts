import { homedir, platform } from "node:os";
import { join } from "node:path";

const HOME = homedir();

/** Root of all claudex state on this machine. */
export const CLAUDEX_HOME = process.env.CLAUDEX_HOME ?? join(HOME, ".claudex");

export const SHARED_DIR = join(CLAUDEX_HOME, "shared");
export const MIRROR_DIR = join(CLAUDEX_HOME, "mirror");
export const DB_PATH = join(CLAUDEX_HOME, "db.sqlite");
export const DAEMON_LOG = join(CLAUDEX_HOME, "daemon.log");
export const DAEMON_PID = join(CLAUDEX_HOME, "daemon.pid");

/** Where Claude Code writes its session JSONL files. */
export const CLAUDE_PROJECTS_DIR = join(HOME, ".claude", "projects");
export const CLAUDE_SETTINGS = join(HOME, ".claude", "settings.json");

/** Where Codex CLI writes its session rollouts. */
export const CODEX_SESSIONS_DIR = join(HOME, ".codex", "sessions");
export const CODEX_CONFIG = join(HOME, ".codex", "config.toml");

export const IS_WINDOWS = platform() === "win32";

export function projectSharedDir(hash: string): string {
  return join(SHARED_DIR, hash);
}
export function projectMirrorDir(hash: string): string {
  return join(MIRROR_DIR, hash);
}
