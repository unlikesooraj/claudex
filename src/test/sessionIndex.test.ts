import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanAllSessions, summarizeAvailability } from "../sessionIndex.js";

test("scanAllSessions summarizes Claude and Codex sessions with usage", (t) => {
  const root = mkdtempSync(join(tmpdir(), "claudex-session-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const project = join(root, "project");
  mkdirSync(project, { recursive: true });

  const claudeDir = join(root, "claude", "projects", "C--tmp-project");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "claude-session.jsonl"),
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-12T01:00:00.000Z",
        sessionId: "claude-session",
        cwd: project,
        message: { role: "user", content: "fix the bridge" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-05-12T01:01:00.000Z",
        sessionId: "claude-session",
        cwd: project,
        message: {
          role: "assistant",
          model: "claude-opus",
          content: [{ type: "text", text: "done" }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 40,
          },
        },
      }),
    ].join("\n") + "\n",
  );

  const codexDir = join(root, "codex", "sessions", "2026", "05", "12");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, "rollout.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-05-12T02:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: project,
          cli_version: "0.1.0",
          model_provider: "openai",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-12T02:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            plan_type: "pro",
            primary: { used_percent: 27, window_minutes: 300, resets_at: 1778583191 },
            secondary: { used_percent: 3, window_minutes: 10080, resets_at: 1779169991 },
            rate_limit_reached_type: null,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-12T02:02:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "continue" }],
        },
      }),
    ].join("\n") + "\n",
  );

  const sessions = scanAllSessions({ claudeDir: join(root, "claude", "projects"), codexDir: join(root, "codex", "sessions") });
  assert.equal(sessions.length, 2);

  const codex = sessions.find((s) => s.source === "codex");
  assert.ok(codex);
  assert.equal(codex.usage.state, "available");
  assert.equal(codex.usage.primary?.remainingPercent, 73);

  const claude = sessions.find((s) => s.source === "claude");
  assert.ok(claude);
  assert.equal(claude.usage.remainingExposed, false);
  assert.equal(claude.usage.totalTokens, 155);

  const availability = summarizeAvailability(sessions);
  assert.equal(availability.best?.source, "codex");
});
