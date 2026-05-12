import { getEncoding } from "js-tiktoken";

// cl100k_base is the canonical encoding for cross-provider counts.
// Off by ~5% for Anthropic models but stable and offline.
const enc = getEncoding("cl100k_base");

export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return enc.encode(text).length;
  } catch {
    // Fallback: 4 chars/token heuristic.
    return Math.ceil(text.length / 4);
  }
}
