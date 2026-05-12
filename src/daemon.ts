import chokidar from "chokidar";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseClaudeLine } from "./parsers/claude.js";
import { parseCodexLine, makeCodexState, type CodexParseState } from "./parsers/codex.js";
import { projectKeyFromCwd } from "./projectKey.js";
import { insertTurn, recordSession, recentTurnsForProject } from "./store.js";
import { writeProjectContext } from "./contextBuilder.js";
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_SESSIONS_DIR,
  CLAUDEX_HOME,
  DAEMON_LOG,
  DAEMON_PID,
} from "./paths.js";
import type { Turn } from "./types.js";

interface FileCursor {
  offset: number;
  codexState?: CodexParseState;
}

const cursors = new Map<string, FileCursor>();

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(DAEMON_LOG, line);
  } catch {
    // best effort
  }
}

async function readNewLines(path: string): Promise<string[]> {
  const cur = cursors.get(path) ?? { offset: 0 };
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return [];
  }
  if (stats.size <= cur.offset) {
    // File was rotated or truncated.
    if (stats.size < cur.offset) cur.offset = 0;
    else {
      cursors.set(path, cur);
      return [];
    }
  }

  const lines: string[] = [];
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path, { start: cur.offset, encoding: "utf8" });
    let buffer = "";
    let lastNewlineByte = cur.offset;
    let bytesRead = cur.offset;

    stream.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      buffer += text;
      bytesRead += Buffer.byteLength(text, "utf8");
      let idx;
      let consumed = 0;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        consumed += Buffer.byteLength(line, "utf8") + 1;
        if (line.trim()) lines.push(line);
      }
      lastNewlineByte = cur.offset + consumed;
    });
    stream.on("end", () => {
      cursors.set(path, { ...cur, offset: lastNewlineByte });
      resolve(lines);
    });
    stream.on("error", reject);
  });
}

// Debounce rebuilds per-project so an initial-load burst (e.g. chokidar firing
// "add" on every existing file at startup) doesn't trigger N rebuilds per project.
const pendingRebuild = new Map<string, { cwd: string; timer: NodeJS.Timeout }>();
function scheduleRebuild(hash: string, cwd: string): void {
  const existing = pendingRebuild.get(hash);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingRebuild.delete(hash);
    rebuildContextFor(hash, cwd);
  }, 750);
  pendingRebuild.set(hash, { cwd, timer });
}

async function handleClaudeFile(path: string): Promise<void> {
  const lines = await readNewLines(path);
  let inserted = false;
  let lastTurnByProject: Map<string, Turn> = new Map();
  for (const line of lines) {
    const turn = parseClaudeLine(line);
    if (!turn || !turn.cwd) continue;
    const key = projectKeyFromCwd(turn.cwd);
    if (insertTurn(turn, key.hash)) inserted = true;
    recordSession(key.hash, turn);
    lastTurnByProject.set(key.hash, turn);
  }
  if (!inserted) return; // No new turns — skip rebuild.
  for (const [hash, t] of lastTurnByProject) {
    scheduleRebuild(hash, t.cwd);
  }
}

async function handleCodexFile(path: string): Promise<void> {
  let cur = cursors.get(path);
  if (!cur) {
    cur = { offset: 0, codexState: makeCodexState() };
    cursors.set(path, cur);
  }
  if (!cur.codexState) cur.codexState = makeCodexState();
  const lines = await readNewLines(path);
  let inserted = false;
  let lastTurnByProject: Map<string, Turn> = new Map();
  for (const line of lines) {
    const turn = parseCodexLine(line, cur.codexState);
    if (!turn || !turn.cwd) continue;
    const key = projectKeyFromCwd(turn.cwd);
    if (insertTurn(turn, key.hash)) inserted = true;
    recordSession(key.hash, turn);
    lastTurnByProject.set(key.hash, turn);
  }
  if (!inserted) return;
  for (const [hash, t] of lastTurnByProject) {
    scheduleRebuild(hash, t.cwd);
  }
}

function rebuildContextFor(hash: string, cwd: string): void {
  const turns = recentTurnsForProject(hash, 400);
  const result = writeProjectContext(hash, cwd, turns);
  log(
    `context updated: hash=${hash} cwd=${cwd} turns=${result.turnsUsed} tokens=${result.tokensUsed}`,
  );
}

function writePidFile(): void {
  mkdirSync(dirname(DAEMON_PID), { recursive: true });
  writeFileSync(DAEMON_PID, String(process.pid), "utf8");
}

export async function startDaemon(): Promise<void> {
  mkdirSync(CLAUDEX_HOME, { recursive: true });
  writePidFile();
  log(`claudex daemon starting (pid ${process.pid})`);
  log(`  watching claude: ${CLAUDE_PROJECTS_DIR}`);
  log(`  watching codex:  ${CODEX_SESSIONS_DIR}`);

  // chokidar v4 dropped glob support — watch dirs recursively and filter in the handler.
  const claudeWatcher = chokidar.watch(CLAUDE_PROJECTS_DIR, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    ignored: (p, stats) => Boolean(stats?.isFile() && !p.endsWith(".jsonl")),
  });
  const codexWatcher = chokidar.watch(CODEX_SESSIONS_DIR, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    ignored: (p, stats) => Boolean(stats?.isFile() && !p.endsWith(".jsonl")),
  });

  const onClaude = (p: string) => {
    if (p.endsWith(".jsonl")) void handleClaudeFile(p);
  };
  const onCodex = (p: string) => {
    if (p.endsWith(".jsonl")) void handleCodexFile(p);
  };
  claudeWatcher.on("add", onClaude).on("change", onClaude);
  codexWatcher.on("add", onCodex).on("change", onCodex);
  claudeWatcher.on("ready", () => log("  claude watcher ready"));
  codexWatcher.on("ready", () => log("  codex watcher ready"));

  process.on("SIGINT", () => {
    log("daemon stopping");
    process.exit(0);
  });
}

// Auto-start when run as the entry file.
// On Windows, pathToFileURL is the only reliable way to match import.meta.url.
import { pathToFileURL } from "node:url";
const entryUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === entryUrl) {
  startDaemon().catch((err) => {
    log(`fatal: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
