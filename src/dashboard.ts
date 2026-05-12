import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { DASHBOARD_HTML } from "./dashboardHtml.js";
import { type SessionSource } from "./sessionIndex.js";
import { getSessionsPayload } from "./sessionPayload.js";
import { openSession } from "./sessionLauncher.js";

export { DASHBOARD_HTML };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const ASSET_DIR = join(PKG_ROOT, "assets");

export interface DashboardOptions {
  host?: string;
  port?: number;
  open?: boolean;
}

interface OpenRequest {
  source?: SessionSource;
  sessionId?: string;
  target?: "native" | "claude" | "codex";
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function text(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function asset(res: ServerResponse, path: string): boolean {
  if (!path.startsWith("/assets/")) return false;
  const name = path.slice("/assets/".length);
  if (!/^[a-z0-9_.-]+$/i.test(name)) return false;
  const filePath = join(ASSET_DIR, name);
  if (!existsSync(filePath)) return false;
  const ext = name.split(".").pop()?.toLowerCase();
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "svg"
        ? "image/svg+xml"
        : ext === "ico"
          ? "image/x-icon"
          : "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(readFileSync(filePath));
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function spawnDetached(file: string, args: string[]): void {
  const child = spawn(file, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function openDashboardUrl(url: string): void {
  const os = platform();
  if (os === "win32") {
    spawnDetached("cmd.exe", ["/c", "start", "", "msedge", `--app=${url}`, "--window-size=760,640"]);
  } else if (os === "darwin") {
    spawnDetached("open", [url]);
  } else {
    spawnDetached("xdg-open", [url]);
  }
}

async function handleOpen(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: OpenRequest;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON body." });
    return;
  }

  if (
    (parsed.source !== "claude" && parsed.source !== "codex") ||
    typeof parsed.sessionId !== "string" ||
    !parsed.sessionId
  ) {
    json(res, 400, { ok: false, error: "source and sessionId are required." });
    return;
  }

  const result = openSession(parsed);
  json(res, result.ok ? 200 : 404, result);
}

export async function startDashboard(opts: DashboardOptions = {}): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 37373;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    try {
      if (req.method === "GET" && url.pathname === "/") {
        text(res, 200, DASHBOARD_HTML, "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && asset(res, url.pathname)) return;
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        json(res, 200, getSessionsPayload());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/open") {
        await handleOpen(req, res);
        return;
      }
      json(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const url = `http://${host}:${port}`;
  console.log(`Claudex dashboard: ${url}`);
  console.log("Press Ctrl+C to stop.");
  if (opts.open !== false) openDashboardUrl(url);
}
