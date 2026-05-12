import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR } from "./paths.js";
import { projectKeyFromCwd, decodeClaudeProjectDir } from "./projectKey.js";
import { scrubSecrets, scrubTurnText } from "./scrub.js";

export type SessionSource = "claude" | "codex";
export type UsageState = "available" | "constrained" | "limited" | "unknown";

export interface UsageWindow {
  usedPercent?: number;
  remainingPercent?: number;
  windowMinutes?: number;
  resetsAt?: string;
}

export interface SessionUsage {
  state: UsageState;
  label: string;
  detail: string;
  planType?: string;
  primary?: UsageWindow;
  secondary?: UsageWindow;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  remainingExposed: boolean;
}

export interface SessionSummary {
  key: string;
  source: SessionSource;
  sessionId: string;
  cwd: string;
  cwdExists: boolean;
  projectHash: string;
  filePath: string;
  startedAt: string;
  lastActivity: string;
  fileModifiedAt: string;
  model?: string;
  version?: string;
  gitBranch?: string;
  lastPrompt?: string;
  activityState: "active" | "recent" | "idle";
  turns: {
    user: number;
    assistant: number;
    tool: number;
    total: number;
  };
  tokens: {
    text: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  usage: SessionUsage;
}

export interface SessionScanOptions {
  claudeDir?: string;
  codexDir?: string;
  limit?: number;
  fileLimitPerSource?: number;
}

export interface ToolAvailability {
  source: SessionSource;
  state: UsageState;
  label: string;
  detail: string;
}

export interface AvailabilitySummary {
  generatedAt: string;
  best?: ToolAvailability;
  tools: {
    claude?: ToolAvailability;
    codex?: ToolAvailability;
  };
}

interface CodexRateLimits {
  plan_type?: string | null;
  rate_limit_reached_type?: string | null;
  primary?: {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  } | null;
  secondary?: {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  } | null;
}

function walkJsonl(root: string): string[] {
  return walkJsonlEntries(root).map((entry) => entry.path);
}

function walkJsonlEntries(root: string): Array<{ path: string; mtimeMs: number }> {
  const entriesOut: Array<{ path: string; mtimeMs: number }> = [];
  function recur(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) recur(path);
      else if (stats.isFile() && path.endsWith(".jsonl")) {
        entriesOut.push({ path, mtimeMs: stats.mtimeMs });
      }
    }
  }
  recur(root);
  return entriesOut;
}

function parseJson(line: string): any | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readSampleLines(filePath: string): string[] {
  const stats = statSync(filePath);
  const headBytes = 24 * 1024;
  const tailBytes = 64 * 1024;
  const totalBytes = stats.size;
  if (totalBytes <= headBytes + tailBytes) {
    return readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  }

  const fd = openSync(filePath, "r");
  try {
    const headSize = Math.min(headBytes, totalBytes);
    const tailSize = Math.min(tailBytes, totalBytes - headSize);
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    readSync(fd, head, 0, headSize, 0);
    readSync(fd, tail, 0, tailSize, totalBytes - tailSize);
    return `${head.toString("utf8")}\n${tail.toString("utf8")}`
      .split("\n")
      .filter(Boolean);
  } finally {
    closeSync(fd);
  }
}

function asIso(ts: unknown, fallbackMs: number): string {
  if (typeof ts === "string" && !Number.isNaN(Date.parse(ts))) return ts;
  if (typeof ts === "number" && Number.isFinite(ts)) return new Date(ts).toISOString();
  return new Date(fallbackMs).toISOString();
}

function later(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function earlier(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function truncate(text: string, max = 180): string {
  const clean = scrubSecrets(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function contentText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join("\n");
  if (typeof content !== "object") return "";
  const block = content as Record<string, unknown>;
  const directText = block.text;
  if (typeof directText === "string") return directText;
  const message = block.message;
  if (typeof message === "string") return message;
  return contentText(block.content);
}

function activityState(lastActivity: string): "active" | "recent" | "idle" {
  const ageMs = Date.now() - Date.parse(lastActivity);
  if (ageMs < 5 * 60_000) return "active";
  if (ageMs < 60 * 60_000) return "recent";
  return "idle";
}

function rateWindow(raw?: CodexRateLimits["primary"]): UsageWindow | undefined {
  if (!raw) return undefined;
  const used = typeof raw.used_percent === "number" ? raw.used_percent : undefined;
  return {
    usedPercent: used,
    remainingPercent: typeof used === "number" ? Math.max(0, 100 - used) : undefined,
    windowMinutes: raw.window_minutes,
    resetsAt: typeof raw.resets_at === "number" ? new Date(raw.resets_at * 1000).toISOString() : undefined,
  };
}

function codexUsage(rateLimits: CodexRateLimits | undefined): SessionUsage {
  if (!rateLimits) {
    return {
      state: "unknown",
      label: "Usage unknown",
      detail: "No Codex token_count event found in this session.",
      remainingExposed: false,
    };
  }

  const primary = rateWindow(rateLimits.primary);
  const secondary = rateWindow(rateLimits.secondary);
  const reached = rateLimits.rate_limit_reached_type;
  const primaryLeft = primary?.remainingPercent;
  const secondaryLeft = secondary?.remainingPercent;
  const minLeft = Math.min(primaryLeft ?? 100, secondaryLeft ?? 100);

  let state: UsageState = "available";
  if (reached) state = "limited";
  else if (minLeft <= 10) state = "constrained";

  const label = reached
    ? `Limit reached: ${reached}`
    : typeof primaryLeft === "number"
      ? `${primaryLeft}% primary left`
      : "Rate limit seen";
  const secondaryText = typeof secondaryLeft === "number" ? `, ${secondaryLeft}% weekly left` : "";
  const planText = rateLimits.plan_type ? `${rateLimits.plan_type}` : "plan unknown";

  return {
    state,
    label,
    detail: `${planText}${secondaryText}`,
    planType: rateLimits.plan_type ?? undefined,
    primary,
    secondary,
    remainingExposed: true,
  };
}

function claudeUsage(args: {
  limitDetected: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): SessionUsage {
  const total =
    args.inputTokens + args.outputTokens + args.cacheReadTokens + args.cacheWriteTokens;
  if (args.limitDetected) {
    return {
      state: "limited",
      label: "Limit text detected",
      detail: "Claude Code transcript contains local rate-limit wording.",
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      totalTokens: total,
      remainingExposed: false,
    };
  }
  return {
    state: "unknown",
    label: "Remaining not exposed",
    detail: "Claude Code records message usage locally, not account quota remaining.",
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadTokens: args.cacheReadTokens,
    cacheWriteTokens: args.cacheWriteTokens,
    totalTokens: total,
    remainingExposed: false,
  };
}

function limitTextDetected(text: string): boolean {
  return /\b(rate limit|usage limit|limit reached|too many requests|quota exceeded)\b/i.test(text);
}

function emptyCounts(): SessionSummary["turns"] {
  return { user: 0, assistant: 0, tool: 0, total: 0 };
}

function scanClaudeFile(filePath: string): SessionSummary | null {
  const stats = statSync(filePath);
  const fallback = stats.mtimeMs;
  const parentName = basename(dirname(filePath));
  let sessionId = basename(filePath, ".jsonl");
  let cwd = decodeClaudeProjectDir(parentName);
  let startedAt = asIso(undefined, fallback);
  let lastActivity = asIso(undefined, fallback);
  let model: string | undefined;
  let version: string | undefined;
  let gitBranch: string | undefined;
  let lastPrompt = "";
  let textTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let limitDetected = false;
  const turns = emptyCounts();

  let lines: string[];
  try {
    lines = readSampleLines(filePath);
  } catch {
    return null;
  }

  for (const line of lines) {
    const raw = parseJson(line);
    if (!raw) continue;
    if (typeof raw.sessionId === "string") sessionId = raw.sessionId;
    if (typeof raw.cwd === "string" && raw.cwd) cwd = raw.cwd;
    if (typeof raw.version === "string") version = raw.version;
    if (typeof raw.gitBranch === "string") gitBranch = raw.gitBranch;

    const ts = asIso(raw.timestamp, fallback);
    startedAt = earlier(startedAt, ts);
    lastActivity = later(lastActivity, ts);

    if (raw.type === "last-prompt" && typeof raw.lastPrompt === "string") {
      lastPrompt = truncate(raw.lastPrompt);
    }

    if (raw.type !== "user" && raw.type !== "assistant") continue;
    if (raw.isSidechain) continue;
    const role = raw.type as "user" | "assistant";
    turns[role]++;
    turns.total++;

    const text = scrubTurnText(contentText(raw.message?.content));
    if (text) {
      textTokens += estimateTokens(text);
      limitDetected ||= limitTextDetected(text);
      if (role === "user") lastPrompt = truncate(text);
    }

    if (role === "assistant") {
      if (typeof raw.message?.model === "string") model = raw.message.model;
      const usage = raw.message?.usage;
      if (usage && typeof usage === "object") {
        inputTokens += Number(usage.input_tokens ?? 0);
        outputTokens += Number(usage.output_tokens ?? 0);
        cacheReadTokens += Number(usage.cache_read_input_tokens ?? 0);
        cacheWriteTokens += Number(usage.cache_creation_input_tokens ?? 0);
      }
    }
  }

  const key = projectKeyFromCwd(cwd);
  return {
    key: `claude:${sessionId}:${filePath}`,
    source: "claude",
    sessionId,
    cwd,
    cwdExists: existsSync(cwd),
    projectHash: key.hash,
    filePath,
    startedAt,
    lastActivity,
    fileModifiedAt: stats.mtime.toISOString(),
    model,
    version,
    gitBranch,
    lastPrompt: lastPrompt || undefined,
    activityState: activityState(lastActivity),
    turns,
    tokens: {
      text: textTokens,
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
    },
    usage: claudeUsage({
      limitDetected,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    }),
  };
}

function scanCodexFile(filePath: string): SessionSummary | null {
  const stats = statSync(filePath);
  const fallback = stats.mtimeMs;
  let sessionId = basename(filePath, ".jsonl");
  let cwd = "";
  let startedAt = asIso(undefined, fallback);
  let lastActivity = asIso(undefined, fallback);
  let model: string | undefined;
  let version: string | undefined;
  let lastPrompt = "";
  let textTokens = 0;
  let latestRateLimits: CodexRateLimits | undefined;
  const turns = emptyCounts();

  let lines: string[];
  try {
    lines = readSampleLines(filePath);
  } catch {
    return null;
  }

  for (const line of lines) {
    const raw = parseJson(line);
    if (!raw) continue;
    const ts = asIso(raw.timestamp, fallback);
    startedAt = earlier(startedAt, ts);
    lastActivity = later(lastActivity, ts);

    if (raw.type === "session_meta" && raw.payload) {
      if (typeof raw.payload.id === "string") sessionId = raw.payload.id;
      if (typeof raw.payload.cwd === "string") cwd = raw.payload.cwd;
      if (typeof raw.payload.cli_version === "string") version = raw.payload.cli_version;
      if (typeof raw.payload.model_provider === "string") model = raw.payload.model_provider;
      continue;
    }

    if (raw.type === "turn_context" && raw.payload) {
      if (typeof raw.payload.cwd === "string") cwd = raw.payload.cwd;
      if (typeof raw.payload.model === "string") model = raw.payload.model;
      continue;
    }

    if (raw.type === "event_msg" && raw.payload) {
      if (raw.payload.type === "token_count") {
        latestRateLimits = raw.payload.rate_limits as CodexRateLimits | undefined;
      }
      if (raw.payload.type === "user_message" && typeof raw.payload.message === "string") {
        lastPrompt = truncate(raw.payload.message);
      }
      continue;
    }

    if (raw.type !== "response_item" || !raw.payload) continue;
    const payload = raw.payload;
    if (payload.type === "message") {
      const role = payload.role === "assistant" ? "assistant" : "user";
      if (payload.role === "developer" || payload.role === "system") continue;
      turns[role]++;
      turns.total++;
      const text = scrubTurnText(contentText(payload.content));
      if (text) {
        textTokens += estimateTokens(text);
        if (role === "user") lastPrompt = truncate(text);
      }
    } else if (payload.type === "function_call" || payload.type === "function_call_output") {
      turns.tool++;
      turns.total++;
    }
  }

  if (!cwd) cwd = process.cwd();
  const key = projectKeyFromCwd(cwd);
  return {
    key: `codex:${sessionId}:${filePath}`,
    source: "codex",
    sessionId,
    cwd,
    cwdExists: existsSync(cwd),
    projectHash: key.hash,
    filePath,
    startedAt,
    lastActivity,
    fileModifiedAt: stats.mtime.toISOString(),
    model,
    version,
    lastPrompt: lastPrompt || undefined,
    activityState: activityState(lastActivity),
    turns,
    tokens: {
      text: textTokens,
    },
    usage: codexUsage(latestRateLimits),
  };
}

export function scanAllSessions(opts: SessionScanOptions = {}): SessionSummary[] {
  const claudeDir = opts.claudeDir ?? CLAUDE_PROJECTS_DIR;
  const codexDir = opts.codexDir ?? CODEX_SESSIONS_DIR;
  const sessions: SessionSummary[] = [];
  const fileLimit = opts.fileLimitPerSource;

  const claudeFiles = typeof fileLimit === "number"
    ? walkJsonlEntries(claudeDir)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, fileLimit)
        .map((entry) => entry.path)
    : walkJsonl(claudeDir);
  const codexFiles = typeof fileLimit === "number"
    ? walkJsonlEntries(codexDir)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, fileLimit)
        .map((entry) => entry.path)
    : walkJsonl(codexDir);

  for (const file of claudeFiles) {
    const session = scanClaudeFile(file);
    if (session) sessions.push(session);
  }
  for (const file of codexFiles) {
    const session = scanCodexFile(file);
    if (session) sessions.push(session);
  }

  const sorted = sessions.sort(
    (a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity),
  );
  return typeof opts.limit === "number" ? sorted.slice(0, opts.limit) : sorted;
}

function latestForSource(
  sessions: SessionSummary[],
  source: SessionSource,
): SessionSummary | undefined {
  return sessions.find((s) => s.source === source);
}

export function summarizeAvailability(sessions: SessionSummary[]): AvailabilitySummary {
  const codex = latestForSource(sessions, "codex");
  const claude = latestForSource(sessions, "claude");
  const tools: AvailabilitySummary["tools"] = {};

  if (claude) {
    tools.claude = {
      source: "claude",
      state: claude.usage.state,
      label: claude.usage.label,
      detail: claude.usage.detail,
    };
  }
  if (codex) {
    tools.codex = {
      source: "codex",
      state: codex.usage.state,
      label: codex.usage.label,
      detail: codex.usage.detail,
    };
  }

  const candidates = [tools.codex, tools.claude].filter(Boolean) as ToolAvailability[];
  const best =
    candidates.find((c) => c.state === "available") ??
    candidates.find((c) => c.state === "unknown") ??
    candidates.find((c) => c.state === "constrained") ??
    candidates[0];

  return {
    generatedAt: new Date().toISOString(),
    best,
    tools,
  };
}
