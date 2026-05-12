// Canonical, tool-agnostic representation of a single turn in a conversation.
// Both Claude Code and Codex JSONL streams are normalised into this shape.

export type TurnRole = "user" | "assistant" | "system" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError?: boolean;
}

export interface Turn {
  /** Stable id from the source tool (uuid for Claude, id for Codex). */
  id: string;
  /** Which CLI produced this turn. */
  source: "claude" | "codex";
  /** Session id within the source tool. */
  sessionId: string;
  /** ISO timestamp. */
  ts: string;
  /** Working directory the session was attached to. */
  cwd: string;
  role: TurnRole;
  /** Plain text content of the turn, concatenated from blocks. May be empty for pure tool turns. */
  text: string;
  /** Optional model thinking trace (Claude exposes this; Codex generally does not). */
  thinking?: string;
  /** Tool calls the assistant requested. */
  toolCalls?: ToolCall[];
  /** Tool results (when role === "tool" or attached to a user turn). */
  toolResults?: ToolResult[];
  /** Best-effort token count (cl100k via js-tiktoken) for rolling-window math. */
  tokens: number;
}

export interface ProjectKey {
  /** SHA256(8) of normalised cwd, hex. */
  hash: string;
  /** The cwd it came from. */
  cwd: string;
}
