/**
 * Tiny one-shot inter-tool prefill channel.
 *
 * When the user clicks "Chat about this concept" inside the knowledge graph,
 * we stash the {tool, topic} hint in sessionStorage. The destination tool
 * reads and clears it on mount, so the hint is single-use and tab-scoped.
 */

const KEY = (docId: string) => `getit:${docId}:tool-prefill`;
const TTL_MS = 30_000;

export type ToolPrefill = {
  tool: "chat" | "flashcards" | "quizzes" | "feynman";
  topic: string;
  ts: number;
};

export function consumePrefill(
  docId: string,
  expectedTool: ToolPrefill["tool"],
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ToolPrefill;
    if (parsed.tool !== expectedTool) return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      window.sessionStorage.removeItem(KEY(docId));
      return null;
    }
    window.sessionStorage.removeItem(KEY(docId));
    return parsed.topic;
  } catch {
    return null;
  }
}
