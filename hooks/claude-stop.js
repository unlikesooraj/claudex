#!/usr/bin/env node
// Claude Code Stop hook.
// Just exits — the daemon picks up new lines via the chokidar watcher.
// Kept as a hook anchor so users see a "claudex hook ran" signal in their settings,
// and so we have a place to add explicit flush behaviour later (v2).

import { readFileSync } from "node:fs";

try {
  readFileSync(0, "utf8"); // drain stdin
} catch {
  // ignore
}
process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + "\n");
