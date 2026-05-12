// Centralised "scrub" function for incoming turn text.
// Both parsers route assistant/user text through here so that auto-injected
// blocks (Codex's <INSTRUCTIONS>, claudex's own managed markers, etc.) never
// make it into the canonical store. Defence in depth — if a marker survives
// here, it would feed back into the next rolling-window write and corrupt
// AGENTS.md's managed-block boundaries.

// Strip well-formed wrapper blocks first (paired open/close).
const BLOCK_PATTERNS: Array<RegExp> = [
  /<environment_context>[\s\S]*?<\/environment_context>/gi,
  /<user_instructions>[\s\S]*?<\/user_instructions>/gi,
  /<permissions instructions>[\s\S]*?<\/permissions instructions>/gi,
  /<app-context>[\s\S]*?<\/app-context>/gi,
  /<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/g,
];

// Then strip any UNPAIRED tag stragglers left behind when a previous block's
// content contained a literal closer string (which would terminate a
// non-greedy match early and leak the trailing closer into the output).
const STRAGGLER_PATTERNS: Array<RegExp> = [
  /<\/?INSTRUCTIONS>/g,
  /<\/?environment_context>/gi,
  /<\/?user_instructions>/gi,
  /<\/?app-context>/gi,
  /<\/?permissions instructions>/gi,
  /^#\s*AGENTS\.md instructions for[^\n]*\n*/gim,
  /<!--\s*claudex:start\s*-->/g,
  /<!--\s*claudex:end\s*-->/g,
];

export function scrubTurnText(text: string): string {
  if (!text) return "";
  let out = text;
  // Two passes of block-strip to catch nested cases (`<X> ... <X> ... </X> ... </X>`).
  for (let pass = 0; pass < 2; pass++) {
    for (const re of BLOCK_PATTERNS) out = out.replace(re, "");
  }
  for (const re of STRAGGLER_PATTERNS) out = out.replace(re, "");
  // Collapse runs of blank lines that the strip might have created.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
