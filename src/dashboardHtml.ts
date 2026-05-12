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
      --bg: #181818;
      --panel: #202020;
      --panel-2: #262424;
      --hover: #343131;
      --line: rgba(255,255,255,.08);
      --line-strong: rgba(255,255,255,.16);
      --text: #ece8e4;
      --muted: #aaa29d;
      --dim: #746e6a;
      --claude: #ff9a58;
      --codex: #80b7ff;
      --ok: #f7ca4f;
      --warn: #d8a24d;
      --bad: #ef736d;
      --accent: #8e55ff;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body {
      margin: 0;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
    }
    button, input, select { font: inherit; }
    button {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      background: var(--panel-2);
      cursor: pointer;
    }
    button:hover { background: var(--hover); border-color: var(--line-strong); }
    button:disabled { color: var(--dim); cursor: default; }
    .app {
      height: 100vh;
      display: grid;
      grid-template-rows: 46px 34px 1fr;
      background: var(--bg);
    }
    .top {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      background: #191716;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 130px;
      font-weight: 700;
    }
    .brand img { width: 28px; height: 28px; object-fit: contain; }
    .search {
      height: 30px;
      min-width: 0;
      display: flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #232120;
      padding: 0 9px;
    }
    .search input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
    }
    .filters {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .filters button {
      height: 28px;
      padding: 0 9px;
      color: var(--muted);
      background: transparent;
    }
    .filters button.active { color: var(--text); background: var(--panel-2); }
    .health {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      background: #1d1b1a;
      white-space: nowrap;
      overflow: hidden;
    }
    .health span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dot {
      width: 7px;
      height: 7px;
      display: inline-block;
      border-radius: 99px;
      margin-right: 6px;
      background: var(--dim);
    }
    .dot.on { background: var(--ok); }
    .dot.claude { background: var(--claude); }
    .dot.codex { background: var(--codex); }
    .layout {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(290px, 360px) minmax(280px, 1fr);
    }
    .sidebar {
      min-width: 0;
      min-height: 0;
      border-right: 1px solid var(--line);
      overflow: auto;
      padding: 10px 8px 14px;
      background: var(--panel);
    }
    .sectionTitle {
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--muted);
      padding: 0 6px;
      margin-top: 2px;
    }
    .folder {
      margin: 8px 0 12px;
    }
    .folderHead {
      height: 28px;
      display: grid;
      grid-template-columns: 18px 1fr auto;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      padding: 0 6px;
    }
    .folderIcon {
      width: 14px;
      height: 10px;
      border: 1.5px solid var(--muted);
      border-radius: 2px;
      position: relative;
    }
    .folderIcon:before {
      content: "";
      position: absolute;
      left: 1px;
      top: -5px;
      width: 7px;
      height: 5px;
      border: 1.5px solid var(--muted);
      border-bottom: 0;
      border-radius: 2px 2px 0 0;
    }
    .folderName, .chatTitle, .pathLine {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .folderName { font-weight: 650; }
    .count { color: var(--dim); font-variant-numeric: tabular-nums; }
    .chatRow {
      width: 100%;
      height: 34px;
      display: grid;
      grid-template-columns: 17px 1fr auto;
      align-items: center;
      gap: 7px;
      border: 0;
      border-radius: 6px;
      padding: 0 7px 0 24px;
      margin: 1px 0;
      color: var(--muted);
      background: transparent;
      text-align: left;
    }
    .chatRow:hover { background: #2a2827; }
    .chatRow.active {
      background: #3a3634;
      color: var(--text);
    }
    .chatBullet {
      width: 7px;
      height: 7px;
      border: 1px solid var(--dim);
      border-radius: 99px;
    }
    .chatBullet.claude { border-color: var(--claude); }
    .chatBullet.codex { border-color: var(--codex); }
    .chatTitle { font-size: 13px; font-weight: 550; }
    .time { color: var(--dim); font-variant-numeric: tabular-nums; }
    .empty {
      padding: 22px 10px;
      color: var(--dim);
      text-align: center;
    }
    .detail {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto 1fr;
      background: #1b1a19;
      overflow: hidden;
    }
    .hero {
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--line);
    }
    .hero h1 {
      margin: 0;
      font-size: 22px;
      line-height: 28px;
      letter-spacing: 0;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin-top: 8px;
      color: var(--muted);
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--line);
      background: #1f1d1c;
    }
    .actions .primary {
      grid-column: 1 / -1;
      border-color: rgba(255,154,88,.35);
      background: rgba(255,154,88,.13);
    }
    .info {
      min-height: 0;
      overflow: auto;
      padding: 8px 20px 20px;
    }
    .row {
      padding: 11px 0;
      border-bottom: 1px solid var(--line);
    }
    .row label {
      display: block;
      color: var(--dim);
      font-size: 11px;
      margin-bottom: 4px;
    }
    .row strong {
      display: block;
      overflow-wrap: anywhere;
      font-weight: 600;
    }
    .mono {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      max-width: min(540px, calc(100vw - 24px));
      padding: 9px 12px;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: #282522;
      opacity: 0;
      transition: opacity .14s ease;
      pointer-events: none;
    }
    .toast.show { opacity: 1; }
    @media (max-width: 680px) {
      body { overflow: auto; }
      .app { min-height: 100vh; height: auto; }
      .top { grid-template-columns: 1fr auto; }
      .brand { min-width: 0; }
      .search { grid-column: 1 / -1; order: 3; }
      .layout { grid-template-columns: 1fr; }
      .sidebar { max-height: 45vh; border-right: 0; border-bottom: 1px solid var(--line); }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="top">
      <div class="brand"><img src="assets/claudex-icon.png" alt="" /><span>Claudex</span></div>
      <label class="search"><input id="q" placeholder="Search chats and folders" /></label>
      <div class="filters">
        <button data-source="all" class="active">All</button>
        <button data-source="claude">Claude</button>
        <button data-source="codex">Codex</button>
        <button id="refresh" title="Refresh">Refresh</button>
      </div>
    </header>
    <section class="health">
      <span id="bridge"><i class="dot"></i>Bridge</span>
      <span id="openCount">0 chats</span>
      <span id="usageLine"></span>
    </section>
    <section class="layout">
      <nav class="sidebar">
        <div class="sectionTitle"><span>Folders</span><span id="folderCount">0</span></div>
        <div id="folders"></div>
      </nav>
      <section class="detail">
        <div class="hero">
          <h1 id="title">No chat selected</h1>
          <div class="meta" id="meta"></div>
        </div>
        <div class="actions">
          <button class="primary" id="openNative">Open source chat</button>
          <button id="openClaude">Claude</button>
          <button id="openCodex">Codex</button>
        </div>
        <div class="info" id="info"></div>
      </section>
    </section>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    let data = null;
    let selectedKey = null;
    let sourceFilter = 'all';
    let refreshInFlight = false;
    const $ = id => document.getElementById(id);
    const els = {
      q: $('q'), folders: $('folders'), title: $('title'), meta: $('meta'), info: $('info'),
      bridge: $('bridge'), openCount: $('openCount'), folderCount: $('folderCount'),
      usageLine: $('usageLine'), toast: $('toast'), openNative: $('openNative'),
      openClaude: $('openClaude'), openCodex: $('openCodex')
    };
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function appName(source) { return source === 'claude' ? 'Claude' : 'Codex'; }
    function age(iso) {
      const then = new Date(iso).getTime();
      if (!Number.isFinite(then)) return '';
      const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
      if (seconds < 60) return 'now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm';
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return hours + 'h';
      const days = Math.floor(hours / 24);
      if (days < 14) return days + 'd';
      return Math.floor(days / 7) + 'w';
    }
    function tokenCount(value) {
      const n = Number(value ?? 0);
      return Number.isFinite(n) ? n.toLocaleString() : '0';
    }
    function selectedSession() {
      const sessions = filteredSessions();
      return sessions.find(s => s.key === selectedKey) || sessions[0] || data?.sessions?.[0] || null;
    }
    function filteredSessions() {
      if (!data) return [];
      const q = els.q.value.trim().toLowerCase();
      return data.sessions.filter(session => {
        if (sourceFilter !== 'all' && session.source !== sourceFilter) return false;
        if (!q) return true;
        return [session.title, session.cwd, session.sessionId, session.cliSessionId, session.source]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }
    function groupedSessions() {
      const sessions = filteredSessions();
      const groups = [];
      for (const folder of data?.folders ?? []) {
        const items = folder.sessions.filter(s => sessions.some(x => x.key === s.key));
        if (items.length) groups.push({ ...folder, sessions: items });
      }
      return groups;
    }
    function showToast(text) {
      els.toast.textContent = text;
      els.toast.classList.add('show');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
    }
    function renderHealth() {
      const running = data?.bridge?.daemonRunning;
      els.bridge.innerHTML = '<i class="dot ' + (running ? 'on' : '') + '"></i>Bridge ' + (running ? 'on' : 'restarting');
      els.openCount.textContent = (data?.counts?.open ?? 0) + ' chat' + ((data?.counts?.open ?? 0) === 1 ? '' : 's');
      const best = data?.availability?.best;
      els.usageLine.textContent = best ? appName(best.source) + ': ' + best.label : '';
      els.folderCount.textContent = data?.counts?.folders ?? 0;
    }
    function renderFilters() {
      document.querySelectorAll('[data-source]').forEach(button => {
        button.classList.toggle('active', button.dataset.source === sourceFilter);
      });
    }
    function renderFolders() {
      const groups = groupedSessions();
      if (!groups.length) {
        els.folders.innerHTML = '<div class="empty">No chats</div>';
        return;
      }
      els.folders.innerHTML = groups.map(group => {
        const chats = group.sessions.map(session => {
          const active = session.key === selectedKey ? ' active' : '';
          return '<button class="chatRow' + active + '" data-key="' + encodeURIComponent(session.key) + '">' +
            '<span class="chatBullet ' + session.source + '"></span>' +
            '<span class="chatTitle">' + escapeHtml(session.title) + '</span>' +
            '<span class="time">' + escapeHtml(age(session.lastActivity)) + '</span>' +
          '</button>';
        }).join('');
        return '<section class="folder">' +
          '<div class="folderHead"><span class="folderIcon"></span><span class="folderName" title="' + escapeHtml(group.cwd) + '">' + escapeHtml(group.name) + '</span><span class="count">' + group.sessions.length + '</span></div>' +
          chats +
        '</section>';
      }).join('');
      document.querySelectorAll('.chatRow').forEach(row => {
        row.addEventListener('click', () => {
          selectedKey = decodeURIComponent(row.dataset.key);
          render();
        });
      });
    }
    function renderDetails() {
      const session = selectedSession();
      const disabled = !session;
      els.openNative.disabled = disabled;
      els.openClaude.disabled = disabled;
      els.openCodex.disabled = disabled;
      if (!session) {
        els.title.textContent = 'No chat selected';
        els.meta.textContent = '';
        els.info.innerHTML = '<div class="empty">No chats</div>';
        return;
      }
      selectedKey = session.key;
      els.title.textContent = session.title;
      els.meta.innerHTML = '<span><i class="dot ' + session.source + '"></i>' + appName(session.source) + '</span>' +
        '<span>' + escapeHtml(age(session.lastActivity)) + '</span>' +
        '<span>' + escapeHtml(session.launch?.exact ? 'Exact native chat' : 'Folder handoff') + '</span>';
      els.openNative.textContent = 'Open in ' + appName(session.source);
      els.openClaude.textContent = session.source === 'claude' ? 'Claude chat' : 'Continue in Claude';
      els.openCodex.textContent = session.source === 'codex' ? 'Codex chat' : 'Continue in Codex';
      const cacheRead = session.tokens?.cacheRead ?? session.usage?.cacheReadTokens ?? 0;
      const cacheWrite = session.tokens?.cacheWrite ?? session.usage?.cacheWriteTokens ?? 0;
      els.info.innerHTML =
        '<div class="row"><label>Folder</label><strong>' + escapeHtml(session.cwd || 'No folder attached') + '</strong></div>' +
        '<div class="row"><label>Usage</label><strong>' + escapeHtml(session.usage?.label || 'Unknown') + '</strong><div class="pathLine">' + escapeHtml(session.usage?.detail || '') + '</div></div>' +
        '<div class="row"><label>Tokens</label><strong>' + tokenCount(session.usage?.totalTokens ?? session.tokens?.text) + '</strong><div class="pathLine">input ' + tokenCount(session.tokens?.input) + ' | output ' + tokenCount(session.tokens?.output) + '</div></div>' +
        '<div class="row"><label>Cache</label><strong>read ' + tokenCount(cacheRead) + ' | write ' + tokenCount(cacheWrite) + '</strong></div>' +
        '<div class="row"><label>Session</label><strong class="mono">' + escapeHtml(session.sessionId) + '</strong>' + (session.cliSessionId ? '<div class="pathLine mono">' + escapeHtml(session.cliSessionId) + '</div>' : '') + '</div>' +
        '<div class="row"><label>Runtime</label><strong>' + escapeHtml([session.model, session.effort].filter(Boolean).join(' | ') || 'unknown') + '</strong></div>';
    }
    function render() {
      if (!data) return;
      const sessions = filteredSessions();
      if (!selectedKey || !sessions.some(s => s.key === selectedKey)) selectedKey = sessions[0]?.key ?? null;
      renderHealth();
      renderFilters();
      renderFolders();
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
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        data = await apiSessions();
        render();
      } finally {
        refreshInFlight = false;
      }
    }
    async function openSelected(target) {
      const session = selectedSession();
      if (!session) return;
      const payload = await apiOpen({ source: session.source, sessionId: session.sessionId, target });
      showToast(payload.ok ? (payload.note || 'Opened') : (payload.error || 'Could not open chat'));
      setTimeout(refresh, 900);
    }
    document.getElementById('refresh').addEventListener('click', refresh);
    document.querySelectorAll('[data-source]').forEach(button => {
      button.addEventListener('click', () => {
        sourceFilter = button.dataset.source;
        selectedKey = null;
        render();
      });
    });
    els.q.addEventListener('input', render);
    els.openNative.addEventListener('click', () => openSelected('native'));
    els.openClaude.addEventListener('click', () => openSelected('claude'));
    els.openCodex.addEventListener('click', () => openSelected('codex'));
    refresh().catch(err => showToast(String(err)));
    setInterval(refresh, 800);
  </script>
</body>
</html>`;
