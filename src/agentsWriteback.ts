// Writes a project-local AGENTS.md / .claudex/context.md so that Codex (which
// auto-loads AGENTS.md from the working dir) picks up the rolling claudex
// context as native instructions.
//
// We never clobber a user's existing AGENTS.md. We either:
//   (a) create AGENTS.md with a managed block if none exists, or
//   (b) inject/refresh a managed block delimited by claudex markers if AGENTS.md exists.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const START = "<!-- claudex:start -->";
const END = "<!-- claudex:end -->";

function isSafeWriteTarget(cwd: string): boolean {
  // Refuse to write into the user's home dir, root, or anything that doesn't
  // look like a project folder. This is the single most important safety check.
  if (!cwd) return false;
  try {
    const resolved = resolve(cwd);
    const home = resolve(homedir());
    if (resolved === home) return false;
    // Heuristic: must have at least one path segment below home or be on a
    // different drive. On Windows, allow any non-home path.
    if (resolved.length < home.length) return false;
    return true;
  } catch {
    return false;
  }
}

function block(contextMd: string, planMd: string): string {
  return [
    START,
    "<!-- This block is managed by claudex (https://github.com/unlikesooraj/claudex). -->",
    "<!-- Anything between the start and end markers will be overwritten on every update. -->",
    "",
    "## How to use this context",
    "",
    "You are working alongside another coding agent (Claude Code or Codex CLI) in this same folder. The conversation below is the rolling last ~2K tokens of work from BOTH tools, interleaved.",
    "",
    "**If the user references state you don't see** ('what was that file', 'continue', 'the bug from earlier', 'what number did I just tell you') — call the `claudex_get_context` MCP tool with the current cwd. The block below is loaded once at session start; the tool returns the LATEST state.",
    "",
    "## Recent context (from previous Claude Code / Codex sessions)",
    "",
    contextMd.trim(),
    "",
    "---",
    "",
    planMd.trim(),
    "",
    END,
  ].join("\n");
}

// Greedy strip-and-append: removes EVERY existing claudex managed block
// (including duplicates that may exist from a buggy prior write) and appends
// a single fresh block. This is the only way to stay self-consistent when the
// rolling context can itself contain stray marker strings.
function injectOrReplace(existing: string, payload: string): string {
  const blockRe = /\n*<!--\s*claudex:start\s*-->[\s\S]*?<!--\s*claudex:end\s*-->\n*/g;
  const cleaned = existing.replace(blockRe, "\n");
  const trimmed = cleaned.replace(/\s+$/, "");
  return (trimmed ? trimmed + "\n\n" : "") + payload + "\n";
}

export interface WritebackResult {
  cwd: string;
  agentsPath: string;
  cacheCopy: string;
  wrote: boolean;
  reason?: string;
}

/** Write claudex context block into <cwd>/AGENTS.md and also keep a copy under <cwd>/.claudex/context.md. */
export function writeAgentsMd(
  cwd: string,
  contextMd: string,
  planMd: string,
): WritebackResult {
  const agentsPath = join(cwd, "AGENTS.md");
  const cacheDir = join(cwd, ".claudex");
  const cacheCopy = join(cacheDir, "context.md");

  if (!isSafeWriteTarget(cwd)) {
    return { cwd, agentsPath, cacheCopy, wrote: false, reason: "unsafe target" };
  }
  if (!existsSync(cwd)) {
    return { cwd, agentsPath, cacheCopy, wrote: false, reason: "cwd missing" };
  }

  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheCopy, contextMd + "\n\n" + planMd, "utf8");
  } catch (e) {
    return { cwd, agentsPath, cacheCopy, wrote: false, reason: `cache write failed: ${e}` };
  }

  const payload = block(contextMd, planMd);
  let next: string;
  if (existsSync(agentsPath)) {
    const existing = readFileSync(agentsPath, "utf8");
    next = injectOrReplace(existing, payload);
  } else {
    next = payload + "\n";
  }

  try {
    writeFileSync(agentsPath, next, "utf8");
  } catch (e) {
    return { cwd, agentsPath, cacheCopy, wrote: false, reason: `AGENTS.md write failed: ${e}` };
  }
  return { cwd, agentsPath, cacheCopy, wrote: true };
}
