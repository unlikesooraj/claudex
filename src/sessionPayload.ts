import { CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR } from "./paths.js";
import { scanAllSessions, summarizeAvailability } from "./sessionIndex.js";

export function getSessionsPayload(): unknown {
  const sessions = scanAllSessions();
  const availability = summarizeAvailability(sessions);
  return {
    generatedAt: new Date().toISOString(),
    roots: {
      claude: CLAUDE_PROJECTS_DIR,
      codex: CODEX_SESSIONS_DIR,
    },
    counts: {
      total: sessions.length,
      claude: sessions.filter((s) => s.source === "claude").length,
      codex: sessions.filter((s) => s.source === "codex").length,
      active: sessions.filter((s) => s.activityState === "active").length,
    },
    availability,
    sessions,
  };
}
