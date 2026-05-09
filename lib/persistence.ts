/**
 * Tab-scoped persistence for the viewer state.
 *
 * Backed by `sessionStorage` so the state survives:
 *   - F5 / browser refresh
 *   - Next.js Fast-Refresh / HMR
 *   - Browser navigation back to the viewer
 * but is naturally wiped when the tab closes (sessionStorage semantics).
 *
 * What we persist per docId:
 *   - the full TagState[] (positions, type, label, spec, error, generating flag)
 *   - the activeTagId (so the right pane keeps showing the same viz)
 *   - the set of pages whose detection has finished (so we don't re-detect)
 *
 * What we do NOT persist:
 *   - in-flight network requests — those die on reload; the orchestrator
 *     re-fires them based on the persisted `generating: true` flag.
 *   - "currently analyzing" page set — derived; the orchestrator re-runs
 *     detection for any page not in pagesAnalyzed.
 */

import type { DetectedConcept, VizSpec, VizType } from "@/lib/schemas";

export type PersistedTag = {
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
};

export type PersistedDocState = {
  v: 1;
  savedAt: number;
  tags: PersistedTag[];
  activeTagId: string | null;
  pagesAnalyzed: number[];
};

const VERSION = 1 as const;
const STORAGE_KEY = (docId: string) => `braynr:viewer:${docId}`;

export function loadDocState(docId: string): PersistedDocState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDocState;
    if (parsed.v !== VERSION) {
      // Schema version bumped → drop the old state.
      window.sessionStorage.removeItem(STORAGE_KEY(docId));
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn("braynr persistence: failed to load", e);
    return null;
  }
}

export function saveDocState(
  docId: string,
  state: Omit<PersistedDocState, "v" | "savedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const full: PersistedDocState = {
      v: VERSION,
      savedAt: Date.now(),
      ...state,
    };
    window.sessionStorage.setItem(STORAGE_KEY(docId), JSON.stringify(full));
  } catch (e) {
    // Quota exceeded or storage disabled — degrade gracefully.
    console.warn("braynr persistence: failed to save", e);
  }
}

export function clearDocState(docId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY(docId));
  } catch {
    /* noop */
  }
}
