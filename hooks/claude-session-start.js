#!/usr/bin/env node
// Claude Code SessionStart hook.
// Reads the shared rolling-window context for the project cwd and injects it
// via the documented `additionalContext` field of the hook output schema.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const CLAUDEX_HOME = process.env.CLAUDEX_HOME ?? join(homedir(), ".claudex");
const SHARED_DIR = join(CLAUDEX_HOME, "shared");

let payload = {};
try {
  const raw = readFileSync(0, "utf8");
  payload = raw ? JSON.parse(raw) : {};
} catch {
  // ignore — hook may be invoked manually
}

const cwd = payload.cwd ?? process.cwd();
const normalised = cwd.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
const hash = createHash("sha256").update(normalised).digest("hex").slice(0, 16);
const contextPath = join(SHARED_DIR, hash, "context.md");
const planPath = join(SHARED_DIR, hash, "plan.md");

let additional = "";
if (existsSync(contextPath)) {
  additional += readFileSync(contextPath, "utf8");
}
if (existsSync(planPath)) {
  additional += "\n\n---\n\n" + readFileSync(planPath, "utf8");
}

if (!additional) {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + "\n");
  process.exit(0);
}

const out = {
  continue: true,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: additional,
  },
  systemMessage: "[claudex] loaded rolling context from previous Claude/Codex sessions",
};
process.stdout.write(JSON.stringify(out) + "\n");
