#!/usr/bin/env node
// Minimal MCP server (Model Context Protocol) over stdio.
// Exposes claudex_get_context / claudex_get_plan / claudex_recent_files so
// either Claude Code or Codex can query the bridge state mid-conversation.
//
// MCP spec subset implemented: initialize, tools/list, tools/call.
// JSON-RPC 2.0 framing with newline-delimited messages (Codex + Claude both
// accept this transport when invoking an MCP server as a child process).

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
        serverInfo: { name: "claudex", version: "0.2.5" },
      },
    };
  }
  if (req.method === "notifications/initialized") {
    return null; // no response for notifications
  }
  if (req.method === "ping") {
    return { jsonrpc: "2.0", id: req.id ?? null, result: {} };
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

let framing: "headers" | "lines" = "lines";
let buffer = Buffer.alloc(0);

function log(message: string): void {
  process.stderr.write(`[claudex-mcp] ${message}\n`);
}

function send(res: JsonRpcResponse): void {
  const body = JSON.stringify(res);
  if (framing === "headers") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    return;
  }
  process.stdout.write(`${body}\n`);
}

function handleMessage(raw: string): void {
  if (!raw.trim()) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(raw);
  } catch (err) {
    log(`ignored invalid json: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    const res = handle(req);
    if (res) send(res);
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    });
  }
}

function headerEndIndex(input: Buffer): { index: number; length: number } {
  const crlf = input.indexOf("\r\n\r\n");
  if (crlf !== -1) return { index: crlf, length: 4 };
  const lf = input.indexOf("\n\n");
  return lf === -1 ? { index: -1, length: 0 } : { index: lf, length: 2 };
}

function pump(): void {
  while (buffer.length > 0) {
    const prefix = buffer.toString("utf8", 0, Math.min(buffer.length, 80));
    const maybeHeaders = /^Content-Length:/i.test(prefix);
    const header = headerEndIndex(buffer);
    if (maybeHeaders) {
      if (header.index === -1) return;
      framing = "headers";
      const headerText = buffer.toString("utf8", 0, header.index);
      const match = /^Content-Length:\s*(\d+)/im.exec(headerText);
      if (!match) {
        log("missing Content-Length header");
        buffer = Buffer.alloc(0);
        return;
      }
      const length = Number(match[1]);
      const bodyStart = header.index + header.length;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      const body = buffer.toString("utf8", bodyStart, bodyEnd);
      buffer = buffer.subarray(bodyEnd);
      handleMessage(body);
      continue;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.toString("utf8", 0, newline).trim();
    buffer = buffer.subarray(newline + 1);
    handleMessage(line);
  }
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  pump();
});

process.stdin.on("error", (err) => log(`stdin error: ${err.message}`));
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  log(`stdout error: ${err.message}`);
});
process.on("uncaughtException", (err) => log(`uncaughtException: ${err.stack ?? err.message}`));
process.on("unhandledRejection", (err) => log(`unhandledRejection: ${String(err)}`));
