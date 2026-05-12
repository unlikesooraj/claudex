import chokidar from "chokidar";
import {
  appendFileSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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
const HEALTH_FILE = join(CLAUDEX_HOME, "daemon-health.json");

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

function readPidFile(): number | undefined {
  try {
    const pid = Number(readFileSync(DAEMON_PID, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function pidIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function anotherDaemonIsRunning(): boolean {
  const pid = readPidFile();
  if (!pid || pid === process.pid) return false;
  if (pidIsRunning(pid)) {
    log(`daemon already running (pid ${pid}); exiting duplicate pid ${process.pid}`);
    return true;
  }
  return false;
}

function writeHealth(extra: Record<string, unknown> = {}): void {
  try {
    writeFileSync(
      HEALTH_FILE,
      JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString(), ...extra }, null, 2),
      "utf8",
    );
  } catch {
    // best effort
  }
}

function walkJsonl(root: string): string[] {
  const out: string[] = [];
  function recur(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) recur(path);
      else if (stats.isFile() && path.endsWith(".jsonl")) out.push(path);
    }
  }
  recur(root);
  return out;
}

async function sweepExistingFiles(): Promise<void> {
  const claudeFiles = walkJsonl(CLAUDE_PROJECTS_DIR);
  const codexFiles = walkJsonl(CODEX_SESSIONS_DIR);
  for (const file of claudeFiles) await handleClaudeFile(file);
  for (const file of codexFiles) await handleCodexFile(file);
  writeHealth({ lastSweepAt: new Date().toISOString(), claudeFiles: claudeFiles.length, codexFiles: codexFiles.length });
}

export async function startDaemon(): Promise<void> {
  mkdirSync(CLAUDEX_HOME, { recursive: true });
  mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true });
  mkdirSync(CODEX_SESSIONS_DIR, { recursive: true });
  if (anotherDaemonIsRunning()) return;
  writePidFile();
  writeHealth({ state: "starting" });
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
  claudeWatcher.on("ready", () => {
    log("  claude watcher ready");
    writeHealth({ claudeReady: true });
  });
  codexWatcher.on("ready", () => {
    log("  codex watcher ready");
    writeHealth({ codexReady: true });
  });
  claudeWatcher.on("error", (err) => log(`claude watcher error: ${err}`));
  codexWatcher.on("error", (err) => log(`codex watcher error: ${err}`));

  setInterval(() => {
    void sweepExistingFiles().catch((err) => log(`periodic sweep failed: ${err?.stack ?? err}`));
  }, 30_000).unref();
  void sweepExistingFiles().catch((err) => log(`initial sweep failed: ${err?.stack ?? err}`));

  process.on("SIGINT", () => {
    log("daemon stopping");
    writeHealth({ state: "stopping" });
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

process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err.stack ?? err.message}`);
});

process.on("unhandledRejection", (err) => {
  log(`unhandledRejection: ${String(err)}`);
});
