#!/usr/bin/env node
// Claude Code UserPromptSubmit hook — runs before every user prompt is sent.
// If the rolling context for this cwd has been updated since we last injected
// it in *this* Claude session, inject the fresh context. Otherwise no-op so we
// don't waste tokens.
//
// This is what makes mid-session updates from Codex appear in an already-open
// Claude session without restart.

import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const CLAUDEX_HOME = process.env.CLAUDEX_HOME ?? join(homedir(), ".claudex");
const SHARED_DIR = join(CLAUDEX_HOME, "shared");
const INJECT_STATE_DIR = join(CLAUDEX_HOME, "inject-state");

let payload = {};
try {
  const raw = readFileSync(0, "utf8");
  payload = raw ? JSON.parse(raw) : {};
} catch {
  // ignore
}

const cwd = payload.cwd ?? process.cwd();
const sessionId = payload.session_id ?? payload.sessionId ?? "default";

const normalised = cwd.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
const projectHash = createHash("sha256").update(normalised).digest("hex").slice(0, 16);
const contextPath = join(SHARED_DIR, projectHash, "context.md");

function noop() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + "\n");
  process.exit(0);
}

if (!existsSync(contextPath)) noop();

let mtime;
try {
  mtime = statSync(contextPath).mtimeMs;
} catch {
  noop();
}

const stateFile = join(INJECT_STATE_DIR, `${sessionId}.json`);
let lastInjectedMtime = 0;
if (existsSync(stateFile)) {
  try {
    lastInjectedMtime = JSON.parse(readFileSync(stateFile, "utf8")).mtime ?? 0;
  } catch {
    // ignore
  }
}

if (mtime <= lastInjectedMtime) noop();

let content;
try {
  content = readFileSync(contextPath, "utf8");
} catch {
  noop();
}

try {
  mkdirSync(INJECT_STATE_DIR, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ mtime, ts: new Date().toISOString() }), "utf8");
} catch {
  // best effort — even if we can't persist, still inject so this turn isn't stale
}

const additional =
  `# [claudex] refreshed context — the other tool has updated state since you last looked.\n\n` +
  content;

process.stdout.write(
  JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: additional,
    },
  }) + "\n",
);
