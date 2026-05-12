import type { Turn, ToolCall, ToolResult } from "../types.js";
import { countTokens } from "../tokens.js";
import { scrubTurnText } from "../scrub.js";

// Schema observed from real Claude Code sessions (v2.1.x):
//   { type:"user"|"assistant"|"attachment", message:{role, content}, uuid, timestamp, sessionId, cwd, ... }
// `content` is either a string or an array of blocks of type:
//   - {type:"text", text}
//   - {type:"thinking", thinking}
//   - {type:"tool_use", id, name, input}
//   - {type:"tool_result", tool_use_id, content, is_error?}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ClaudeContentBlock[];
  is_error?: boolean;
}

interface ClaudeLine {
  type: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  message?: {
    role: string;
    content: string | ClaudeContentBlock[];
  };
}

function flattenContent(content: string | ClaudeContentBlock[] | undefined): {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
} {
  if (!content) return { text: "", thinking: "", toolCalls: [], toolResults: [] };
  if (typeof content === "string") {
    return { text: content, thinking: "", toolCalls: [], toolResults: [] };
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        if (block.text) textParts.push(block.text);
        break;
      case "thinking":
        if (block.thinking) thinkingParts.push(block.thinking);
        break;
      case "tool_use":
        toolCalls.push({
          id: block.id ?? "",
          name: block.name ?? "",
          input: block.input,
        });
        break;
      case "tool_result": {
        const inner = typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c.text ?? "").filter(Boolean).join("\n")
            : "";
        toolResults.push({
          toolCallId: block.tool_use_id ?? "",
          output: inner,
          isError: block.is_error,
        });
        break;
      }
    }
  }

  return {
    text: textParts.join("\n"),
    thinking: thinkingParts.join("\n"),
    toolCalls,
    toolResults,
  };
}

/** Parse a single Claude JSONL line into a canonical Turn, or null if the line is ignored. */
export function parseClaudeLine(line: string): Turn | null {
  if (!line.trim()) return null;
  let raw: ClaudeLine;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  // Only keep real conversation turns. Skip hook attachments, queue ops, sidechains.
  if (raw.isSidechain) return null;
  if (raw.type !== "user" && raw.type !== "assistant") return null;
  if (!raw.message) return null;

  const flat = flattenContent(raw.message.content);

  // Tool-result-only user turns get role "tool" so context-builder can rank them lower.
  const isToolOnlyUser =
    raw.type === "user" &&
    flat.toolResults.length > 0 &&
    flat.text === "" &&
    flat.toolCalls.length === 0;

  const role = isToolOnlyUser ? "tool" : (raw.type as "user" | "assistant");

  const text = scrubTurnText(flat.text);
  const tokens = countTokens(text) + countTokens(flat.thinking);

  return {
    id: raw.uuid ?? `claude-${Date.now()}-${Math.random()}`,
    source: "claude",
    sessionId: raw.sessionId ?? "",
    ts: raw.timestamp ?? new Date().toISOString(),
    cwd: raw.cwd ?? "",
    role,
    text,
    thinking: flat.thinking || undefined,
    toolCalls: flat.toolCalls.length ? flat.toolCalls : undefined,
    toolResults: flat.toolResults.length ? flat.toolResults : undefined,
    tokens,
  };
}
