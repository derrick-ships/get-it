/**
 * Two-tier persistence for the viewer state.
 *
 * Tier 1 — sessionStorage (fast, tab-scoped):
 *   Survives F5, HMR, and SPA navigation back to the viewer. Wiped when
 *   the tab closes — that's the sessionStorage contract.
 *
 * Tier 2 — server (durable, cross-session, cross-device-of-same-machine):
 *   `POST /api/tags/[docId]` is fired on every save so the Library can
 *   restore the exact same tags / active selection / pages-analysed set
 *   weeks later. The server file is canonical: if the tab session is
 *   gone, the next viewer mount hydrates from the server fetch instead.
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
  /** Number of completed generation calls for this tag (1 = initial, 2+ = retries). */
  attempts?: number;
  /** Last runtime error reported by the visualizer; used as repair context on retry. */
  lastRuntimeError?: string;
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
  // Best-effort durable copy. We don't await so the snapshot UX stays
  // instant; if the POST fails (server restarting, offline, etc.) the
  // sessionStorage copy still keeps the user whole until the next save.
  try {
    void fetch(`/api/tags/${encodeURIComponent(docId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* noop — even constructing the fetch can throw on Firefox private mode */
  }
}

/**
 * Pulls the server-persisted tag state for a doc. Used by the viewer on
 * mount when sessionStorage is empty — e.g. the user closed the tab and
 * is re-opening from the Library. Returns null if the server has no
 * record (the doc was just uploaded).
 */
export async function fetchServerDocState(
  docId: string,
): Promise<PersistedDocState | null> {
  try {
    const r = await fetch(`/api/tags/${encodeURIComponent(docId)}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as
      | {
          v: 1;
          tags: PersistedTag[];
          activeTagId: string | null;
          pagesAnalyzed: number[];
          savedAt?: number;
        }
      | null;
    if (!j || j.v !== VERSION) return null;
    return {
      v: VERSION,
      savedAt: j.savedAt ?? Date.now(),
      tags: j.tags,
      activeTagId: j.activeTagId,
      pagesAnalyzed: j.pagesAnalyzed,
    };
  } catch {
    return null;
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
