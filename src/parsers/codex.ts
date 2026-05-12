import type { Turn, ToolCall, ToolResult } from "../types.js";
import { countTokens } from "../tokens.js";
import { scrubTurnText, scrubDeep, scrubSecrets } from "../scrub.js";

// Schema observed from real Codex CLI rollouts (0.123.x):
//   { timestamp, type: "session_meta"|"event_msg"|"response_item", payload }
//
// session_meta.payload: { id, cwd, originator, cli_version, model_provider, base_instructions, ... }
// response_item.payload variants:
//   - { type:"message", role:"user"|"assistant"|"developer"|"system", content:[{type:"input_text"|"output_text", text}] }
//   - { type:"function_call", call_id, name, arguments }
//   - { type:"function_call_output", call_id, output }
//   - { type:"reasoning", summary:[{type:"summary_text", text}] }  (optional, rare)

interface CodexContentItem {
  type: string;
  text?: string;
}

interface CodexResponseItemPayload {
  type: string;
  role?: string;
  content?: CodexContentItem[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string | { content?: string; success?: boolean };
  summary?: { type: string; text?: string }[];
  id?: string;
}

interface CodexLine {
  timestamp?: string;
  type: string;
  payload?: CodexResponseItemPayload & {
    cwd?: string;
    id?: string;
  };
}

// We carry session context across line-by-line parsing using a small state bag.
export interface CodexParseState {
  sessionId: string;
  cwd: string;
}

export function makeCodexState(): CodexParseState {
  return { sessionId: "", cwd: "" };
}

export function parseCodexLine(line: string, state: CodexParseState): Turn | null {
  if (!line.trim()) return null;
  let raw: CodexLine;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  // Update session-level state when we see meta.
  if (raw.type === "session_meta" && raw.payload) {
    state.sessionId = raw.payload.id ?? state.sessionId;
    state.cwd = raw.payload.cwd ?? state.cwd;
    return null;
  }

  if (raw.type !== "response_item" || !raw.payload) return null;

  const p = raw.payload;
  const ts = raw.timestamp ?? new Date().toISOString();
  const idBase = `codex-${state.sessionId}-${ts}`;

  switch (p.type) {
    case "message": {
      // Skip developer / system injections — they're not conversation turns.
      if (p.role === "developer" || p.role === "system") return null;
      let text = (p.content ?? [])
        .map((c) => c.text ?? "")
        .filter(Boolean)
        .join("\n");
      if (!text) return null;
      text = scrubTurnText(text);
      if (!text) return null;
      return {
        id: p.id ?? idBase,
        source: "codex",
        sessionId: state.sessionId,
        ts,
        cwd: state.cwd,
        role: p.role === "assistant" ? "assistant" : "user",
        text,
        tokens: countTokens(text),
      };
    }
    case "function_call": {
      let parsedArgs: unknown = p.arguments;
      if (typeof p.arguments === "string") {
        try {
          parsedArgs = JSON.parse(p.arguments);
        } catch {
          // leave as string
        }
      }
      const call: ToolCall = {
        id: p.call_id ?? "",
        name: p.name ?? "",
        input: scrubDeep(parsedArgs),
      };
      return {
        id: p.call_id ?? idBase,
        source: "codex",
        sessionId: state.sessionId,
        ts,
        cwd: state.cwd,
        role: "assistant",
        text: "",
        toolCalls: [call],
        tokens: 0,
      };
    }
    case "function_call_output": {
      const output =
        typeof p.output === "string"
          ? p.output
          : p.output?.content ?? "";
      const isError = typeof p.output === "object" && p.output?.success === false;
      const result: ToolResult = {
        toolCallId: p.call_id ?? "",
        output: scrubSecrets(output),
        isError,
      };
      return {
        id: p.call_id ? `${p.call_id}-out` : idBase,
        source: "codex",
        sessionId: state.sessionId,
        ts,
        cwd: state.cwd,
        role: "tool",
        text: "",
        toolResults: [result],
        tokens: 0,
      };
    }
    case "reasoning": {
      const thinking = (p.summary ?? [])
        .map((s) => s.text ?? "")
        .filter(Boolean)
        .join("\n");
      if (!thinking) return null;
      return {
        id: idBase,
        source: "codex",
        sessionId: state.sessionId,
        ts,
        cwd: state.cwd,
        role: "assistant",
        text: "",
        thinking,
        tokens: countTokens(thinking),
      };
    }
    default:
      return null;
  }
}
