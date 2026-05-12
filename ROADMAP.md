# Claudex roadmap

A living list of features and integrations. Many of these come from pain points raised across r/ClaudeAI, r/OpenAI, r/LocalLLaMA, r/ChatGPTCoding, GitHub issues on Claude Code and Codex CLI, and conversations with people running both subs simultaneously. Pick anything that calls to you and open a PR.

---

## Shipped — v0.1

- [x] Canonical `Turn` schema with parsers for Claude Code JSONL and Codex CLI JSONL
- [x] chokidar-based daemon, incremental ingest, append-only timeline
- [x] Project keying by hashed cwd — both tools' transcripts merge automatically
- [x] Rolling **2,000-token** context window (configurable budget)
- [x] Plan extraction (regex heuristics) + recent-files extraction
- [x] **Three layers of refresh:**
  - Claude `SessionStart` hook injects context via `additionalContext` at session launch
  - Claude `UserPromptSubmit` hook re-injects on every user turn (mtime-gated — no token waste when unchanged)
  - Codex managed `<!-- claudex:start -->` block written into `<project>/AGENTS.md` + `<project>/.claudex/context.md`
- [x] **Built-in MCP server** exposing `claudex_get_context`, `claudex_get_plan`, `claudex_recent_files` — registered into both Claude (`mcpServers`) and Codex (`mcp_servers`) configs so either tool can query bridge state mid-conversation
- [x] AGENTS.md block instructs the model to call `claudex_get_context` when user references state it doesn't see
- [x] `claudex sync` — one-shot bulk ingest of every existing session
- [x] Cross-platform daemon autostart (Windows Startup `.vbs`, macOS LaunchAgent, Linux systemd-user)
- [x] Scrub pipeline strips Codex's `<environment_context>`, `<INSTRUCTIONS>`, `<user_instructions>`, `<app-context>` auto-injections + claudex's own markers — keeps the rolling window pure
- [x] Zero native deps (pure-JS JSONL store, no SQLite required)

---

## v0.2 — what's next

- [ ] **Synthetic resume files.** Translate a Claude session into a forged Codex `rollout-*.jsonl` (and vice versa), then exec `--resume <id>` so the receiving tool loads the full conversation as native history. No re-summarisation, no information loss.
- [ ] **Tool-call schema translation.** Map `tool_use`/`tool_result` blocks between Anthropic and OpenAI formats for the common tools (Read/Write/Edit/Bash). Anything provider-specific renders as a synthetic assistant message describing what happened.
- [ ] **Local LLM plan extractor.** Optional Ollama integration to replace the regex plan extractor with a proper summarisation pass. Falls back silently when Ollama isn't installed.
- [ ] **`claudex_search` MCP tool.** Full-text search across the canonical timeline so a session can recover specific old context, not just the rolling window.

## v0.3 — more tools

- [ ] Aider parser (`.aider.chat.history.md`)
- [ ] Cursor CLI parser
- [ ] Cline / Roo-Code parser (VS Code-side JSONL)
- [ ] Gemini CLI parser
- [ ] Goose parser
- [ ] Continue.dev parser
- [ ] OpenCode parser
- [ ] Q CLI / amazonq parser

## v0.4 — quality of life

- [ ] **Live dashboard.** Tiny local web UI at `localhost:7711` showing the merged timeline, switch button, search box.
- [ ] **Per-project budget overrides.** `.claudex/config.yml` in a project to set window size, exclusion globs, redaction rules.
- [ ] **Redaction rules.** Auto-redact API keys, env-style secrets, AWS keys before they land in `context.md`.
- [ ] **Watch mode for AGENTS.md.** If user edits the managed block, surface a friendly warning instead of overwriting silently.
- [ ] **Session search.** `claudex search "<query>"` across all turns. Either grep-based or fts5 if we drop in node:sqlite.
- [ ] **Conversation export.** `claudex export --since 2026-01-01 --project myapp --format markdown` for sharing or post-mortems.
- [ ] **Daemon autostart.** First-class Windows Task Scheduler / macOS launchd / systemd-user units, installed by `claudex init --autostart`.
- [ ] **Multi-machine sync.** Optional encrypted sync of `~/.claudex/mirror/` between dev machines via Syncthing / iCloud / Git.

## v0.5 — distribution

- [ ] **VS Code extension.** Embeds the dashboard in the side panel + adds a status-bar switch indicator.
- [ ] **JetBrains plugin.** Same surface, JetBrains side.
- [ ] **Homebrew / Scoop / winget formula.** One-line installs.

---

## Feature ideas from community research

Recurring themes from Reddit, GitHub issues, and Discord. Vote with thumbs-up on the corresponding GitHub issue (or open one) if you want any of these prioritised.

- **"Why doesn't Claude Code remember what Codex told me yesterday?"** — this is the headline problem claudex solves; we should evangelise the workflow.
- **Hitting the Claude rate limit mid-debug and losing the train of thought** — addressed by automatic AGENTS.md handoff to Codex.
- **Different tools, different working trees** — claudex should detect when two tools are mid-session on the same repo and warn about divergent state.
- **Subagent sessions** — Claude Code subagents and Codex `Einstein`/named agents each get their own rollout file. We should detect the parent and link them.
- **Hooks fighting hooks** — users with claude-mem + claudex + others want a single ordering. We should make our hook registration idempotent and document order.
- **Sensitive data leaking into context.md** — needs the redaction rules above.
- **Cross-OS sync** — devs with a Linux dev box + macOS laptop want a single context. v0.4 sync covers this.

If you found this README from a Reddit thread, the post you're probably remembering is in the issues section under the `community-feedback` label.

---

## How we decide priorities

- "How many people are blocked by this?" beats "How interesting is this?"
- Lossless > heuristic.
- Local > cloud.
- Boring > novel.
