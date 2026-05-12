#!/usr/bin/env node
// Minimal MCP server (Model Context Protocol) over stdio.
// Exposes claudex_get_context / claudex_get_plan / claudex_recent_files so
// either Claude Code or Codex can query the bridge state mid-conversation.
//
// MCP spec subset implemented: initialize, tools/list, tools/call.
// JSON-RPC 2.0 framing with newline-delimited messages (Codex + Claude both
// accept this transport when invoking an MCP server as a child process).

import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const CLAUDEX_HOME = process.env.CLAUDEX_HOME ?? join(homedir(), ".claudex");
const SHARED_DIR = join(CLAUDEX_HOME, "shared");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function projectHash(cwd: string): string {
  const n = cwd.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  return createHash("sha256").update(n).digest("hex").slice(0, 16);
}

function readShared(hash: string, file: string): string {
  const p = join(SHARED_DIR, hash, file);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

const TOOLS = [
  {
    name: "claudex_get_context",
    description:
      "Return the rolling claudex context for a project directory — last ~2K tokens of conversation from BOTH Claude Code and Codex CLI sessions in that folder, interleaved chronologically. Call this when the user asks 'what was I doing' / 'continue what we were working on' / refers to prior state you don't have, or when you suspect the other tool has updated state since this session started.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Absolute path of the project working directory. Defaults to the calling tool's cwd if omitted.",
        },
      },
    },
  },
  {
    name: "claudex_get_plan",
    description:
      "Return the active plan / open todo list / next steps detected from recent assistant turns for the given project directory.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "claudex_recent_files",
    description:
      "Return the list of file paths recently touched by either Claude Code or Codex in the given project directory.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
      },
    },
  },
];

function handle(req: JsonRpcRequest): JsonRpcResponse | null {
  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "claudex", version: "0.2.3" },
      },
    };
  }
  if (req.method === "notifications/initialized") {
    return null; // no response for notifications
  }
  if (req.method === "tools/list") {
    return { jsonrpc: "2.0", id: req.id ?? null, result: { tools: TOOLS } };
  }
  if (req.method === "tools/call") {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const name = params.name;
    const args = (params.arguments ?? {}) as { cwd?: string };
    const cwd = args.cwd ?? process.cwd();
    const hash = projectHash(cwd);
    let text = "";
    let file = "";
    switch (name) {
      case "claudex_get_context":
        file = "context.md";
        text = readShared(hash, "context.md") || `(no claudex context for ${cwd} — bridge daemon may not have seen activity here yet)`;
        break;
      case "claudex_get_plan":
        file = "plan.md";
        text = readShared(hash, "plan.md") || "_No active plan detected._";
        break;
      case "claudex_recent_files":
        file = "recent-files.txt";
        text = readShared(hash, "recent-files.txt") || "(no recent files recorded)";
        break;
      default:
        return {
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: { code: -32601, message: `unknown tool: ${name}` },
        };
    }
    return {
      jsonrpc: "2.0",
      id: req.id ?? null,
      result: {
        content: [{ type: "text", text }],
        isError: false,
      },
    };
  }
  return {
    jsonrpc: "2.0",
    id: req.id ?? null,
    error: { code: -32601, message: `method not found: ${req.method}` },
  };
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const res = handle(req);
  if (res) process.stdout.write(JSON.stringify(res) + "\n");
});
