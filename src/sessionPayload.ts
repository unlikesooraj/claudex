import { getNativeSessionPayload } from "./nativeSessions.js";

export function getSessionsPayload(): unknown {
  return getNativeSessionPayload();
}
