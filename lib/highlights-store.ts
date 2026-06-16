/**
 * Per-doc persisted highlights — passages the user marked in the Reader. Kept
 * so highlights survive reloads, re-mark in the reader, and feed a global
 * "Highlights" page. Atomic write mirrors lib/tags-store.ts.
 */

import fs from "node:fs";
import { highlightsPath, ensureDocDir } from "./paths";

const VERSION = 1 as const;

export type Highlight = {
  id: string;
  text: string;
  pageIndex: number;
  createdAt: number;
};

export type PersistedHighlights = {
  v: typeof VERSION;
  docId: string;
  savedAt: number;
  highlights: Highlight[];
};

export function loadHighlights(docId: string): Highlight[] {
  try {
    const raw = fs.readFileSync(highlightsPath(docId), "utf-8");
    const parsed = JSON.parse(raw) as PersistedHighlights;
    if (parsed && parsed.v === VERSION && Array.isArray(parsed.highlights)) {
      return parsed.highlights;
    }
  } catch {
    /* none yet */
  }
  return [];
}

function save(docId: string, highlights: Highlight[]): void {
  ensureDocDir(docId);
  const file: PersistedHighlights = {
    v: VERSION,
    docId,
    savedAt: Date.now(),
    highlights,
  };
  const tmp = `${highlightsPath(docId)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, highlightsPath(docId));
}

export function addHighlight(docId: string, text: string, pageIndex: number): Highlight {
  const clean = text.trim().slice(0, 2000);
  const existing = loadHighlights(docId);
  // De-dupe exact repeats so re-highlighting the same passage is idempotent.
  const dup = existing.find((h) => h.text === clean);
  if (dup) return dup;
  const h: Highlight = {
    id: `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    text: clean,
    pageIndex: Number.isFinite(pageIndex) ? pageIndex : 0,
    createdAt: Date.now(),
  };
  save(docId, [...existing, h]);
  return h;
}

export function removeHighlight(docId: string, id: string): void {
  const existing = loadHighlights(docId);
  save(
    docId,
    existing.filter((h) => h.id !== id),
  );
}
