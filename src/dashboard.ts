import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { type SessionSource } from "./sessionIndex.js";
import { getSessionsPayload } from "./sessionPayload.js";
import { openSession } from "./sessionLauncher.js";

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
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function text(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
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

function spawnDetached(file: string, args: string[], cwd?: string): void {
  const child = spawn(file, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function openDashboardUrl(url: string): void {
  const os = platform();
  if (os === "win32") {
    spawnDetached("cmd.exe", [
      "/c",
      "start",
      "",
      "msedge",
      `--app=${url}`,
      "--window-size=940,620",
    ]);
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

function sessionsPayload(): unknown {
  return getSessionsPayload();
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
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        json(res, 200, sessionsPayload());
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

export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Claudex</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Segoe UI", Inter, system-ui, sans-serif;
      --console-bg: #0f1114;
      --surface-0: #121418;
      --surface-1: #171a1f;
      --surface-2: #1c2027;
      --surface-3: #232832;
      --line-soft: rgba(255,255,255,.055);
      --line: rgba(255,255,255,.105);
      --line-strong: rgba(255,255,255,.18);
      --text-1: #f3f6f8;
      --text-2: #bec8d2;
      --text-3: #8895a3;
      --text-4: #5f6b78;
      --codex: #7fb0ff;
      --claude: #ff9b72;
      --local: #69d58c;
      --warn: #e6bf63;
      --bad: #ff776f;
      --focus: #8ed3ff;
      --radius: 8px;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body {
      margin: 0;
      min-width: 720px;
      background: var(--console-bg);
      color: var(--text-1);
      overflow: hidden;
    }
    button, input, select { font: inherit; }
    button {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 7px;
      color: var(--text-1);
      background: var(--surface-2);
      cursor: pointer;
    }
    button:hover { background: var(--surface-3); border-color: var(--line-strong); }
    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid rgba(142,211,255,.45);
      outline-offset: 1px;
    }
    button:disabled { color: var(--text-4); cursor: default; background: var(--surface-1); }
    .window {
      width: 100vw;
      height: 100vh;
      display: grid;
      grid-template-rows: 46px 1fr;
      background: var(--surface-0);
    }
    .topbar {
      display: grid;
      grid-template-columns: 190px 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 0 10px;
      border-bottom: 1px solid var(--line);
      background: #141316;
    }
    .brand {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .brand-mark {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(105,213,140,.32);
      border-radius: 7px;
      background: rgba(105,213,140,.08);
      color: var(--local);
      font-weight: 800;
      font-size: 12px;
      letter-spacing: 0;
    }
    .brand-title { min-width: 0; }
    .brand-title strong, .brand-title span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .brand-title strong { font-size: 13px; line-height: 16px; }
    .brand-title span { color: var(--text-3); font-size: 11px; line-height: 14px; }
    .search {
      height: 31px;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #1b1d22;
      color: var(--text-3);
      font-size: 12px;
    }
    .search input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text-1);
      font-size: 12px;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .app-pill {
      height: 26px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--text-2);
      background: rgba(255,255,255,.025);
      font-size: 11px;
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-4);
      flex: 0 0 auto;
    }
    .on .dot, .available .dot { background: var(--local); }
    .constrained .dot { background: var(--warn); }
    .limited .dot { background: var(--bad); }
    .main {
      min-height: 0;
      display: grid;
      grid-template-columns: 236px minmax(330px, 1fr) 292px;
    }
    .folders, .inspector {
      min-width: 0;
      min-height: 0;
      background: var(--surface-0);
    }
    .folders {
      border-right: 1px solid var(--line);
      display: grid;
      grid-template-rows: auto auto 1fr;
    }
    .section-head {
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 10px;
      border-bottom: 1px solid var(--line-soft);
      color: var(--text-2);
      font-size: 12px;
      font-weight: 650;
    }
    .source-filter {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--line-soft);
    }
    .source-filter button {
      height: 28px;
      padding: 0 6px;
      font-size: 11px;
      color: var(--text-2);
      background: transparent;
    }
    .source-filter button.active { background: var(--surface-2); color: var(--text-1); }
    .folder-list {
      min-height: 0;
      overflow: auto;
      padding: 8px;
    }
    .folder-button {
      width: 100%;
      min-height: 42px;
      height: auto;
      margin: 0 0 6px 0;
      padding: 7px 8px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 8px;
      text-align: left;
      background: transparent;
    }
    .folder-button.active {
      background: var(--surface-2);
      border-color: var(--line-strong);
      box-shadow: inset 3px 0 0 var(--local);
    }
    .folder-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      color: var(--text-1);
      font-weight: 650;
    }
    .folder-path {
      grid-column: 1 / -1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-3);
      font-size: 10.5px;
    }
    .count-chip {
      min-width: 24px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line-soft);
      border-radius: 999px;
      color: var(--text-2);
      font-size: 11px;
      background: rgba(255,255,255,.035);
    }
    .content {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto 1fr;
      background: var(--surface-1);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border-bottom: 1px solid var(--line);
      background: #15191f;
    }
    .stat {
      min-width: 0;
      height: 56px;
      padding: 8px 10px;
      border-right: 1px solid var(--line-soft);
    }
    .stat span, .meta { color: var(--text-3); font-size: 11px; line-height: 14px; }
    .stat strong {
      display: block;
      margin-top: 3px;
      font-size: 19px;
      line-height: 22px;
      font-variant-numeric: tabular-nums;
    }
    .toolbar {
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 10px;
      border-bottom: 1px solid var(--line);
      background: var(--surface-1);
    }
    .toolbar h1 {
      margin: 0;
      font-size: 15px;
      line-height: 18px;
      font-weight: 700;
    }
    .toolbar small {
      display: block;
      margin-top: 1px;
      color: var(--text-3);
      font-size: 10.5px;
      line-height: 13px;
    }
    .select {
      height: 28px;
      border: 1px solid var(--line);
      border-radius: 7px;
      color: var(--text-1);
      background: var(--surface-2);
      padding: 0 8px;
      font-size: 11px;
    }
    .chat-list {
      min-height: 0;
      overflow: auto;
      padding: 9px 10px;
    }
    .empty {
      height: 100%;
      min-height: 240px;
      display: grid;
      place-items: center;
      color: var(--text-3);
      text-align: center;
      font-size: 12px;
    }
    .chat-card {
      width: 100%;
      min-height: 86px;
      margin: 0 0 8px 0;
      padding: 10px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-2);
      cursor: pointer;
    }
    .chat-card:hover, .chat-card.selected {
      border-color: var(--line-strong);
      background: #20252d;
    }
    .chat-card.selected { box-shadow: inset 3px 0 0 var(--focus); }
    .chat-main {
      min-width: 0;
      display: grid;
      gap: 5px;
    }
    .chat-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      line-height: 17px;
      font-weight: 700;
      color: var(--text-1);
    }
    .chat-path, .chat-sub {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-3);
      font-size: 11px;
      line-height: 14px;
    }
    .chat-actions {
      display: flex;
      align-items: start;
      gap: 6px;
    }
    .app-badge, .state-badge {
      height: 23px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 10.5px;
      white-space: nowrap;
      color: var(--text-2);
      background: rgba(255,255,255,.035);
    }
    .app-badge.codex { border-color: rgba(127,176,255,.32); color: #cfe1ff; }
    .app-badge.claude { border-color: rgba(255,155,114,.34); color: #ffd8c8; }
    .state-badge.available { border-color: rgba(105,213,140,.28); color: #c7f4d5; }
    .state-badge.constrained { border-color: rgba(230,191,99,.32); color: #ffe4ad; }
    .state-badge.limited { border-color: rgba(255,119,111,.32); color: #ffc9c4; }
    .quick-open {
      height: 24px;
      padding: 0 8px;
      font-size: 11px;
      background: rgba(142,211,255,.09);
      border-color: rgba(142,211,255,.24);
    }
    .inspector {
      border-left: 1px solid var(--line);
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    .best {
      padding: 10px;
      border-bottom: 1px solid var(--line);
      background: #14181e;
    }
    .best h2, .details h2 {
      margin: 0;
      font-size: 13px;
      line-height: 17px;
    }
    .best p, .details p {
      margin: 4px 0 0 0;
      color: var(--text-3);
      font-size: 11px;
      line-height: 15px;
    }
    .details {
      min-height: 0;
      overflow: auto;
      padding: 10px;
    }
    .detail-block {
      padding: 9px 0;
      border-bottom: 1px solid var(--line-soft);
    }
    .detail-block span {
      display: block;
      margin-bottom: 3px;
      color: var(--text-3);
      font-size: 10.5px;
      line-height: 13px;
    }
    .detail-block strong {
      display: block;
      color: var(--text-1);
      font-size: 12px;
      line-height: 16px;
      overflow-wrap: anywhere;
    }
    .mono {
      font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }
    .launches {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
      padding: 10px;
      border-top: 1px solid var(--line);
      background: #14181e;
    }
    .launches button { min-width: 0; padding: 0 8px; font-size: 11.5px; }
    .launches .primary {
      grid-column: 1 / -1;
      border-color: rgba(105,213,140,.32);
      background: rgba(105,213,140,.11);
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      max-width: min(520px, calc(100vw - 24px));
      padding: 9px 11px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #1b2028;
      color: var(--text-1);
      font-size: 12px;
      opacity: 0;
      pointer-events: none;
      transition: opacity .14s ease;
      box-shadow: 0 10px 32px rgba(0,0,0,.26);
    }
    .toast.show { opacity: 1; }
    @media (max-width: 880px) {
      body { min-width: 0; overflow: auto; }
      .window { min-height: 100vh; height: auto; }
      .topbar { grid-template-columns: 1fr auto; height: auto; min-height: 46px; }
      .search { grid-column: 1 / -1; margin-bottom: 8px; }
      .main { grid-template-columns: 1fr; }
      .folders, .inspector { border: 0; }
      .folders { max-height: 260px; border-bottom: 1px solid var(--line); }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .chat-list { max-height: 520px; }
    }
  </style>
</head>
<body>
  <main class="window">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" id="brandMark">CX</div>
        <div class="brand-title"><strong>Claudex</strong><span>native bridge</span></div>
      </div>
      <label class="search">Search <input id="q" placeholder="open chats, folders, session ids" /></label>
      <div class="top-actions">
        <span id="codexPill" class="app-pill"><span class="dot"></span>Codex</span>
        <span id="claudePill" class="app-pill"><span class="dot"></span>Claude</span>
        <button id="refresh" title="Refresh">Refresh</button>
      </div>
    </header>
    <section class="main">
      <aside class="folders">
        <div class="section-head"><span>Folders</span><strong id="folderTotal" class="count-chip">0</strong></div>
        <div class="source-filter">
          <button id="filterAll" class="active" data-source="all">All</button>
          <button id="filterCodex" data-source="codex">Codex</button>
          <button id="filterClaude" data-source="claude">Claude</button>
        </div>
        <div class="folder-list" id="folderList"></div>
      </aside>
      <section class="content">
        <div class="stats">
          <article class="stat"><span>Open chats</span><strong id="openCount">0</strong></article>
          <article class="stat"><span>Folders</span><strong id="folderCount">0</strong></article>
          <article class="stat"><span>Codex</span><strong id="codexCount">0</strong></article>
          <article class="stat"><span>Claude</span><strong id="claudeCount">0</strong></article>
        </div>
        <div class="toolbar">
          <div><h1 id="viewTitle">Open app sessions</h1><small id="viewSub">Live native process view</small></div>
          <select id="usage" class="select">
            <option value="all">Any usage</option>
            <option value="available">Available</option>
            <option value="constrained">Constrained</option>
            <option value="limited">Limited</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div class="chat-list" id="chatList"></div>
      </section>
      <aside class="inspector">
        <section class="best">
          <h2 id="bestTitle">Best route</h2>
          <p id="bestDetail">Waiting for native app state.</p>
        </section>
        <section class="details" id="details"></section>
        <section class="launches">
          <button class="primary" id="openNative">Open chat</button>
          <button id="openCodex">Codex</button>
          <button id="openClaude">Claude</button>
        </section>
      </aside>
    </section>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    let data = null;
    let selectedKey = null;
    let selectedFolder = 'all';
    let sourceFilter = 'all';
    const els = {
      q: document.querySelector('#q'),
      usage: document.querySelector('#usage'),
      folderList: document.querySelector('#folderList'),
      chatList: document.querySelector('#chatList'),
      openCount: document.querySelector('#openCount'),
      folderCount: document.querySelector('#folderCount'),
      folderTotal: document.querySelector('#folderTotal'),
      codexCount: document.querySelector('#codexCount'),
      claudeCount: document.querySelector('#claudeCount'),
      codexPill: document.querySelector('#codexPill'),
      claudePill: document.querySelector('#claudePill'),
      viewTitle: document.querySelector('#viewTitle'),
      viewSub: document.querySelector('#viewSub'),
      bestTitle: document.querySelector('#bestTitle'),
      bestDetail: document.querySelector('#bestDetail'),
      details: document.querySelector('#details'),
      toast: document.querySelector('#toast'),
      openNative: document.querySelector('#openNative'),
      openCodex: document.querySelector('#openCodex'),
      openClaude: document.querySelector('#openClaude')
    };
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function shortId(value) {
      value = String(value ?? '');
      return value.length > 12 ? value.slice(0, 12) : value;
    }
    function appName(source) {
      return source === 'claude' ? 'Claude' : 'Codex';
    }
    function fmtTime(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return 'unknown';
      return date.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function tokenCount(value) {
      const n = Number(value ?? 0);
      return Number.isFinite(n) ? n.toLocaleString() : '0';
    }
    function cacheLine(session) {
      const read = session.tokens?.cacheRead ?? session.usage?.cacheReadTokens ?? 0;
      const write = session.tokens?.cacheWrite ?? session.usage?.cacheWriteTokens ?? 0;
      return 'cache read ' + tokenCount(read) + ' | write ' + tokenCount(write);
    }
    function selectedSession() {
      const sessions = data?.sessions ?? [];
      return sessions.find(session => session.key === selectedKey) || filteredSessions()[0] || sessions[0] || null;
    }
    function filteredSessions() {
      if (!data) return [];
      const q = els.q.value.trim().toLowerCase();
      return data.sessions.filter(session => {
        if (sourceFilter !== 'all' && session.source !== sourceFilter) return false;
        if (selectedFolder !== 'all') {
          const group = data.folders.find(folder => folder.key === selectedFolder);
          if (!group || !group.sessions.some(item => item.key === session.key)) return false;
        }
        if (els.usage.value !== 'all' && session.usage.state !== els.usage.value) return false;
        if (!q) return true;
        return [
          session.source,
          session.title,
          session.sessionId,
          session.cliSessionId,
          session.cwd,
          session.model,
          session.effort,
          session.usage.label,
          session.lastPrompt
        ].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }
    function showToast(text) {
      els.toast.textContent = text;
      els.toast.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
    }
    function renderPills() {
      const codexOn = data?.apps?.codex?.running;
      const claudeOn = data?.apps?.claude?.running;
      els.codexPill.className = 'app-pill ' + (codexOn ? 'on' : '');
      els.claudePill.className = 'app-pill ' + (claudeOn ? 'on' : '');
      els.codexPill.innerHTML = '<span class="dot"></span>Codex ' + (codexOn ? 'on' : 'off');
      els.claudePill.innerHTML = '<span class="dot"></span>Claude ' + (claudeOn ? 'on' : 'off');
    }
    function renderStats() {
      els.openCount.textContent = data?.counts?.open ?? 0;
      els.folderCount.textContent = data?.counts?.folders ?? 0;
      els.folderTotal.textContent = data?.counts?.folders ?? 0;
      els.codexCount.textContent = data?.counts?.codex ?? 0;
      els.claudeCount.textContent = data?.counts?.claude ?? 0;
      const best = data?.availability?.best;
      els.bestTitle.textContent = best ? 'Best route: ' + appName(best.source) : 'Best route';
      els.bestDetail.textContent = best ? best.label + ' | ' + best.detail : 'No usage signal yet.';
    }
    function renderFolders() {
      if (!data) return;
      const allActive = selectedFolder === 'all' ? ' active' : '';
      let html = '<button class="folder-button' + allActive + '" data-folder="all">' +
        '<span class="folder-name">All open chats</span><span class="count-chip">' + data.counts.open + '</span>' +
        '<span class="folder-path">currently running in native apps</span></button>';
      html += data.folders.map(folder => {
        const active = folder.key === selectedFolder ? ' active' : '';
        return '<button class="folder-button' + active + '" data-folder="' + encodeURIComponent(folder.key) + '">' +
          '<span class="folder-name">' + escapeHtml(folder.name) + '</span>' +
          '<span class="count-chip">' + folder.sessions.length + '</span>' +
          '<span class="folder-path">' + escapeHtml(folder.cwd) + '</span>' +
        '</button>';
      }).join('');
      els.folderList.innerHTML = html;
      document.querySelectorAll('.folder-button').forEach(button => {
        button.addEventListener('click', () => {
          selectedFolder = button.dataset.folder === 'all' ? 'all' : decodeURIComponent(button.dataset.folder);
          selectedKey = null;
          render();
        });
      });
    }
    function chatCard(session) {
      const selected = session.key === selectedKey ? ' selected' : '';
      const exact = session.launch?.exact ? 'exact chat' : 'focus app';
      const model = [session.model, session.effort].filter(Boolean).join(' | ') || 'model unknown';
      return '<article class="chat-card' + selected + '" data-key="' + encodeURIComponent(session.key) + '">' +
        '<div class="chat-main">' +
          '<div class="chat-title">' + escapeHtml(session.title) + '</div>' +
          '<div class="chat-path">' + escapeHtml(session.cwd || 'No folder attached') + '</div>' +
          '<div class="chat-sub"><span class="mono">' + escapeHtml(shortId(session.sessionId)) + '</span> | ' + escapeHtml(model) + ' | ' + escapeHtml(fmtTime(session.lastActivity)) + '</div>' +
          '<div class="chat-sub">' + escapeHtml(cacheLine(session)) + '</div>' +
        '</div>' +
        '<div class="chat-actions">' +
          '<span class="app-badge ' + session.source + '">' + appName(session.source) + '</span>' +
          '<span class="state-badge ' + session.usage.state + '">' + escapeHtml(session.usage.label) + '</span>' +
          '<button class="quick-open" data-launch="native" data-key="' + encodeURIComponent(session.key) + '">' + escapeHtml(exact) + '</button>' +
        '</div>' +
      '</article>';
    }
    function renderChats() {
      const sessions = filteredSessions();
      const folderName = selectedFolder === 'all'
        ? 'Open app sessions'
        : (data.folders.find(folder => folder.key === selectedFolder)?.name || 'Open app sessions');
      els.viewTitle.textContent = folderName;
      els.viewSub.textContent = sessions.length + ' live chat' + (sessions.length === 1 ? '' : 's');
      if (!selectedKey || !sessions.some(session => session.key === selectedKey)) {
        selectedKey = sessions[0]?.key ?? data?.sessions?.[0]?.key ?? null;
      }
      if (!sessions.length) {
        els.chatList.innerHTML = '<div class="empty">No open native app chats match this view.</div>';
        return;
      }
      els.chatList.innerHTML = sessions.map(chatCard).join('');
      document.querySelectorAll('.chat-card').forEach(card => {
        card.addEventListener('click', () => {
          selectedKey = decodeURIComponent(card.dataset.key);
          render();
        });
      });
      document.querySelectorAll('[data-launch]').forEach(button => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          selectedKey = decodeURIComponent(button.dataset.key);
          openSelected(button.dataset.launch);
        });
      });
    }
    function renderDetails() {
      const session = selectedSession();
      const disabled = !session;
      els.openNative.disabled = disabled;
      els.openCodex.disabled = disabled;
      els.openClaude.disabled = disabled;
      if (!session) {
        els.openNative.textContent = 'Open chat';
        els.details.innerHTML = '<h2>No open chat selected</h2><p>Open Codex or Claude desktop to populate this window.</p>';
        return;
      }
      selectedKey = session.key;
      els.openNative.textContent = 'Open in ' + appName(session.source);
      els.openCodex.textContent = session.source === 'codex' ? 'Codex chat' : 'Codex folder';
      els.openClaude.textContent = session.source === 'claude' ? 'Claude chat' : 'Claude app';
      const nativeState = session.launch?.exact ? 'Exact chat link' : 'Native app focus';
      const folderState = session.cwdExists ? 'folder exists' : 'folder missing';
      els.details.innerHTML =
        '<h2>' + escapeHtml(session.title) + '</h2>' +
        '<p>' + escapeHtml(appName(session.source) + ' | ' + nativeState) + '</p>' +
        '<div class="detail-block"><span>Folder</span><strong>' + escapeHtml(session.cwd || 'No folder attached') + '</strong><p>' + escapeHtml(folderState) + '</p></div>' +
        '<div class="detail-block"><span>Session</span><strong class="mono">' + escapeHtml(session.sessionId) + '</strong>' + (session.cliSessionId ? '<p class="mono">' + escapeHtml(session.cliSessionId) + '</p>' : '') + '</div>' +
        '<div class="detail-block"><span>Usage</span><strong>' + escapeHtml(session.usage.label) + '</strong><p>' + escapeHtml(session.usage.detail) + '</p></div>' +
        '<div class="detail-block"><span>Tokens</span><strong>' + tokenCount(session.usage.totalTokens ?? session.tokens.text) + '</strong><p>input ' + tokenCount(session.tokens.input) + ' | output ' + tokenCount(session.tokens.output) + '</p></div>' +
        '<div class="detail-block"><span>Cache</span><strong>' + cacheLine(session) + '</strong></div>' +
        '<div class="detail-block"><span>Runtime</span><strong>' + escapeHtml([session.model, session.effort].filter(Boolean).join(' | ') || 'unknown') + '</strong><p>worker pid ' + escapeHtml(session.workerPid ?? 'unknown') + '</p></div>' +
        '<div class="detail-block"><span>Transcript</span><strong>' + escapeHtml(session.transcriptFile || 'not matched yet') + '</strong></div>';
    }
    function renderSourceButtons() {
      document.querySelectorAll('.source-filter button').forEach(button => {
        button.classList.toggle('active', button.dataset.source === sourceFilter);
      });
    }
    function render() {
      if (!data) return;
      renderPills();
      renderStats();
      renderSourceButtons();
      renderFolders();
      renderChats();
      renderDetails();
    }
    async function apiSessions() {
      if (window.claudex?.sessions) return window.claudex.sessions();
      const res = await fetch('/api/sessions');
      return res.json();
    }
    async function apiOpen(body) {
      if (window.claudex?.open) return window.claudex.open(body);
      const res = await fetch('/api/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.json();
    }
    async function refresh() {
      data = await apiSessions();
      if (!data.sessions?.some(session => session.key === selectedKey)) selectedKey = data.sessions?.[0]?.key ?? null;
      render();
    }
    async function openSelected(target) {
      const session = selectedSession();
      if (!session) return;
      const payload = await apiOpen({ source: session.source, sessionId: session.sessionId, target });
      showToast(payload.ok ? (payload.note || 'Opened ' + appName(payload.target)) : (payload.error || 'Could not open chat'));
    }
    document.querySelector('#refresh').addEventListener('click', refresh);
    document.querySelectorAll('.source-filter button').forEach(button => {
      button.addEventListener('click', () => {
        sourceFilter = button.dataset.source;
        selectedKey = null;
        render();
      });
    });
    els.q.addEventListener('input', render);
    els.usage.addEventListener('change', render);
    els.openNative.addEventListener('click', () => openSelected('native'));
    els.openCodex.addEventListener('click', () => openSelected('codex'));
    els.openClaude.addEventListener('click', () => openSelected('claude'));
    refresh().catch(err => showToast(String(err)));
  </script>
</body>
</html>`;
