# Claudex FAQ

Long-form answers to the questions people search for when they discover Claudex.

---

## How do I connect Claude Code with Codex CLI?

Install Claudex with `npm install -g claudex && claudex init`. That single command:

1. Patches `~/.claude/settings.json` to add the bridge hooks (`SessionStart`, `UserPromptSubmit`, `Stop`) and register Claudex as an MCP server.
2. Patches `~/.codex/config.toml` similarly (notify hook + MCP server registration).
3. Bulk-ingests every existing session from both tools (typically thousands of turns across dozens of projects in under 30 seconds).
4. Registers the bridge daemon to autostart on user login (Windows Startup `.vbs` / macOS LaunchAgent / Linux systemd-user).

After that, you never have to think about it. Open any project in Claude Code or Codex CLI — the bridge runs in the background, watches both tools' transcript files, and injects context where it's needed.

---

## What happens when Claude Code hits the session rate limit?

You quit Claude Code, open Codex CLI in the same folder, and start typing. Codex auto-loads the project's `AGENTS.md` which Claudex has populated with the last ~2,000 tokens of conversation from BOTH tools, chronologically interleaved. The new Codex session starts already caught up — no re-explanation, no re-summarisation, no paste.

If you stay in Codex for a while and then go back to Claude Code, the same flow runs in reverse. Claude Code's `SessionStart` hook reads the rolling context, and `UserPromptSubmit` keeps it fresh on every prompt you send.

---

## How does Claudex differ from `claude-mem`?

[`claude-mem`](https://github.com/thedotmack/claude-mem) is a memory plugin that compresses past sessions with AI and re-injects them into future sessions of the same tool (or across a few supported tools). It's a great per-agent memory layer.

Claudex is purpose-built for the **Claude Code ↔ Codex CLI handoff**. The differences:

| Aspect | claude-mem | Claudex |
|---|---|---|
| Goal | Persistent memory for one agent | Real-time cross-tool context bridge |
| Compression | AI-summarised | Verbatim within rolling window |
| Storage | Compressed snapshots | Canonical JSONL timeline + rolling markdown |
| Cross-tool | Yes (best-effort, plugin-based) | Yes (purpose-built, lossless within window) |
| MCP server | No (uses observer plugin) | Yes (`claudex_get_context` etc.) |
| Mid-session refresh | No | Yes — Claude `UserPromptSubmit` + MCP for Codex |

The two are complementary. You can run both.

---

## How does Claudex differ from `hydra`?

[`hydra`](https://github.com/saadnvd1/hydra) is a unified wrapper that launches Claude Code, Codex, OpenCode, etc. as managed child processes and switches between them automatically when one hits a rate limit. It's a smart launcher.

Claudex doesn't launch anything. It runs *passively in the background* and ensures whatever tool you happen to open already has the context from whatever tool you used last. **The two work great together** — let hydra decide *when* to switch, let Claudex make the switch lossless.

---

## Does Claudex use my Anthropic or OpenAI API keys?

No. Claudex never makes API calls. It only reads transcript files that Claude Code and Codex CLI already write to disk locally:

- `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`

It then writes derived files (rolling context, plan, recent-files) into `~/.claudex/` and into a managed block in each project's `AGENTS.md`. Your existing Claude Code and Codex CLI subscriptions handle all model traffic. Claudex doesn't see a single token from either provider.

---

## Will Claudex overwrite my existing `AGENTS.md` or `CLAUDE.md`?

No. Claudex never touches anything outside its managed block:

```markdown
<!-- claudex:start -->
... auto-managed context ...
<!-- claudex:end -->
```

If `AGENTS.md` already exists with your own content, Claudex appends or refreshes its block. Everything outside the markers is preserved verbatim. If the project has no `AGENTS.md`, Claudex creates one with only the managed block.

You can delete the managed block any time and Claudex will simply re-create it on the next ingest. You can edit content inside the block and Claudex will overwrite it on the next refresh.

---

## How does Claudex match projects between Claude Code and Codex CLI?

By the **working directory you opened the tool in**. Both Claude Code and Codex CLI encode the cwd into their transcript file paths. Claudex normalises the cwd (lowercase, forward-slash, trailing-slash-stripped), hashes it with SHA-256, and uses the first 16 hex chars as the project key.

This means as long as you open both tools in the same folder, their conversations merge automatically. No project naming, no per-project setup, no manifest file.

---

## Can I use Claudex with Aider, Cursor CLI, Cline, Gemini CLI, Continue.dev, or other agentic CLIs?

Not in v0.1 — but adding any of these is roughly an hour of work and a great first contribution. The recipe:

1. Create `src/parsers/<tool>.ts` exporting a `parse<Tool>Line(line, state?)` function that returns a canonical `Turn`.
2. Register the tool's transcript directory in `src/daemon.ts`.
3. Drop a redacted real-session fixture into `test/fixtures/<tool>/`.
4. Open a PR.

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Is the rolling context window actually lossless?

**Within the 2,000-token window** — yes, exact user and assistant text, in chronological order, interleaved between Claude Code and Codex CLI turns. Tool calls are summarised inline in v0.1.

**Outside the window** — older turns live in `~/.claudex/mirror/<hash>/timeline.jsonl` and can be queried via the MCP server tools (`claudex_get_context`, `claudex_get_plan`, `claudex_recent_files`). v0.2 will add a `claudex_search` tool for full-text recall.

**Truly lossless cross-tool handoff** — i.e., the receiving tool sees the full conversation as if it had run the whole thing — is the headline feature of v0.2. It works by translating one tool's session JSONL into the other tool's native format and using `--resume` to load it. The schemas are already mapped; see [ROADMAP.md](ROADMAP.md).

---

## What does Claudex store on my machine?

Three locations:

| Path | What's there |
|---|---|
| `~/.claudex/mirror/<hash>/timeline.jsonl` | Canonical, append-only log of every turn from both tools, per project. |
| `~/.claudex/shared/<hash>/{context,plan,recent-files}.md` | Rolling 2K-token context + extracted plan + recent files, per project. |
| `<project>/.claudex/context.md` + `<project>/AGENTS.md` (managed block) | The version each project's tools actually load. |

Plus daemon state under `~/.claudex/`: `daemon.pid`, `daemon.log`, `session-state.json`, `inject-state/<session-id>.json` (UserPromptSubmit mtime cache).

---

## Does Claudex respect privacy?

Yes. Everything is local. No network calls. No telemetry. No analytics. Read the source — it's ~1,500 lines of TypeScript.

Sensitive-data redaction (auto-strip API keys, AWS keys, env-style secrets before they enter `context.md`) is on the [roadmap](ROADMAP.md) for v0.4. For now, treat `~/.claudex/` and your project-local `AGENTS.md` files as you would treat your shell history.

---

## Does Claudex work cross-machine?

v0.1 is single-machine only. Encrypted cross-machine sync via Syncthing / iCloud / Git is on the roadmap (v0.4). The state under `~/.claudex/mirror/` is pure JSONL and entirely trivial to sync today if you want to roll your own.

---

## Why "Claudex"?

Portmanteau of **Claude** + **Codex**. The two tools the bridge connects. We'll keep the name even when we add parsers for Aider, Cursor, Cline, Gemini and others — the cross-tool sync is the same idea.

---

## How do I uninstall Claudex?

```bash
claudex autostart disable          # remove the autostart entry
# kill the running daemon
node -e "require('fs').readFileSync(process.env.USERPROFILE + '/.claudex/daemon.pid','utf8') && process.kill(...)"
npm uninstall -g claudex
rm -rf ~/.claudex                  # remove all state (optional)
```

Then either delete the managed `<!-- claudex:start -->` blocks from any `AGENTS.md` files Claudex touched, or just leave them — they're inert without the daemon.

To revert Claude Code and Codex CLI configs to their pre-Claudex state, delete the Claudex-related entries from `~/.claude/settings.json` (hooks + `mcpServers.claudex`) and `~/.codex/config.toml` (notify + `mcp_servers.claudex`).

---

## Where do I report bugs or request features?

- Bugs: [open an issue with the bug template](https://github.com/unlikesooraj/claudex/issues/new?template=bug.md)
- Feature requests: [open an issue with the feature template](https://github.com/unlikesooraj/claudex/issues/new?template=feature.md)
- Discussion / show-and-tell: [GitHub Discussions](https://github.com/unlikesooraj/claudex/discussions)

If you found this through a Reddit / HN / Twitter thread, the source thread is tagged in the discussions section under `community-feedback`.
