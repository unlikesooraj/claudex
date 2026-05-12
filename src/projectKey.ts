import { createHash } from "node:crypto";
import { normalize } from "node:path";
import type { ProjectKey } from "./types.js";

/** Hash a cwd to a stable 16-char key. Both tools' transcript dirs encode cwd, so this is reliable. */
export function projectKeyFromCwd(cwd: string): ProjectKey {
  const normalised = normalize(cwd).replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  const hash = createHash("sha256").update(normalised).digest("hex").slice(0, 16);
  return { hash, cwd: normalised };
}

/** Reverse Claude's directory encoding (e.g. `C--Users-jane-Desktop-myapp` → `C:/Users/jane/Desktop/myapp`). */
export function decodeClaudeProjectDir(name: string): string {
  // Claude replaces `:` and `\` and `/` with `-` (and occasionally `%XX` URL-encoding).
  // We don't need perfect round-trip — we just need a normalised lower-case string for hashing.
  let s = name;
  try {
    s = decodeURIComponent(s);
  } catch {
    // ignore malformed pct-encoding
  }
  // Heuristic: "C--Users-jane-Desktop-myapp" → "C:/Users/jane/Desktop/myapp"
  s = s.replace(/^([A-Za-z])--/, "$1:/").replace(/-/g, "/");
  return s;
}
