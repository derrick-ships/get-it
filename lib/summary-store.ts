/**
 * Per-doc cache for the Reader's AI document summary (the "Summarized by
 * Ghostreader" card). Generated once when a provider is connected and cached so
 * reopening a doc is instant. Atomic write mirrors lib/tags-store.ts.
 */

import fs from "node:fs";
import { summaryPath, ensureDocDir } from "./paths";

const VERSION = 1 as const;

export type PersistedSummary = {
  v: typeof VERSION;
  docId: string;
  savedAt: number;
  summary: string;
};

export function loadSummary(docId: string): PersistedSummary | null {
  try {
    const raw = fs.readFileSync(summaryPath(docId), "utf-8");
    const parsed = JSON.parse(raw) as PersistedSummary;
    if (parsed && parsed.v === VERSION && typeof parsed.summary === "string") {
      return parsed;
    }
  } catch {
    /* file missing or malformed — treat as no summary yet */
  }
  return null;
}

export function saveSummary(docId: string, summary: string): PersistedSummary {
  ensureDocDir(docId);
  const file: PersistedSummary = {
    v: VERSION,
    docId,
    savedAt: Date.now(),
    summary,
  };
  const tmp = `${summaryPath(docId)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, summaryPath(docId));
  return file;
}
