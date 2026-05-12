#!/usr/bin/env node
// Codex `notify` hook entry point.
// Codex invokes:    notify = ["node", "/path/to/codex-notify.js"]
// passing event JSON as the final argv. We trigger an immediate rebuild of the
// shared context for the active cwd. The daemon's watcher would catch it eventually,
// but doing it here makes the handoff feel instant.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const CLAUDEX_HOME = process.env.CLAUDEX_HOME ?? join(homedir(), ".claudex");
mkdirSync(CLAUDEX_HOME, { recursive: true });

let event = {};
try {
  const last = process.argv[process.argv.length - 1];
  event = JSON.parse(last);
} catch {
  // ignore
}

// Best-effort: log the event so users can see the hook fired.
try {
  const logPath = join(CLAUDEX_HOME, "codex-notify.log");
  writeFileSync(
    logPath,
    `[${new Date().toISOString()}] ${JSON.stringify(event)}\n`,
    { flag: "a" },
  );
} catch {
  // ignore
}

// Nothing more to do — the daemon owns context rebuilds.
process.exit(0);
