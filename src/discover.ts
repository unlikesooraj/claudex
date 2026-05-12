// Walks ~/.claude/projects and ~/.codex/sessions, discovers every JSONL,
// groups them by the cwd recorded inside, and ingests all turns into the store.
// The point: a brand-new claudex install instantly has rolling context for
// every project the user has ever touched. No per-project setup.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseClaudeLine } from "./parsers/claude.js";
import { parseCodexLine, makeCodexState } from "./parsers/codex.js";
import { projectKeyFromCwd } from "./projectKey.js";
import { insertTurn, recordSession, recentTurnsForProject } from "./store.js";
import { writeProjectContext } from "./contextBuilder.js";
import { CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR } from "./paths.js";
import type { Turn } from "./types.js";

function walkJsonl(root: string): string[] {
  const out: string[] = [];
  function recur(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let s;
      try {
        s = statSync(path);
      } catch {
        continue;
      }
      if (s.isDirectory()) recur(path);
      else if (s.isFile() && path.endsWith(".jsonl")) out.push(path);
    }
  }
  recur(root);
  return out;
}

export interface SyncReport {
  filesScanned: number;
  turnsIngested: number;
  projects: Array<{ hash: string; cwd: string; turns: number }>;
}

export function syncAll(opts: { verbose?: boolean } = {}): SyncReport {
  const claudeFiles = walkJsonl(CLAUDE_PROJECTS_DIR);
  const codexFiles = walkJsonl(CODEX_SESSIONS_DIR);

  if (opts.verbose) {
    console.log(`claude jsonl files: ${claudeFiles.length}`);
    console.log(`codex  jsonl files: ${codexFiles.length}`);
  }

  // project_hash -> { cwd, lastTurn }
  const touched = new Map<string, { cwd: string; turnCount: number; last?: Turn }>();
  let ingested = 0;

  const ingest = (turn: Turn | null) => {
    if (!turn || !turn.cwd) return;
    const key = projectKeyFromCwd(turn.cwd);
    if (insertTurn(turn, key.hash)) ingested++;
    recordSession(key.hash, turn);
    const slot = touched.get(key.hash) ?? { cwd: key.cwd, turnCount: 0 };
    slot.cwd = key.cwd;
    slot.turnCount++;
    slot.last = turn;
    touched.set(key.hash, slot);
  };

  for (const f of claudeFiles) {
    let lines: string[];
    try {
      lines = readFileSync(f, "utf8").split("\n");
    } catch {
      continue;
    }
    for (const line of lines) ingest(parseClaudeLine(line));
  }

  for (const f of codexFiles) {
    let lines: string[];
    try {
      lines = readFileSync(f, "utf8").split("\n");
    } catch {
      continue;
    }
    const state = makeCodexState();
    for (const line of lines) ingest(parseCodexLine(line, state));
  }

  // Rebuild context.md per touched project.
  const projects: Array<{ hash: string; cwd: string; turns: number }> = [];
  for (const [hash, info] of touched) {
    const turns = recentTurnsForProject(hash, 400);
    writeProjectContext(hash, info.cwd, turns);
    projects.push({ hash, cwd: info.cwd, turns: info.turnCount });
  }

  return {
    filesScanned: claudeFiles.length + codexFiles.length,
    turnsIngested: ingested,
    projects: projects.sort((a, b) => b.turns - a.turns),
  };
}
