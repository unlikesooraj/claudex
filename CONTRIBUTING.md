# Contributing to Claudex

Thank you for considering a contribution. Claudex exists because too many of us pay for both **Claude Code** and **Codex CLI** and waste those subscriptions on context shuffling every time we switch tools or hit a rate limit. Every contribution — a new parser for another agentic CLI, a bug fix, a doc improvement, even a session JSONL fixture — makes the seamless cross-tool experience available to more developers. Welcome.

## Ways to help

| Effort | What you can do |
|---|---|
| 5 min | Open an issue describing a tool you'd like supported (Aider, Cursor CLI, Cline, Continue.dev, Gemini CLI, Goose, etc.) |
| 30 min | Drop a real session JSONL fixture into `test/fixtures/` so we can regression-test parsers |
| 1 hr | Write a parser for another agentic CLI under `src/parsers/<tool>.ts` |
| 1 day | Implement v0.2 synthetic resume forgery for either Claude or Codex |
| 1 weekend | Build a local Ollama-powered plan extractor (see ROADMAP) |

## Dev setup

```bash
git clone https://github.com/unlikesooraj/claudex
cd claudex
npm install
npm run build
npm link            # makes the `claudex` binary available globally for testing
```

Run the daemon in the foreground so you can see ingestion live:

```bash
claudex daemon
```

In another terminal, open Claude Code or Codex in any project. You should see new turns logged.

## Adding a parser for a new agent CLI

1. Create `src/parsers/<tool>.ts` exporting a `parse<Tool>Line(line, state?)` function that returns a `Turn | null`.
2. Add a glob to `src/daemon.ts` for the tool's transcript directory.
3. Drop a real (redacted) session fixture into `test/fixtures/<tool>/`.
4. Open a PR titled `parser: <tool>`.

## Coding standards

- Pure TypeScript, ESM, Node 20+.
- No native deps. The whole point of the JSONL store is that `npm install` never needs a C++ toolchain.
- Be conservative about writing files inside user project directories — always go through `isSafeWriteTarget` and managed `<!-- claudex:start -->` markers.

## Reporting bugs

Please include:
- OS + Node version
- A redacted line from a session that confused the parser
- Output of `claudex log -n 200`

## Code of conduct

Be excellent to each other.
