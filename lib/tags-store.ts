/**
 * Server-side persistence for the viewer's tag state.
 *
 * Previously the viewer state lived only in sessionStorage — fast, but
 * died with the tab and was invisible to the Library page. We now also
 * persist on the server so re-opening a doc from the Library restores
 * exactly the same tags / active selection / pages-analysed set the
 * user left behind.
 *
 * The shape is purposely the same as lib/persistence.ts so the client
 * can ship its state to disk without translation. v=1 is the current
 * schema; a future bump should follow the same dropped-old pattern.
 */

import fs from "node:fs";
import { ensureDocDir, tagsPath } from "./paths";
import type { DetectedConcept, VizSpec, VizType } from "./schemas";

export type PersistedTagServer = {
  id: string;
  page: number;
  endX: number;
  endY: number;
  fontHeight: number;
  type: VizType;
  label: string;
  ready: boolean;
  generating: boolean;
  concept: DetectedConcept;
  spec?: VizSpec;
  error?: string;
  attempts?: number;
  lastRuntimeError?: string;
};

export type PersistedTagsFile = {
  v: 1;
  docId: string;
  savedAt: number;
  tags: PersistedTagServer[];
  activeTagId: string | null;
  pagesAnalyzed: number[];
};

const VERSION = 1 as const;

export function loadTags(docId: string): PersistedTagsFile | null {
  try {
    const raw = fs.readFileSync(tagsPath(docId), "utf-8");
    const parsed = JSON.parse(raw) as PersistedTagsFile;
    if (parsed && parsed.v === VERSION) return parsed;
  } catch {
    /* file missing or malformed — start fresh */
  }
  return null;
}

export function saveTags(
  docId: string,
  payload: Omit<PersistedTagsFile, "v" | "docId" | "savedAt">,
): void {
  ensureDocDir(docId);
  const file: PersistedTagsFile = {
    v: VERSION,
    docId,
    savedAt: Date.now(),
    ...payload,
  };
  const tmp = `${tagsPath(docId)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, tagsPath(docId));
}
