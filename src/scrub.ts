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

// Known-shape secret patterns. We replace with a short marker rather than
// dropping the surrounding text so the model can still see "the user pasted
// a token here" without seeing the token itself.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/ghp_[A-Za-z0-9]{30,}/g, "[REDACTED:github-pat]"],
  [/gho_[A-Za-z0-9]{30,}/g, "[REDACTED:github-oauth]"],
  [/ghu_[A-Za-z0-9]{30,}/g, "[REDACTED:github-user]"],
  [/ghs_[A-Za-z0-9]{30,}/g, "[REDACTED:github-server]"],
  [/ghr_[A-Za-z0-9]{30,}/g, "[REDACTED:github-refresh]"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED:github-fine-grained-pat]"],
  [/sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, "[REDACTED:openai-or-anthropic-key]"],
  [/sk_live_[A-Za-z0-9]{20,}/g, "[REDACTED:stripe-live]"],
  [/sk_test_[A-Za-z0-9]{20,}/g, "[REDACTED:stripe-test]"],
  [/rk_live_[A-Za-z0-9]{20,}/g, "[REDACTED:stripe-restricted]"],
  [/AIza[0-9A-Za-z_-]{35}/g, "[REDACTED:google-api]"],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED:aws-access-key]"],
  [/ASIA[0-9A-Z]{16}/g, "[REDACTED:aws-session-key]"],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/g, "[REDACTED:slack-token]"],
  [/nvapi-[A-Za-z0-9_-]{20,}/g, "[REDACTED:nvidia-api]"],
  [/hf_[A-Za-z0-9]{30,}/g, "[REDACTED:huggingface-token]"],
  [/ya29\.[A-Za-z0-9_-]{20,}/g, "[REDACTED:google-oauth]"],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/g, "[REDACTED:private-key]"],
  // generic high-entropy assignment shapes — last-resort net
  [/((?:api[_-]?key|secret|password|token)\s*[:=]\s*['"])[^'"\n]{16,}(['"])/gi, "$1[REDACTED]$2"],
  [/(Bearer\s+)[A-Za-z0-9._-]{20,}/g, "$1[REDACTED]"],
];

export function scrubSecrets(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Recursively walks any tool-call/tool-result payload, scrubbing every string. */
export function scrubDeep<T>(v: T): T {
  if (v == null) return v;
  if (typeof v === "string") return scrubSecrets(v) as unknown as T;
  if (Array.isArray(v)) return v.map(scrubDeep) as unknown as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = scrubDeep(val);
    }
    return out as unknown as T;
  }
  return v;
}

export function scrubTurnText(text: string): string {
  if (!text) return "";
  let out = text;
  // Secrets first — they could otherwise survive a block strip and land in
  // context.md / AGENTS.md, which are written to the user's project tree.
  out = scrubSecrets(out);
  // Two passes of block-strip to catch nested cases (`<X> ... <X> ... </X> ... </X>`).
  for (let pass = 0; pass < 2; pass++) {
    for (const re of BLOCK_PATTERNS) out = out.replace(re, "");
  }
  for (const re of STRAGGLER_PATTERNS) out = out.replace(re, "");
  // Collapse runs of blank lines that the strip might have created.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
