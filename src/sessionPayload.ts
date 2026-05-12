import { getNativeSessionPayload } from "./nativeSessions.js";
import { ensureDaemonRunning } from "./daemonSupervisor.js";

export function getSessionsPayload(): unknown {
  ensureDaemonRunning();
  return getNativeSessionPayload();
}
