// JSONL-backed store. No native deps so install is zero-friction on every platform.
// Schema is simple enough for v0.1 — if scale becomes a problem we can swap in
// node:sqlite (Node 22+) without changing this API surface.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Turn } from "./types.js";
import { CLAUDEX_HOME, projectMirrorDir } from "./paths.js";

interface SessionState {
  lastSource: "claude" | "codex";
  lastSession: string;
  lastTs: string;
  cwd: string;
}

const STATE_FILE = join(CLAUDEX_HOME, "session-state.json");

function ensureMirror(projectHash: string): string {
  const dir = projectMirrorDir(projectHash);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function timelinePath(projectHash: string): string {
  return join(ensureMirror(projectHash), "timeline.jsonl");
}

function seenIdsPath(projectHash: string): string {
  return join(ensureMirror(projectHash), "ids.txt");
}

const seenCache = new Map<string, Set<string>>();
function loadSeen(projectHash: string): Set<string> {
  const cached = seenCache.get(projectHash);
  if (cached) return cached;
  const path = seenIdsPath(projectHash);
  const set = new Set<string>();
  if (existsSync(path)) {
    for (const id of readFileSync(path, "utf8").split("\n")) {
      if (id) set.add(id);
    }
  }
  seenCache.set(projectHash, set);
  return set;
}

export function insertTurn(turn: Turn, projectHash: string): boolean {
  const seen = loadSeen(projectHash);
  if (seen.has(turn.id)) return false;
  seen.add(turn.id);
  appendFileSync(seenIdsPath(projectHash), turn.id + "\n");
  appendFileSync(
    timelinePath(projectHash),
    JSON.stringify({ ...turn, projectHash }) + "\n",
  );
  return true;
}

export function recentTurnsForProject(projectHash: string, limit = 200): Turn[] {
  const path = timelinePath(projectHash);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  const tail = lines.slice(-limit);
  const turns: Turn[] = [];
  for (const line of tail) {
    try {
      turns.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  // Already chronological in the file.
  return turns;
}

function readState(): Record<string, SessionState> {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state: Record<string, SessionState>): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function recordSession(projectHash: string, turn: Turn): void {
  const state = readState();
  state[projectHash] = {
    lastSource: turn.source,
    lastSession: turn.sessionId,
    lastTs: turn.ts,
    cwd: turn.cwd,
  };
  writeState(state);
}

export function getSessionState(projectHash: string): SessionState | null {
  return readState()[projectHash] ?? null;
}

export function listSessions(limit = 20): Array<SessionState & { projectHash: string }> {
  const state = readState();
  return Object.entries(state)
    .map(([projectHash, s]) => ({ projectHash, ...s }))
    .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))
    .slice(0, limit);
}
