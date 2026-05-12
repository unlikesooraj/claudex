import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { projectKeyFromCwd } from "./projectKey.js";
import { projectSharedDir } from "./paths.js";
import { recentTurnsForProject } from "./store.js";
import { writeProjectContext, type WriteContextResult } from "./contextBuilder.js";
import type { OpenAppSession } from "./nativeSessions.js";
import type { SessionSource } from "./sessionIndex.js";

export interface HandoffResult {
  ok: boolean;
  prompt?: string;
  handoffPath?: string;
  projectHandoffPath?: string;
  context?: WriteContextResult;
  reason?: string;
}

function appName(source: SessionSource): string {
  return source === "claude" ? "Claude" : "Codex";
}

function titleFor(session: OpenAppSession): string {
  return session.title || basename(session.cwd) || session.sessionId;
}

function isSafeHandoffTarget(cwd: string): boolean {
  try {
    const resolved = resolve(cwd);
    if (resolved === resolve(homedir())) return false;
    if (resolved === parse(resolved).root) return false;
    return true;
  } catch {
    return false;
  }
}

function renderHandoffMarkdown(
  session: OpenAppSession,
  target: SessionSource,
  createdAt: string,
): string {
  return [
    "# Claudex handoff",
    "",
    `Created: ${createdAt}`,
    `From: ${appName(session.source)} (${session.sessionId})`,
    `To: ${appName(target)}`,
    `Folder: ${session.cwd}`,
    `Chat: ${titleFor(session)}`,
    "",
    "Continue from the latest shared context in this folder. Prefer the project AGENTS.md and .claudex/context.md files when reconstructing state.",
    "",
  ].join("\n");
}

export function prepareCrossToolHandoff(
  session: OpenAppSession,
  target: SessionSource,
): HandoffResult {
  if (!session.cwd || !session.cwdExists || !existsSync(session.cwd)) {
    return { ok: false, reason: "folder unavailable" };
  }
  if (!isSafeHandoffTarget(session.cwd)) {
    return { ok: false, reason: "unsafe folder" };
  }

  const createdAt = new Date().toISOString();
  const key = projectKeyFromCwd(session.cwd);
  const turns = recentTurnsForProject(key.hash, 500);
  const context = turns.length ? writeProjectContext(key.hash, session.cwd, turns) : undefined;
  const sharedDir = projectSharedDir(key.hash);
  const projectDir = join(session.cwd, ".claudex");
  mkdirSync(sharedDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  const markdown = renderHandoffMarkdown(session, target, createdAt);
  const handoffPath = join(sharedDir, "handoff.md");
  const projectHandoffPath = join(projectDir, "handoff.md");
  writeFileSync(handoffPath, markdown, "utf8");
  writeFileSync(projectHandoffPath, markdown, "utf8");
  writeFileSync(
    join(sharedDir, "handoff.json"),
    JSON.stringify(
      {
        createdAt,
        source: session.source,
        target,
        title: titleFor(session),
        cwd: session.cwd,
        projectHash: key.hash,
        sessionId: session.sessionId,
        cliSessionId: session.cliSessionId,
        launch: session.launch,
        contextPath: context?.contextPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  const prompt = [
    `Continue the Claudex handoff from ${appName(session.source)}: "${titleFor(session)}".`,
    "Use the attached folder context, AGENTS.md, and .claudex/handoff.md so the user does not have to restate the work.",
  ].join(" ");

  return { ok: true, prompt, handoffPath, projectHandoffPath, context };
}
