import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Turn } from "./types.js";
import { projectSharedDir } from "./paths.js";
import { writeAgentsMd } from "./agentsWriteback.js";

const DEFAULT_BUDGET = 2000; // tokens, per user request.

export interface ContextBuildOptions {
  /** Rolling-window budget in tokens. Default 2000. */
  budget?: number;
  /** Include thinking traces. Default false (they bloat the window). */
  includeThinking?: boolean;
}

/**
 * Walk turns newest-first, packing into a budget. Returns the slice that fits,
 * in chronological (oldest-first) order.
 */
function isSignificant(t: Turn): boolean {
  // The rolling window only carries turns the next session can actually
  // continue from. Pure tool plumbing and empty assistant pre-tool turns
  // would otherwise eat the 2K budget without adding signal.
  if (t.text && t.text.trim().length > 0) return true;
  if (t.thinking && t.thinking.trim().length > 0) return true;
  return false;
}

export function packToBudget(turns: Turn[], budget = DEFAULT_BUDGET): Turn[] {
  const reversed = [...turns].reverse();
  const picked: Turn[] = [];
  let used = 0;
  for (const t of reversed) {
    if (!isSignificant(t)) continue;
    const cost = Math.max(1, t.tokens);
    if (used + cost > budget && picked.length > 0) break;
    picked.push(t);
    used += cost;
  }
  return picked.reverse();
}

/** Render packed turns as the human-readable context.md content. */
export function renderContextMd(turns: Turn[], cwd: string): string {
  const header = [
    `# claudex context`,
    ``,
    `> Project: \`${cwd}\``,
    `> Rolling window: last ${turns.length} turns`,
    `> Generated: ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
  ].join("\n");

  const body = turns
    .map((t) => {
      const who =
        t.role === "assistant"
          ? `**${t.source === "claude" ? "Claude" : "Codex"} (assistant)**`
          : t.role === "user"
            ? `**User**`
            : `**tool**`;
      const toolCallLines = (t.toolCalls ?? [])
        .map((c) => `  - tool: \`${c.name}\``)
        .join("\n");
      const blocks = [`${who} — ${t.ts}`];
      if (t.text) blocks.push(t.text.trim());
      if (toolCallLines) blocks.push(toolCallLines);
      return blocks.join("\n\n");
    })
    .join("\n\n---\n\n");

  return header + body + "\n";
}

const PLAN_PATTERNS = [
  /(?:^|\n)\s*(?:the\s+plan|here'?s\s+the\s+plan|next steps?|todo|next we'?ll|let'?s)\b[^\n]*/gi,
  /(?:^|\n)\s*\d+\.\s+[^\n]{3,200}/g, // numbered lists
  /(?:^|\n)\s*[-*]\s+\[ ?[ x]?\]\s+[^\n]+/g, // markdown checklists
];

/** Heuristic plan extractor — scans recent assistant turns for plan-like spans. */
export function extractPlan(turns: Turn[]): string {
  const recentAssistant = turns
    .filter((t) => t.role === "assistant" && t.text)
    .slice(-10);

  const found: string[] = [];
  for (const t of recentAssistant) {
    for (const re of PLAN_PATTERNS) {
      const matches = t.text.match(re);
      if (matches) {
        for (const m of matches) {
          const cleaned = m.trim();
          if (cleaned.length > 10 && !found.includes(cleaned)) {
            found.push(cleaned);
          }
        }
      }
    }
  }

  if (!found.length) return "_No active plan detected._\n";
  return found.slice(-20).join("\n") + "\n";
}

/** Best-effort recent-files extraction from tool-call inputs. */
export function extractRecentFiles(turns: Turn[]): string[] {
  const seen = new Set<string>();
  for (const t of [...turns].reverse()) {
    for (const c of t.toolCalls ?? []) {
      const input = c.input as Record<string, unknown> | undefined;
      const path =
        (input?.file_path as string | undefined) ??
        (input?.path as string | undefined) ??
        (input?.filename as string | undefined);
      if (typeof path === "string" && path.length < 400) {
        seen.add(path);
        if (seen.size >= 30) break;
      }
    }
    if (seen.size >= 30) break;
  }
  return [...seen];
}

export interface WriteContextResult {
  contextPath: string;
  planPath: string;
  filesPath: string;
  turnsUsed: number;
  tokensUsed: number;
  agentsWriteback?: { agentsPath: string; wrote: boolean; reason?: string };
}

/** Persist the rolling context bundle for a project. */
export function writeProjectContext(
  hash: string,
  cwd: string,
  turns: Turn[],
  opts: ContextBuildOptions = {},
): WriteContextResult {
  const dir = projectSharedDir(hash);
  mkdirSync(dir, { recursive: true });

  const budget = opts.budget ?? DEFAULT_BUDGET;
  const packed = packToBudget(turns, budget);
  const tokensUsed = packed.reduce((sum, t) => sum + Math.max(1, t.tokens), 0);

  const contextPath = join(dir, "context.md");
  const planPath = join(dir, "plan.md");
  const filesPath = join(dir, "recent-files.txt");

  const contextMd = renderContextMd(packed, cwd);
  const planMd = `# Active plan\n\n${extractPlan(turns)}`;

  writeFileSync(contextPath, contextMd, "utf8");
  writeFileSync(planPath, planMd, "utf8");
  writeFileSync(filesPath, extractRecentFiles(turns).join("\n") + "\n", "utf8");

  // Also push a managed block into the project's own AGENTS.md so Codex
  // auto-loads it on the next `codex` invocation in that directory.
  const wb = writeAgentsMd(cwd, contextMd, planMd);

  return {
    contextPath,
    planPath,
    filesPath,
    turnsUsed: packed.length,
    tokensUsed,
    agentsWriteback: { agentsPath: wb.agentsPath, wrote: wb.wrote, reason: wb.reason },
  };
}
