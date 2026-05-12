/**
 * Server-side persistence for the work context.
 *
 * Pure types live in lib/work-context-types.ts so client components can
 * import them without pulling node:fs into the browser bundle.
 *
 * One file per docId at <DATA_DIR>/docs/<docId>/workctx.json (see lib/paths.ts).
 * Tools append to it; the evaluator never mutates it. Append-only by
 * convention.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureDocDir, workCtxPath } from "./paths";
import type { WorkContext } from "./work-context-types";

export type {
  ChatMessage,
  ChatThread,
  Flashcard,
  FlashcardSession,
  FeynmanTurn,
  FeynmanSession,
  WorkContext,
} from "./work-context-types";

export function loadWorkContext(docId: string): WorkContext {
  try {
    const raw = fs.readFileSync(workCtxPath(docId), "utf-8");
    const parsed = JSON.parse(raw) as WorkContext;
    if (parsed && parsed.v === 1) return parsed;
  } catch {
    /* file missing or malformed — start fresh */
  }
  return { v: 1, docId, chats: [], flashcards: [], feynman: [] };
}

export function saveWorkContext(ctx: WorkContext): void {
  ensureDocDir(ctx.docId);
  fs.writeFileSync(workCtxPath(ctx.docId), JSON.stringify(ctx, null, 2));
}

export function newId(): string {
  return randomUUID();
}

/**
 * Compact, evaluator-friendly summary of the work context. We strip
 * boilerplate (role labels become inline prefixes) and trim long messages
 * so the prompt stays under model limits even after months of use. The
 * full file is still on disk for inspection.
 */
export function summariseForEvaluator(ctx: WorkContext): string {
  const lines: string[] = [];

  if (ctx.chats.length) {
    lines.push("# CHATS");
    for (const c of ctx.chats) {
      lines.push(`\n## chat "${c.title}" (id=${c.id}, ${c.messages.length} msgs)`);
      for (const m of c.messages) {
        const ts = new Date(m.ts).toISOString();
        const text = m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content;
        lines.push(`- [${ts}] ${m.role}: ${text}`);
      }
    }
  }

  if (ctx.flashcards.length) {
    lines.push("\n# FLASHCARDS");
    for (const s of ctx.flashcards) {
      const status = s.endedAt ? "ended" : "in-progress";
      lines.push(`\n## deck "${s.topic}" (id=${s.id}, ${status}, ${s.cards.length} cards)`);
      for (const card of s.cards) {
        const r = card.rating ?? "—";
        const ua = card.userAnswer ? ` user="${card.userAnswer.slice(0, 200)}"` : "";
        lines.push(`- Q: ${card.q.slice(0, 200)} | A: ${card.a.slice(0, 200)} | rating=${r}${ua}`);
      }
    }
  }

  if (ctx.feynman.length) {
    lines.push("\n# FEYNMAN");
    for (const s of ctx.feynman) {
      const status = s.endedAt ? "ended" : "in-progress";
      lines.push(`\n## feynman "${s.topic}" (id=${s.id}, ${status})`);
      for (const t of s.turns) {
        lines.push(`- child: ${t.childPrompt.slice(0, 240)}`);
        lines.push(`  user: ${t.userExplanation.slice(0, 600)}`);
      }
      if (s.summary) lines.push(`  summary: ${s.summary.slice(0, 400)}`);
    }
  }

  if (!lines.length) return "(no interactions yet)";
  return lines.join("\n");
}
