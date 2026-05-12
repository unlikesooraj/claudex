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
      "--window-size=980,720",
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
  <title>Claudex Sessions</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Segoe UI", Inter, system-ui, sans-serif;
      --bg: #0d1115;
      --shell: #14191f;
      --panel: #181f26;
      --panel-2: #11171d;
      --line: #2a333d;
      --line-soft: #202831;
      --text: #f4f8fc;
      --muted: #93a2b2;
      --dim: #687686;
      --blue: #58a6ff;
      --cyan: #56d5ff;
      --green: #58d98c;
      --amber: #e6b856;
      --red: #ff7171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 920px;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
    }
    button, input, select { font: inherit; }
    button {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      background: #17202a;
      cursor: pointer;
    }
    button:hover { border-color: #3f4e5d; background: #202a34; }
    .window {
      width: 100vw;
      height: 100vh;
      display: grid;
      grid-template-rows: 52px 1fr;
      background: var(--shell);
    }
    .topbar {
      display: grid;
      grid-template-columns: 220px 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
      background: #151319;
    }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .mark {
      width: 30px; height: 30px; display: grid; place-items: center;
      border: 1px solid rgba(86,213,255,.35); border-radius: 6px;
      color: var(--cyan); background: rgba(86,213,255,.08); font-weight: 800;
    }
    .brand strong, .brand span { display: block; }
    .brand strong { font-size: 14px; line-height: 17px; }
    .brand span { color: var(--muted); font-size: 11px; line-height: 14px; }
    .search {
      height: 34px; min-width: 0; display: flex; align-items: center; gap: 8px;
      padding: 0 10px; border: 1px solid var(--line); border-radius: 6px;
      background: #22212a; color: var(--muted);
    }
    .search input { width: 100%; min-width: 0; color: var(--text); background: transparent; border: 0; outline: 0; font-size: 13px; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .pill {
      display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 9px;
      border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 12px;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); }
    .available .dot, .active .dot { background: var(--green); }
    .constrained .dot { background: var(--amber); }
    .limited .dot { background: var(--red); }
    .main {
      min-height: 0;
      display: grid;
      grid-template-columns: 66px minmax(560px, 1fr) 330px;
    }
    .rail {
      padding: 14px 8px;
      border-right: 1px solid var(--line);
      background: #121016;
    }
    .rail button {
      width: 42px; height: 38px; margin: 0 0 8px 0; display: grid; place-items: center;
      color: #c7d2dd; background: transparent;
    }
    .rail button.active { border-color: rgba(255,255,255,.1); background: #27242c; box-shadow: inset 3px 0 0 #ff806a; }
    .content { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto auto 1fr; }
    .summary {
      display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--line);
    }
    .summary article { padding: 10px 14px; border-right: 1px solid var(--line-soft); background: #11171d; }
    .summary span { display: block; color: var(--muted); font-size: 11px; line-height: 15px; }
    .summary strong { display: block; margin-top: 3px; font-size: 18px; line-height: 22px; }
    .toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px; border-bottom: 1px solid var(--line); background: #121820;
    }
    .toolbar h1 { margin: 0; font-size: 17px; line-height: 22px; }
    .toolbar p { margin: 0; color: var(--muted); font-size: 12px; }
    .filters { display: flex; align-items: center; gap: 8px; }
    select {
      height: 30px; border: 1px solid var(--line); border-radius: 6px;
      background: #17202a; color: var(--text); padding: 0 8px; font-size: 12px;
    }
    .sessions { min-height: 0; overflow: auto; padding: 10px 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    th { height: 34px; padding: 0 10px; text-align: left; color: #bdd0e2; font-weight: 600; background: #151d24; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 1; }
    td { height: 58px; padding: 0 10px; border-bottom: 1px solid rgba(255,255,255,.045); vertical-align: middle; }
    tr { cursor: pointer; }
    tbody tr:hover, tbody tr.selected { background: rgba(86,213,255,.055); }
    .source { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .appicon { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(255,255,255,.14); flex: 0 0 auto; }
    .appicon.claude { background: linear-gradient(135deg, #ff8c64, #8b4a33); }
    .appicon.codex { background: linear-gradient(135deg, #7aa7ff, #6d55e8); }
    .source strong, .source span { display: block; white-space: nowrap; }
    .source span, .muted { color: var(--muted); font-size: 11px; }
    .path { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { display: inline-flex; align-items: center; gap: 6px; min-height: 23px; padding: 0 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--line); }
    .state.available { color: #b4f6cb; background: rgba(88,217,140,.11); border-color: rgba(88,217,140,.25); }
    .state.constrained { color: #ffe1a6; background: rgba(230,184,86,.12); border-color: rgba(230,184,86,.28); }
    .state.limited { color: #ffc3c3; background: rgba(255,113,113,.12); border-color: rgba(255,113,113,.3); }
    .state.unknown { color: #c9d3dc; background: rgba(255,255,255,.06); }
    .side {
      min-width: 0; min-height: 0; display: grid; grid-template-rows: auto 1fr auto;
      border-left: 1px solid var(--line); background: #11171d;
    }
    .recommendation { padding: 12px; border-bottom: 1px solid var(--line); background: var(--panel-2); }
    .recommendation h2, .details h2 { margin: 0 0 4px; font-size: 14px; }
    .recommendation p, .details p { margin: 0; color: var(--muted); font-size: 12px; line-height: 17px; }
    .details { min-height: 0; overflow: auto; padding: 12px; }
    .detail-block { padding: 10px 0; border-bottom: 1px solid var(--line-soft); }
    .detail-block span { display: block; color: var(--muted); font-size: 11px; margin-bottom: 3px; }
    .detail-block strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
    .prompt { color: #dbe8f4; font-size: 12px; line-height: 17px; overflow-wrap: anywhere; }
    .launches { padding: 12px; display: grid; gap: 8px; border-top: 1px solid var(--line); }
    .launches button.primary { border-color: rgba(88,217,140,.32); background: rgba(88,217,140,.1); }
    .toast {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
      padding: 9px 12px; border: 1px solid var(--line); border-radius: 6px;
      background: #19222c; color: var(--text); font-size: 12px; opacity: 0; pointer-events: none;
      transition: opacity .14s ease;
    }
    .toast.show { opacity: 1; }
    @media (max-width: 760px) {
      body { min-width: 0; overflow: auto; }
      .window { min-height: 100vh; height: auto; }
      .topbar { grid-template-columns: 1fr auto; }
      .search { grid-column: 1 / -1; }
      .main { grid-template-columns: 50px 1fr; }
      .side { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--line); }
      .summary { grid-template-columns: repeat(2, 1fr); }
      th:nth-child(4), th:nth-child(5), td:nth-child(4), td:nth-child(5) { display: none; }
      .path { max-width: 150px; white-space: normal; overflow-wrap: anywhere; }
    }
  </style>
</head>
<body>
  <main class="window">
    <header class="topbar">
      <div class="brand"><div class="mark">C</div><div><strong>Claudex</strong><span>local sessions</span></div></div>
      <label class="search">Search <input id="q" placeholder="session, project, cwd, prompt..." /></label>
      <div class="actions"><span id="localPill" class="pill available"><span class="dot"></span>100% local</span><button id="refresh">Refresh</button></div>
    </header>
    <section class="main">
      <nav class="rail"><button class="active" title="Sessions">▦</button><button title="Usage">◷</button><button title="Cache">▤</button></nav>
      <section class="content">
        <div class="summary">
          <article><span>Total sessions</span><strong id="total">0</strong></article>
          <article><span>Claude Code</span><strong id="claudeCount">0</strong></article>
          <article><span>Codex</span><strong id="codexCount">0</strong></article>
          <article><span>Active now</span><strong id="activeCount">0</strong></article>
        </div>
        <div class="toolbar">
          <div><h1>Sessions</h1><p id="roots">Scanning local transcript stores</p></div>
          <div class="filters"><select id="source"><option value="all">Both apps</option><option value="claude">Claude</option><option value="codex">Codex</option></select><select id="usage"><option value="all">Any usage</option><option value="available">Available</option><option value="constrained">Constrained</option><option value="limited">Limited</option><option value="unknown">Unknown</option></select></div>
        </div>
        <div class="sessions">
          <table>
            <thead><tr><th>Session</th><th>Project</th><th>Usage</th><th>Activity</th><th>Turns</th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </section>
      <aside class="side">
        <section class="recommendation">
          <h2 id="bestTitle">Best next jump</h2>
          <p id="bestDetail">Waiting for local data.</p>
        </section>
        <section class="details" id="details"></section>
        <section class="launches">
          <button class="primary" id="resumeNative">Resume selected</button>
          <button id="openOther">Open in other app</button>
        </section>
      </aside>
    </section>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    let data = null;
    let selected = null;
    const els = {
      q: document.querySelector('#q'), source: document.querySelector('#source'), usage: document.querySelector('#usage'),
      rows: document.querySelector('#rows'), total: document.querySelector('#total'), claudeCount: document.querySelector('#claudeCount'),
      codexCount: document.querySelector('#codexCount'), activeCount: document.querySelector('#activeCount'), roots: document.querySelector('#roots'),
      bestTitle: document.querySelector('#bestTitle'), bestDetail: document.querySelector('#bestDetail'), details: document.querySelector('#details'),
      toast: document.querySelector('#toast'), resumeNative: document.querySelector('#resumeNative'), openOther: document.querySelector('#openOther')
    };
    function fmtTime(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'unknown';
      return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function showToast(text) {
      els.toast.textContent = text;
      els.toast.classList.add('show');
      setTimeout(() => els.toast.classList.remove('show'), 2200);
    }
    function filtered() {
      if (!data) return [];
      const q = els.q.value.trim().toLowerCase();
      return data.sessions.filter(s => {
        if (els.source.value !== 'all' && s.source !== els.source.value) return false;
        if (els.usage.value !== 'all' && s.usage.state !== els.usage.value) return false;
        if (!q) return true;
        return [s.source, s.sessionId, s.cwd, s.model, s.lastPrompt, s.usage.label].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }
    function rowHtml(s) {
      return '<tr data-key="' + encodeURIComponent(s.key) + '" class="' + (selected?.key === s.key ? 'selected' : '') + '">' +
        '<td><div class="source"><span class="appicon ' + s.source + '"></span><div><strong>' + (s.source === 'claude' ? 'Claude Code' : 'Codex') + '</strong><span>' + s.sessionId.slice(0, 12) + '</span></div></div></td>' +
        '<td><div class="path">' + escapeHtml(s.cwd) + '</div></td>' +
        '<td><span class="state ' + s.usage.state + '"><span class="dot"></span>' + escapeHtml(s.usage.label) + '</span></td>' +
        '<td>' + fmtTime(s.lastActivity) + '<div class="muted">' + s.activityState + '</div></td>' +
        '<td>' + s.turns.total + '<div class="muted">' + s.turns.user + ' user · ' + s.turns.assistant + ' assistant</div></td>' +
      '</tr>';
    }
    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function renderDetails() {
      const s = selected;
      if (!s) {
        els.details.innerHTML = '<h2>No session selected</h2><p>Select a session to inspect local usage and launch actions.</p>';
        return;
      }
      const other = s.source === 'claude' ? 'Codex' : 'Claude Code';
      els.resumeNative.textContent = 'Resume in ' + (s.source === 'claude' ? 'Claude Code' : 'Codex');
      els.openOther.textContent = 'Open same project in ' + other;
      els.details.innerHTML =
        '<h2>' + (s.source === 'claude' ? 'Claude Code' : 'Codex') + '</h2>' +
        '<p>' + escapeHtml(s.usage.detail) + '</p>' +
        '<div class="detail-block"><span>Session ID</span><strong>' + escapeHtml(s.sessionId) + '</strong></div>' +
        '<div class="detail-block"><span>Working directory</span><strong>' + escapeHtml(s.cwd) + '</strong><p>' + (s.cwdExists ? 'Folder exists' : 'Folder missing') + '</p></div>' +
        '<div class="detail-block"><span>Model / version</span><strong>' + escapeHtml([s.model, s.version].filter(Boolean).join(' · ') || 'unknown') + '</strong></div>' +
        '<div class="detail-block"><span>Usage</span><strong>' + escapeHtml(s.usage.label) + '</strong><p>' + escapeHtml(s.usage.detail) + '</p></div>' +
        '<div class="detail-block"><span>Tokens observed</span><strong>' + (s.usage.totalTokens ?? s.tokens.text ?? 0).toLocaleString() + '</strong><p>input ' + (s.tokens.input ?? 0).toLocaleString() + ' · output ' + (s.tokens.output ?? 0).toLocaleString() + ' · cache read ' + (s.tokens.cacheRead ?? 0).toLocaleString() + ' · cache write ' + (s.tokens.cacheWrite ?? 0).toLocaleString() + '</p></div>' +
        '<div class="detail-block"><span>Last prompt</span><div class="prompt">' + escapeHtml(s.lastPrompt || 'No prompt snippet recorded.') + '</div></div>' +
        '<div class="detail-block"><span>Transcript file</span><strong>' + escapeHtml(s.filePath) + '</strong></div>';
    }
    function render() {
      if (!data) return;
      els.total.textContent = data.counts.total;
      els.claudeCount.textContent = data.counts.claude;
      els.codexCount.textContent = data.counts.codex;
      els.activeCount.textContent = data.counts.active;
      els.roots.textContent = data.roots.claude + ' · ' + data.roots.codex;
      const best = data.availability.best;
      els.bestTitle.textContent = best ? 'Best next jump: ' + (best.source === 'codex' ? 'Codex' : 'Claude Code') : 'Best next jump';
      els.bestDetail.textContent = best ? best.label + ' · ' + best.detail : 'No local sessions found.';
      const rows = filtered();
      if (!selected || !rows.some(s => s.key === selected.key)) selected = rows[0] || data.sessions[0] || null;
      els.rows.innerHTML = rows.map(rowHtml).join('');
      document.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => {
        selected = data.sessions.find(s => s.key === decodeURIComponent(tr.dataset.key));
        render();
      }));
      renderDetails();
    }
    async function apiSessions() {
      if (window.claudex?.sessions) return window.claudex.sessions();
      const res = await fetch('/api/sessions');
      return res.json();
    }
    async function apiOpen(body) {
      if (window.claudex?.open) return window.claudex.open(body);
      const res = await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return res.json();
    }
    async function refresh() {
      data = await apiSessions();
      render();
    }
    async function openSelected(target) {
      if (!selected) return;
      const payload = await apiOpen({ source: selected.source, sessionId: selected.sessionId, target });
      if (!payload.ok) showToast(payload.error || 'Could not open session');
      else showToast('Launched ' + payload.target + ' in ' + payload.cwd);
    }
    document.querySelector('#refresh').addEventListener('click', refresh);
    els.q.addEventListener('input', render);
    els.source.addEventListener('change', render);
    els.usage.addEventListener('change', render);
    els.resumeNative.addEventListener('click', () => openSelected('native'));
    els.openOther.addEventListener('click', () => openSelected(selected?.source === 'claude' ? 'codex' : 'claude'));
    refresh().catch(err => showToast(String(err)));
  </script>
</body>
</html>`;
