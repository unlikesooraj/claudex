#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CLAUDEX_HOME,
  CLAUDE_SETTINGS,
  CODEX_CONFIG,
  DAEMON_LOG,
  DAEMON_PID,
  CLAUDE_PROJECTS_DIR,
  CODEX_SESSIONS_DIR,
  projectSharedDir,
} from "./paths.js";
import { projectKeyFromCwd } from "./projectKey.js";
import { getSessionState, listSessions, recentTurnsForProject } from "./store.js";
import { writeProjectContext } from "./contextBuilder.js";
import { syncAll } from "./discover.js";
import { installAutostart, uninstallAutostart } from "./autostart.js";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

const program = new Command();
program
  .name("claudex")
  .description("Seamless session bridge between Claude Code and Codex CLI.")
  .version("0.1.0");

program
  .command("init")
  .description("Install hooks, bulk-ingest existing sessions, and start the daemon.")
  .option("--no-daemon", "Skip starting the background daemon.")
  .option("--no-sync", "Skip initial bulk ingest of historical sessions.")
  .option("--no-hooks", "Skip patching Claude settings.json / Codex config.toml.")
  .option("--no-autostart", "Skip registering the daemon to run on user login.")
  .action(async (opts) => {
    mkdirSync(CLAUDEX_HOME, { recursive: true });
    if (opts.hooks !== false) {
      patchClaudeSettings();
      patchCodexConfig();
    }
    if (opts.autostart !== false) {
      const daemonScript = join(PKG_ROOT, "dist", "daemon.js");
      const res = installAutostart(daemonScript);
      if (res.ok) console.log(`autostart registered: ${res.path}`);
      else console.log(`autostart skipped: ${res.reason}`);
    }
    if (opts.sync !== false) {
      console.log("\nScanning Claude + Codex history (one-time)...");
      const report = syncAll({ verbose: true });
      console.log(
        `Ingested ${report.turnsIngested} turns across ${report.projects.length} projects from ${report.filesScanned} files.`,
      );
      for (const p of report.projects.slice(0, 10)) {
        console.log(`  ${String(p.turns).padStart(5)}  ${p.cwd}`);
      }
      if (report.projects.length > 10) {
        console.log(`  ... and ${report.projects.length - 10} more.`);
      }
    }
    if (opts.daemon !== false) {
      spawnDaemon();
    }
    console.log(`\nclaudex ready. State dir: ${CLAUDEX_HOME}`);
    console.log(`Daemon log:               ${DAEMON_LOG}`);
    console.log(`\nNext: open any project in Claude Code or Codex.`);
    console.log(`Context from the other tool will be loaded automatically.\n`);
  });

program
  .command("sync")
  .description("Scan and ingest every existing Claude + Codex session (idempotent).")
  .action(() => {
    const report = syncAll({ verbose: true });
    console.log(`\nIngested ${report.turnsIngested} new turns from ${report.filesScanned} files.`);
    console.log(`Projects tracked: ${report.projects.length}`);
    for (const p of report.projects.slice(0, 20)) {
      console.log(`  ${String(p.turns).padStart(5)}  ${p.cwd}`);
    }
  });

program
  .command("projects")
  .description("List every project the bridge knows about.")
  .action(() => {
    const rows = listSessions(500);
    if (!rows.length) {
      console.log("No projects yet — run `claudex sync` to ingest existing history.");
      return;
    }
    for (const r of rows) {
      console.log(`  [${r.lastSource.padEnd(6)}] ${r.lastTs}  ${r.cwd}`);
    }
  });

program
  .command("status")
  .description("Show daemon status and known projects.")
  .action(() => {
    const running = isDaemonRunning();
    console.log(`Daemon:       ${running ? "running (pid " + readPid() + ")" : "stopped"}`);
    console.log(`State dir:    ${CLAUDEX_HOME}`);
    console.log(`Claude dir:   ${CLAUDE_PROJECTS_DIR}`);
    console.log(`Codex dir:    ${CODEX_SESSIONS_DIR}`);
    const rows = listSessions(20);
    if (rows.length === 0) {
      console.log("\nNo projects tracked yet.");
      return;
    }
    console.log("\nRecent projects:");
    for (const r of rows) {
      console.log(`  ${r.lastSource.padEnd(7)} ${r.lastTs}  ${r.cwd}`);
    }
  });

program
  .command("context")
  .description("Print the current rolling-window context for the cwd (or --cwd).")
  .option("-d, --cwd <path>", "Project directory to query.", process.cwd())
  .action((opts) => {
    const key = projectKeyFromCwd(opts.cwd);
    const path = join(projectSharedDir(key.hash), "context.md");
    if (!existsSync(path)) {
      console.log(`No context for ${opts.cwd}\n(hash: ${key.hash})`);
      process.exit(1);
    }
    process.stdout.write(readFileSync(path, "utf8"));
  });

program
  .command("rebuild")
  .description("Force a rebuild of the rolling context for the cwd.")
  .option("-d, --cwd <path>", "Project directory.", process.cwd())
  .option("-b, --budget <n>", "Token budget for the rolling window.", "2000")
  .action((opts) => {
    const key = projectKeyFromCwd(opts.cwd);
    const turns = recentTurnsForProject(key.hash, 400);
    if (!turns.length) {
      console.log(`No turns recorded for ${opts.cwd} (hash ${key.hash}).`);
      return;
    }
    const result = writeProjectContext(key.hash, opts.cwd, turns, {
      budget: Number(opts.budget),
    });
    console.log(`Rebuilt: ${result.turnsUsed} turns, ${result.tokensUsed} tokens`);
    console.log(`  ${result.contextPath}`);
  });

program
  .command("log")
  .description("Tail the daemon log.")
  .option("-n <lines>", "Show last N lines.", "60")
  .action((opts) => {
    if (!existsSync(DAEMON_LOG)) {
      console.log("No daemon log yet.");
      return;
    }
    const lines = readFileSync(DAEMON_LOG, "utf8").trim().split("\n");
    const n = Number(opts.n ?? 60);
    process.stdout.write(lines.slice(-n).join("\n") + "\n");
  });

program
  .command("daemon")
  .description("Run the daemon in the foreground (mostly for debugging).")
  .action(async () => {
    const { startDaemon } = await import("./daemon.js");
    await startDaemon();
  });

program
  .command("autostart <action>")
  .description("Manage daemon autostart on login. Actions: enable | disable | status")
  .action((action: string) => {
    const daemonScript = join(PKG_ROOT, "dist", "daemon.js");
    if (action === "enable") {
      const res = installAutostart(daemonScript);
      console.log(res.ok ? `enabled: ${res.path}` : `failed: ${res.reason}`);
    } else if (action === "disable") {
      const res = uninstallAutostart();
      console.log(res.ok ? `disabled: ${res.path}` : `failed: ${res.reason}`);
    } else if (action === "status") {
      // delegate: just attempt enable-as-noop check via the OS-specific path.
      // Simpler: just say where it would be.
      const os = process.platform;
      console.log(`platform: ${os}`);
      console.log(`(use \`enable\` or \`disable\`; install path printed there)`);
    } else {
      console.log(`unknown action: ${action}. Use: enable | disable | status`);
    }
  });

program.parse(process.argv);

// ----------------- helpers -----------------

function readPid(): number | null {
  if (!existsSync(DAEMON_PID)) return null;
  const pid = Number(readFileSync(DAEMON_PID, "utf8").trim());
  return Number.isFinite(pid) ? pid : null;
}

function isDaemonRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnDaemon(): void {
  if (isDaemonRunning()) {
    console.log("Daemon already running.");
    return;
  }
  const entry = join(PKG_ROOT, "dist", "daemon.js");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  console.log(`Daemon spawned (pid ${child.pid}).`);
}

function patchClaudeSettings(): void {
  mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true });
  const cfg: any = existsSync(CLAUDE_SETTINGS)
    ? JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8"))
    : {};
  cfg.hooks ??= {};
  cfg.hooks.SessionStart ??= [];
  cfg.hooks.Stop ??= [];
  cfg.hooks.UserPromptSubmit ??= [];

  const sessionStartCmd = `node "${join(PKG_ROOT, "hooks", "claude-session-start.js")}"`;
  const stopCmd = `node "${join(PKG_ROOT, "hooks", "claude-stop.js")}"`;
  const promptCmd = `node "${join(PKG_ROOT, "hooks", "claude-user-prompt-submit.js")}"`;

  const hasClaudexHook = (arr: any[]) =>
    arr.some((h) => JSON.stringify(h).includes("claudex"));

  if (!hasClaudexHook(cfg.hooks.SessionStart)) {
    cfg.hooks.SessionStart.push({
      matcher: "startup|resume",
      hooks: [{ type: "command", command: sessionStartCmd }],
    });
  }
  if (!hasClaudexHook(cfg.hooks.Stop)) {
    cfg.hooks.Stop.push({
      hooks: [{ type: "command", command: stopCmd }],
    });
  }
  if (!hasClaudexHook(cfg.hooks.UserPromptSubmit)) {
    cfg.hooks.UserPromptSubmit.push({
      hooks: [{ type: "command", command: promptCmd }],
    });
  }

  // Also register the MCP server so Claude can query bridge state on demand.
  cfg.mcpServers ??= {};
  if (!cfg.mcpServers.claudex) {
    cfg.mcpServers.claudex = {
      command: process.execPath,
      args: [join(PKG_ROOT, "dist", "mcp.js")],
    };
  }

  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2), "utf8");
  console.log(`patched ${CLAUDE_SETTINGS}`);
}

function patchCodexConfig(): void {
  mkdirSync(dirname(CODEX_CONFIG), { recursive: true });
  const existing = existsSync(CODEX_CONFIG) ? readFileSync(CODEX_CONFIG, "utf8") : "";
  let parsed: Record<string, any> = {};
  try {
    parsed = existing ? (parseToml(existing) as Record<string, any>) : {};
  } catch (e) {
    console.warn(`could not parse existing ${CODEX_CONFIG}; leaving it alone.`);
    return;
  }
  let touched = false;

  // notify hook
  const notifyCmd = [process.execPath, join(PKG_ROOT, "hooks", "codex-notify.js")];
  if (!Array.isArray(parsed.notify) || !JSON.stringify(parsed.notify).includes("claudex")) {
    parsed.notify = notifyCmd;
    touched = true;
  }

  // MCP server — lets Codex call claudex_get_context mid-conversation when
  // the user references state the session-start AGENTS.md didn't have.
  parsed.mcp_servers ??= {};
  if (!parsed.mcp_servers.claudex) {
    parsed.mcp_servers.claudex = {
      command: process.execPath,
      args: [join(PKG_ROOT, "dist", "mcp.js")],
    };
    touched = true;
  }

  if (!touched) {
    console.log(`${CODEX_CONFIG} already configured.`);
    return;
  }
  writeFileSync(CODEX_CONFIG, stringifyToml(parsed), "utf8");
  console.log(`patched ${CODEX_CONFIG}`);
}
