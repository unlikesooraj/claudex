import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import { CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR } from "./paths.js";
import {
  scanAllSessions,
  summarizeAvailability,
  type AvailabilitySummary,
  type SessionSource,
  type SessionSummary,
  type SessionUsage,
} from "./sessionIndex.js";

export interface NativeProcessInfo {
  processId: number;
  parentProcessId?: number;
  name: string;
  executablePath?: string;
  commandLine?: string;
}

export interface NativeAppInfo {
  source: SessionSource;
  name: string;
  running: boolean;
  processId?: number;
  executablePath?: string;
  protocol: string;
  exactChatLinks: boolean;
  projectOpen: boolean;
  note: string;
}

export interface OpenAppSession {
  key: string;
  source: SessionSource;
  appName: string;
  sessionId: string;
  cliSessionId?: string;
  title: string;
  cwd: string;
  cwdExists: boolean;
  appPid?: number;
  workerPid?: number;
  lastActivity: string;
  model?: string;
  effort?: string;
  transcriptFile?: string;
  lastPrompt?: string;
  activityState: SessionSummary["activityState"];
  turns: SessionSummary["turns"];
  tokens: SessionSummary["tokens"];
  usage: SessionUsage;
  launch: {
    mode: "exact-chat" | "focus-app" | "open-project";
    exact: boolean;
    url?: string;
    note: string;
  };
}

export interface OpenFolderGroup {
  key: string;
  cwd: string;
  name: string;
  exists: boolean;
  sessions: OpenAppSession[];
}

export interface NativeSessionsPayload {
  generatedAt: string;
  roots: {
    claude: string;
    codex: string;
    claudeApp?: string;
  };
  apps: {
    claude: NativeAppInfo;
    codex: NativeAppInfo;
  };
  counts: {
    open: number;
    folders: number;
    claude: number;
    codex: number;
    tracked: number;
  };
  availability: AvailabilitySummary;
  folders: OpenFolderGroup[];
  sessions: OpenAppSession[];
}

interface ClaudeAppSessionRecord {
  sessionId: string;
  cliSessionId?: string;
  cwd?: string;
  originCwd?: string;
  createdAt?: unknown;
  lastActivityAt?: unknown;
  title?: string;
  model?: string;
  effort?: string;
  isArchived?: boolean;
  filePath: string;
}

const EMPTY_USAGE: SessionUsage = {
  state: "unknown",
  label: "Usage unknown",
  detail: "No local usage data is available for this open app chat yet.",
  remainingExposed: false,
};

const EMPTY_TURNS: SessionSummary["turns"] = {
  user: 0,
  assistant: 0,
  tool: 0,
  total: 0,
};

const EMPTY_TOKENS: SessionSummary["tokens"] = {
  text: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function normalizePath(value: string | undefined): string {
  return (value ?? "").replace(/\//g, "\\").toLowerCase();
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return [value as T];
  return [];
}

function toIso(value: unknown, fallback = Date.now()): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return new Date(fallback).toISOString();
}

function folderName(cwd: string): string {
  if (!cwd) return "Unknown folder";
  return basename(cwd) || cwd;
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function queryNativeProcesses(): NativeProcessInfo[] {
  if (platform() !== "win32") return [];
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$filter = \"Name = 'node.exe' OR Name = 'claude.exe' OR Name = 'codex.exe' OR Name = 'Codex.exe' OR Name = 'Claude.exe'\"",
    "Get-CimInstance Win32_Process -Filter $filter |",
    "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |",
    "ConvertTo-Json -Compress",
  ].join("\n");
  try {
    const raw = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      {
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true,
      },
    ).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return asArray<Record<string, unknown>>(parsed)
      .map((row) => ({
        processId: Number(row.ProcessId),
        parentProcessId:
          typeof row.ParentProcessId === "number" ? row.ParentProcessId : undefined,
        name: String(row.Name ?? ""),
        executablePath:
          typeof row.ExecutablePath === "string" ? row.ExecutablePath : undefined,
        commandLine: typeof row.CommandLine === "string" ? row.CommandLine : undefined,
      }))
      .filter((row) => Number.isFinite(row.processId) && row.name);
  } catch {
    return [];
  }
}

export function splitCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

export function commandArg(commandLine: string | undefined, name: string): string | undefined {
  if (!commandLine) return undefined;
  const args = splitCommandLine(commandLine);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function isCodexNativeProcess(process: NativeProcessInfo): boolean {
  const exe = normalizePath(process.executablePath);
  return exe.includes("\\windowsapps\\openai.codex_") && exe.endsWith("\\codex.exe");
}

function isCodexWorkerProcess(process: NativeProcessInfo): boolean {
  const exe = normalizePath(process.executablePath);
  return (
    exe.endsWith("\\openai\\codex\\bin\\node.exe") &&
    Boolean(commandArg(process.commandLine, "--session-id"))
  );
}

function isClaudeNativeProcess(process: NativeProcessInfo): boolean {
  const exe = normalizePath(process.executablePath);
  return exe.includes("\\windowsapps\\claude_") && exe.endsWith("\\claude.exe");
}

function isClaudeWorkerProcess(process: NativeProcessInfo): boolean {
  const exe = normalizePath(process.executablePath);
  return (
    exe.includes("\\appdata\\roaming\\claude\\claude-code\\") &&
    exe.endsWith("\\claude.exe") &&
    Boolean(commandArg(process.commandLine, "--resume"))
  );
}

function findClaudeAppSessionRoot(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const packagesDir = join(localAppData, "Packages");
  let packageNames: string[];
  try {
    packageNames = readdirSync(packagesDir);
  } catch {
    return undefined;
  }
  for (const name of packageNames) {
    if (!name.toLowerCase().startsWith("claude_")) continue;
    const root = join(
      packagesDir,
      name,
      "LocalCache",
      "Roaming",
      "Claude",
      "claude-code-sessions",
    );
    if (existsSync(root)) return root;
  }
  return undefined;
}

function walkJson(root: string): string[] {
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
      else if (stats.isFile() && path.endsWith(".json")) out.push(path);
    }
  }
  recur(root);
  return out;
}

function readClaudeAppSessions(root: string | undefined): ClaudeAppSessionRecord[] {
  if (!root) return [];
  const records: ClaudeAppSessionRecord[] = [];
  for (const filePath of walkJson(root)) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      if (typeof raw.sessionId !== "string") continue;
      if (raw.isArchived === true) continue;
      records.push({
        sessionId: raw.sessionId,
        cliSessionId: typeof raw.cliSessionId === "string" ? raw.cliSessionId : undefined,
        cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
        originCwd: typeof raw.originCwd === "string" ? raw.originCwd : undefined,
        createdAt: raw.createdAt,
        lastActivityAt: raw.lastActivityAt,
        title: typeof raw.title === "string" ? raw.title : undefined,
        model: typeof raw.model === "string" ? raw.model : undefined,
        effort: typeof raw.effort === "string" ? raw.effort : undefined,
        isArchived: raw.isArchived === true,
        filePath,
      });
    } catch {
      // Ignore malformed app state files.
    }
  }
  return records;
}

function matchTranscript(
  transcripts: SessionSummary[],
  source: SessionSource,
  ids: Array<string | undefined>,
  cwd: string | undefined,
): SessionSummary | undefined {
  const idSet = new Set(ids.filter(Boolean) as string[]);
  const direct = transcripts.find((session) => {
    return session.source === source && idSet.has(session.sessionId);
  });
  if (direct) return direct;
  const normalizedCwd = normalizePath(cwd);
  if (!normalizedCwd) return undefined;
  return transcripts.find((session) => {
    return session.source === source && normalizePath(session.cwd) === normalizedCwd;
  });
}

function appInfo(
  source: SessionSource,
  native: NativeProcessInfo | undefined,
): NativeAppInfo {
  if (source === "codex") {
    return {
      source,
      name: "Codex",
      running: Boolean(native),
      processId: native?.processId,
      executablePath: native?.executablePath,
      protocol: "codex:",
      exactChatLinks: true,
      projectOpen: true,
      note: native
        ? "Codex desktop is running. Local conversation routes are available."
        : "Codex desktop is not running.",
    };
  }
  return {
    source,
    name: "Claude",
    running: Boolean(native),
    processId: native?.processId,
    executablePath: native?.executablePath,
    protocol: "claude:",
    exactChatLinks: false,
    projectOpen: false,
    note: native
      ? "Claude desktop is running. Its local Claude Code chat route is not publicly exposed."
      : "Claude desktop is not running.",
  };
}

function codexUrl(sessionId: string): string {
  return `codex:///local/${encodeURIComponent(sessionId)}`;
}

function buildCodexSession(
  process: NativeProcessInfo,
  app: NativeAppInfo,
  transcripts: SessionSummary[],
): OpenAppSession | null {
  const sessionId = commandArg(process.commandLine, "--session-id");
  if (!sessionId) return null;
  const commandCwd = commandArg(process.commandLine, "--working-dir");
  const transcript = matchTranscript(transcripts, "codex", [sessionId], commandCwd);
  const cwd = commandCwd ?? transcript?.cwd ?? "";
  const title = transcript?.lastPrompt || folderName(cwd) || `Codex ${shortId(sessionId)}`;
  return {
    key: `codex:${sessionId}`,
    source: "codex",
    appName: "Codex",
    sessionId,
    title,
    cwd,
    cwdExists: cwd ? existsSync(cwd) : false,
    appPid: app.processId,
    workerPid: process.processId,
    lastActivity: transcript?.lastActivity ?? new Date().toISOString(),
    model: transcript?.model,
    transcriptFile: transcript?.filePath,
    lastPrompt: transcript?.lastPrompt,
    activityState: transcript?.activityState ?? "active",
    turns: transcript?.turns ?? EMPTY_TURNS,
    tokens: transcript?.tokens ?? EMPTY_TOKENS,
    usage: transcript?.usage ?? EMPTY_USAGE,
    launch: {
      mode: "exact-chat",
      exact: true,
      url: codexUrl(sessionId),
      note: "Opens the Codex desktop local conversation route.",
    },
  };
}

function buildClaudeSession(
  process: NativeProcessInfo,
  app: NativeAppInfo,
  appSessions: ClaudeAppSessionRecord[],
  transcripts: SessionSummary[],
): OpenAppSession | null {
  const cliSessionId = commandArg(process.commandLine, "--resume");
  if (!cliSessionId) return null;
  const record = appSessions.find((session) => session.cliSessionId === cliSessionId);
  const cwd = record?.cwd ?? record?.originCwd ?? "";
  const transcript = matchTranscript(
    transcripts,
    "claude",
    [cliSessionId, record?.sessionId],
    cwd,
  );
  const sessionId = record?.sessionId ?? cliSessionId;
  const title =
    record?.title ||
    transcript?.lastPrompt ||
    folderName(cwd || transcript?.cwd || "") ||
    `Claude ${shortId(cliSessionId)}`;
  const resolvedCwd = cwd || transcript?.cwd || "";
  return {
    key: `claude:${sessionId}:${cliSessionId}`,
    source: "claude",
    appName: "Claude",
    sessionId,
    cliSessionId,
    title,
    cwd: resolvedCwd,
    cwdExists: resolvedCwd ? existsSync(resolvedCwd) : false,
    appPid: app.processId,
    workerPid: process.processId,
    lastActivity: transcript?.lastActivity ?? toIso(record?.lastActivityAt),
    model: record?.model ?? transcript?.model,
    effort: record?.effort,
    transcriptFile: transcript?.filePath,
    lastPrompt: transcript?.lastPrompt,
    activityState: transcript?.activityState ?? "active",
    turns: transcript?.turns ?? EMPTY_TURNS,
    tokens: transcript?.tokens ?? EMPTY_TOKENS,
    usage: transcript?.usage ?? EMPTY_USAGE,
    launch: {
      mode: "focus-app",
      exact: false,
      url: "claude:",
      note: "Focuses Claude desktop. Claude does not expose a confirmed local chat deeplink.",
    },
  };
}

function groupByFolder(sessions: OpenAppSession[]): OpenFolderGroup[] {
  const map = new Map<string, OpenFolderGroup>();
  for (const session of sessions) {
    const cwd = session.cwd || "Unknown folder";
    const key = normalizePath(cwd) || cwd;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        cwd,
        name: folderName(cwd),
        exists: session.cwdExists,
        sessions: [],
      };
      map.set(key, group);
    }
    group.exists ||= session.cwdExists;
    group.sessions.push(session);
  }
  return [...map.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort(
        (a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity),
      ),
    }))
    .sort((a, b) => {
      const newestA = Date.parse(a.sessions[0]?.lastActivity ?? "0");
      const newestB = Date.parse(b.sessions[0]?.lastActivity ?? "0");
      return newestB - newestA;
    });
}

export function getNativeSessionPayload(): NativeSessionsPayload {
  const processes = queryNativeProcesses();
  const codexNative = processes.find(isCodexNativeProcess);
  const claudeNative = processes.find(isClaudeNativeProcess);
  const apps = {
    claude: appInfo("claude", claudeNative),
    codex: appInfo("codex", codexNative),
  };
  const transcripts = scanAllSessions();
  const claudeAppRoot = findClaudeAppSessionRoot();
  const claudeAppSessions = readClaudeAppSessions(claudeAppRoot);

  const sessions = [
    ...processes
      .filter(isCodexWorkerProcess)
      .map((process) => buildCodexSession(process, apps.codex, transcripts)),
    ...processes
      .filter(isClaudeWorkerProcess)
      .map((process) => buildClaudeSession(process, apps.claude, claudeAppSessions, transcripts)),
  ]
    .filter((session): session is OpenAppSession => Boolean(session))
    .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));

  const folders = groupByFolder(sessions);
  return {
    generatedAt: new Date().toISOString(),
    roots: {
      claude: CLAUDE_PROJECTS_DIR,
      codex: CODEX_SESSIONS_DIR,
      claudeApp: claudeAppRoot,
    },
    apps,
    counts: {
      open: sessions.length,
      folders: folders.length,
      claude: sessions.filter((session) => session.source === "claude").length,
      codex: sessions.filter((session) => session.source === "codex").length,
      tracked: transcripts.length,
    },
    availability: summarizeAvailability(transcripts),
    folders,
    sessions,
  };
}

export function findOpenAppSession(
  source: SessionSource,
  sessionId: string,
): { payload: NativeSessionsPayload; session?: OpenAppSession } {
  const payload = getNativeSessionPayload();
  const session = payload.sessions.find((candidate) => {
    return (
      candidate.source === source &&
      (candidate.sessionId === sessionId || candidate.cliSessionId === sessionId)
    );
  });
  return { payload, session };
}
