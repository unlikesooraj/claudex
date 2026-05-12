import { getNativeSessionPayload } from "./nativeSessions.js";
import { ensureDaemonRunning } from "./daemonSupervisor.js";

let cachedPayload: unknown;
let cachedAt = 0;
let daemonCheckedAt = 0;

export function getSessionsPayload(): unknown {
  const now = Date.now();
  if (now - daemonCheckedAt > 2_000) {
    ensureDaemonRunning();
    daemonCheckedAt = now;
  }
  if (cachedPayload && now - cachedAt < 3_000) return cachedPayload;
  cachedPayload = getNativeSessionPayload();
  cachedAt = Date.now();
  return cachedPayload;
}
