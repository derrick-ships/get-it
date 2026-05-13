"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  RefreshCw,
  AlertCircle,
  MousePointerClick,
  BookOpen,
  Tag as TagIcon,
  Network,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import PdfViewer, { type Tag } from "@/components/PdfViewer";
import RightPane, { type RightPaneMode } from "@/components/RightPane";
import AccountButton from "@/components/AccountButton";
import SettingsButton, { SETTINGS_EVENT } from "@/components/SettingsButton";
import TooltipChip from "@/components/TooltipChip";
import type { DetectedConcept, VizSpec, VizType } from "@/lib/schemas";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "@/lib/config";

import {
  fetchServerDocState,
  loadDocState,
  saveDocState,
  type PersistedTag,
} from "@/lib/persistence";

const MAX_CONCURRENT_VIZ_GEN = 4;
const SAVE_DEBOUNCE_MS = 250;

type DocMeta = {
  docId: string;
  filename: string;
  pdfUrl: string;
  numPages: number;
  pages: Array<{ pageIndex: number; width: number; height: number; text: string }>;
};

type AnalyzeResult = {
  concepts: DetectedConcept[];
  anchors: Record<number, { endX: number; endY: number; fontHeight: number } | null>;
  pageWidth: number;
  pageHeight: number;
};

type TagState = Tag & {
  concept: DetectedConcept;
  spec?: VizSpec;
  error?: string;
  /** Number of completed generation calls so far (1 = initial, 2+ = retries). */
  attempts?: number;
  /** Last runtime error reported by the visualizer; sent back to codex on retry. */
  lastRuntimeError?: string;
};

const FILENAME_TO_TITLE: Record<string, string> = {
  "anatomy.pdf": "Anatomy & Physiology",
  "physics.pdf": "Classical Mechanics",
  "costituzione.pdf": "Costituzione Italiana",
  "calculus.pdf": "Differential & Integral Calculus",
  "chemistry.pdf": "Organic Chemistry",
};

// PersistedTag and TagState have the same shape — the cast is safe because
// PersistedTag tracks the same fields without any DOM/runtime references.
function tagFromPersisted(p: PersistedTag): TagState {
  return { ...p };
}

export default function ViewerClient({ docId }: { docId: string }) {
  // Hydrate from sessionStorage in useState lazy initializers so the very
  // first render already has the cached tags, active selection, and
  // analyzed-pages set. Each initializer runs exactly once per mount.
  // SSR-safe: typeof window guard short-circuits to an empty default.
  const persistedOnMount = useMemo(() => {
    if (typeof window === "undefined") return null;
    return loadDocState(docId);
    // We intentionally compute this once; docId is stable for a viewer
    // mount because Next.js remounts on URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tags, setTags] = useState<TagState[]>(
    () => persistedOnMount?.tags.map(tagFromPersisted) ?? [],
  );
  const [activeTagId, setActiveTagId] = useState<string | null>(
    () => persistedOnMount?.activeTagId ?? null,
  );
  const [pagesAnalyzing, setPagesAnalyzing] = useState<Set<number>>(new Set());
  const [pagesAnalyzed, setPagesAnalyzed] = useState<Set<number>>(
    () => new Set(persistedOnMount?.pagesAnalyzed ?? []),
  );
  const restoredFromCache = persistedOnMount !== null;

  // Runtime settings. We start from the env-baked defaults so the first
  // paint is meaningful, then hydrate from `/api/settings` once it lands.
  // Every change posts back so the saved file is the canonical copy;
  // survives app restarts and the dynamic localhost port the packaged
  // app uses.
  const [autoGenerate, setAutoGenerate] = useState<boolean>(AUTO_GENERATE_VIZ);
  const [maxRetries, setMaxRetries] = useState<number>(MAX_VIZ_GEN_RETRIES);
  const settingsHydratedRef = useRef(false);
  // Refs mirror the latest values so callbacks/effects captured by long-
  // running closures (page detection, runtime-error retry) read the live
  // setting instead of a stale capture.
  const autoGenerateRef = useRef(autoGenerate);
  const maxRetriesRef = useRef(maxRetries);
  autoGenerateRef.current = autoGenerate;
  maxRetriesRef.current = maxRetries;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: { autoGenerate: boolean; maxRetries: number }) => {
        if (cancelled) return;
        if (typeof s.autoGenerate === "boolean") setAutoGenerate(s.autoGenerate);
        if (typeof s.maxRetries === "number") setMaxRetries(s.maxRetries);
        settingsHydratedRef.current = true;
      })
      .catch(() => {
        settingsHydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mid-session changes from the top-bar Settings popover land here as a
  // CustomEvent — pick them up and update local state + refs so the
  // running orchestration uses the new values without a viewer remount.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { autoGenerate?: boolean; maxRetries?: number }
        | undefined;
      if (!detail) return;
      if (typeof detail.autoGenerate === "boolean") setAutoGenerate(detail.autoGenerate);
      if (typeof detail.maxRetries === "number") setMaxRetries(detail.maxRetries);
    };
    window.addEventListener(SETTINGS_EVENT, onChange);
    return () => window.removeEventListener(SETTINGS_EVENT, onChange);
  }, []);

  // Right-pane mode (Visualizer / KG / Chat / Flashcards / Feynman). The
  // mode is tab-scoped — we re-load it from sessionStorage so it survives
  // refreshes within the session.
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>(() => {
    if (typeof window === "undefined") return "visualizer";
    const v = window.sessionStorage.getItem(`braynr:${docId}:right-mode`);
    if (v === "visualizer" || v === "graph" || v === "chat" || v === "flashcards" || v === "feynman")
      return v;
    return "visualizer";
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(`braynr:${docId}:right-mode`, rightPaneMode);
    } catch {
      /* noop */
    }
  }, [docId, rightPaneMode]);

  // Kick off knowledge-graph build once we know the doc is loaded. The
  // build route is idempotent server-side — if a graph already exists on
  // disk, the call is a no-op. We don't await: the KG view polls /state
  // and shows its own "building…" placeholder.
  const kgBuildKickedRef = useRef(false);
  useEffect(() => {
    if (!meta || kgBuildKickedRef.current) return;
    kgBuildKickedRef.current = true;
    fetch(`/api/kg/${docId}/build`, { method: "POST" }).catch((e) => {
      console.warn("[braynr] kg/build kick failed", e);
    });
  }, [meta, docId]);

  // ── Hydrate from server if sessionStorage was empty ──────────────────
  // Re-opening a doc from the Library after a tab close lands us here
  // with empty tags/pagesAnalyzed. Pull the canonical copy from the
  // server before we kick off detection so we don't re-detect pages
  // that already have tags on disk.
  const [serverHydrated, setServerHydrated] = useState<boolean>(
    () => persistedOnMount !== null,
  );
  useEffect(() => {
    if (persistedOnMount !== null) return; // already hydrated from sessionStorage
    if (serverHydrated) return;
    let cancelled = false;
    fetchServerDocState(docId).then((s) => {
      if (cancelled || !s) {
        if (!cancelled) setServerHydrated(true);
        return;
      }
      setTags(s.tags.map(tagFromPersisted));
      setActiveTagId(s.activeTagId);
      setPagesAnalyzed(new Set(s.pagesAnalyzed));
      setServerHydrated(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // ── Load document metadata from server ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/doc/${docId}`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(
            r.status === 404
              ? "This document is no longer in memory. Please re-upload from the home page."
              : `Could not load document (HTTP ${r.status})`,
          );
        }
        return (await r.json()) as DocMeta;
      })
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const docTitle = useMemo(
    () => meta && (FILENAME_TO_TITLE[meta.filename] || meta.filename.replace(/\.pdf$/i, "")),
    [meta],
  );

  // ── Refs that survive re-renders for the orchestration plumbing ──────
  const analyzedRef = useRef<Set<number>>(new Set());
  const vizQueueRef = useRef<TagState[]>([]);
  const vizInflightRef = useRef(0);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const ctrlsRef = useRef<AbortController[]>([]);
  const cancelledRef = useRef(false);
  // Did we already kick the queue once for resumed-on-reload generations?
  const resumedRef = useRef(false);
  // Mirror of the most recent state — used by event handlers that fire
  // outside of React's render cycle (pagehide flush, runtime-error retry).
  const tagsRef = useRef<TagState[]>([]);
  // (assignments to .current happen below, after `tags` is in scope)

  // ── Helpers ──────────────────────────────────────────────────────────
  const pumpVizQueue = useCallback(() => {
    while (
      vizInflightRef.current < MAX_CONCURRENT_VIZ_GEN &&
      vizQueueRef.current.length
    ) {
      const next = vizQueueRef.current.shift()!;
      vizInflightRef.current++;
      const ctrl = new AbortController();
      ctrlsRef.current.push(ctrl);
      // If this tag is a retry (previous spec exists + a runtime error was
      // captured), hand the broken code + error back to codex as repair
      // context. The route bumps reasoning.effort for repair calls.
      const previousAttempt =
        next.spec && next.lastRuntimeError
          ? { spec: next.spec, runtimeError: next.lastRuntimeError }
          : undefined;
      fetch("/api/generate-viz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: next.type,
          label: next.concept.label,
          context: next.concept.context,
          docTitle,
          previousAttempt,
        }),
        signal: ctrl.signal,
      })
        .then(async (r) => {
          if (!r.ok) {
            const txt = await r.text().catch(() => "");
            throw new Error(`generate-viz ${r.status}: ${txt.slice(0, 200)}`);
          }
          return (await r.json()) as VizSpec;
        })
        .then((spec) => {
          if (cancelledRef.current) return;
          setTags((prev) =>
            prev.map((t) =>
              t.id === next.id
                ? {
                    ...t,
                    spec,
                    ready: true,
                    generating: false,
                    attempts: (t.attempts ?? 0) + 1,
                    lastRuntimeError: undefined,
                    error: undefined,
                  }
                : t,
            ),
          );
        })
        .catch((e) => {
          if (
            cancelledRef.current ||
            ctrl.signal.aborted ||
            (e as Error).name === "AbortError" ||
            ((e as Error).message || "").includes("Failed to fetch")
          ) {
            return;
          }
          // warn — failure is also surfaced to the user via tag.error.
          // Avoids triggering Next.js dev overlay's "1 Issue" badge.
          console.warn("viz generation failed for", next.label, e);
          setTags((prev) =>
            prev.map((t) =>
              t.id === next.id
                ? { ...t, error: (e as Error).message, ready: false, generating: false }
                : t,
            ),
          );
        })
        .finally(() => {
          enqueuedRef.current.delete(next.id);
          vizInflightRef.current--;
          if (!cancelledRef.current) pumpVizQueue();
        });
    }
  }, [docTitle]);

  const enqueueTagForGen = useCallback(
    (tag: TagState) => {
      if (enqueuedRef.current.has(tag.id)) return;
      // Skip if already finished. A tag that is being repaired keeps spec
      // around as repair context, so we DON'T bail just because spec exists.
      if (tag.error) return;
      if (tag.spec && !tag.lastRuntimeError) return;
      enqueuedRef.current.add(tag.id);
      vizQueueRef.current.push(tag);
      setTags((prev) =>
        prev.map((t) => (t.id === tag.id ? { ...t, generating: true } : t)),
      );
      pumpVizQueue();
    },
    [pumpVizQueue],
  );

  // ── Visualizer crashed on a spec — ask codex to fix it ───────────────
  // Read decisions OUT of the reducer: React's setState reducer can run
  // multiple times in dev StrictMode, and any side effect there is a bug.
  // We look up the live tag from tagsRef (kept in sync each render) and
  // decide synchronously whether we still have budget for a retry.
  // The visualizer reports a runtime error. We synchronously consult
  // tagsRef (kept in sync each render) to decide whether to retry, and
  // pass the freshly-built repair tag straight into enqueueTagForGen
  // rather than waiting for React to commit the setState.
  const handleRuntimeError = useCallback(
    (tagId: string, message: string) => {
      const tag = tagsRef.current.find((t) => t.id === tagId);
      if (!tag) return;
      const attemptsSoFar = tag.attempts ?? 1;
      if (attemptsSoFar > maxRetriesRef.current) {
        // Out of repair budget. Keep the raw runtime detail in console for
        // debugging; surface a calm, humanised line to the user instead.
        console.warn(
          `[braynr] giving up on "${tag.label}" after ${attemptsSoFar} attempts:`,
          message,
        );
        setTags((prev) =>
          prev.map((t) =>
            t.id === tagId
              ? {
                  ...t,
                  ready: false,
                  generating: false,
                  error: `Couldn't render this concept — the agent's code kept failing to compile after ${attemptsSoFar} attempts.`,
                  lastRuntimeError: message,
                }
              : t,
          ),
        );
        return;
      }
      // Construct the repair-state tag directly so we can enqueue with
      // lastRuntimeError set without waiting for React to commit.
      const repairTag: TagState = {
        ...tag,
        ready: false,
        generating: true,
        lastRuntimeError: message,
      };
      setTags((prev) => prev.map((t) => (t.id === tagId ? repairTag : t)));
      enqueueTagForGen(repairTag);
    },
    [enqueueTagForGen],
  );

  // ── Page-by-page concept detection (skipping any already done) ───────
  useEffect(() => {
    if (!meta) return;
    if (!serverHydrated) return; // wait so we don't re-detect already-tagged pages
    cancelledRef.current = false;

    // Seed analyzedRef from the restored pagesAnalyzed so we don't re-detect.
    pagesAnalyzed.forEach((p) => analyzedRef.current.add(p));

    async function runOne(pageIndex: number) {
      if (analyzedRef.current.has(pageIndex)) return;
      analyzedRef.current.add(pageIndex);
      setPagesAnalyzing((s) => new Set(s).add(pageIndex));
      const ctrl = new AbortController();
      ctrlsRef.current.push(ctrl);
      try {
        const r = await fetch("/api/analyze-pdf", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docId, pageIndex }),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`analyze failed ${r.status}`);
        const j = (await r.json()) as AnalyzeResult;
        if (cancelledRef.current) return;
        const newTags: TagState[] = j.concepts
          .map((c, i) => {
            const a = j.anchors[i];
            if (!a) return null;
            return {
              id: `${pageIndex}-${i}`,
              page: pageIndex,
              endX: a.endX,
              endY: a.endY,
              fontHeight: a.fontHeight,
              type: c.type as VizType,
              label: c.label,
              ready: false,
              generating: autoGenerateRef.current,
              concept: c,
            };
          })
          .filter((t): t is TagState => t !== null);
        // Dedup by id in case a stale persisted entry collides.
        setTags((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...newTags.filter((t) => !seen.has(t.id))];
        });
        if (autoGenerateRef.current) {
          for (const t of newTags) {
            if (enqueuedRef.current.has(t.id)) continue;
            enqueuedRef.current.add(t.id);
            vizQueueRef.current.push(t);
          }
          pumpVizQueue();
        }
      } catch (e) {
        if (
          cancelledRef.current ||
          ctrl.signal.aborted ||
          (e as Error).name === "AbortError" ||
          ((e as Error).message || "").includes("Failed to fetch")
        ) {
          return;
        }
        console.warn(`page ${pageIndex} analyze failed`, e);
      } finally {
        if (!cancelledRef.current) {
          setPagesAnalyzing((s) => {
            const n = new Set(s);
            n.delete(pageIndex);
            return n;
          });
          setPagesAnalyzed((s) => new Set(s).add(pageIndex));
        }
      }
    }

    // Run pages in parallel, capped at 3 concurrent.
    const queue = Array.from({ length: meta.numPages }, (_, i) => i);
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const idx = queue.shift();
        if (idx == null) return;
        await runOne(idx);
      }
    });
    Promise.all(workers).catch(() => {});

    return () => {
      cancelledRef.current = true;
      vizQueueRef.current = [];
      enqueuedRef.current.clear();
      ctrlsRef.current.forEach((c) => {
        try {
          c.abort();
        } catch {}
      });
      ctrlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, docId, serverHydrated]);

  // ── Resume in-flight viz generations after a reload ──────────────────
  // Tags persisted with generating=true had their fetch killed by the
  // reload. Re-enqueue them so the user actually sees them complete.
  // pumpVizQueue depends on docTitle, which is null until /api/doc loads,
  // so we wait for meta before resuming — otherwise the body would carry
  // a stale "general" docTitle in the prompt.
  useEffect(() => {
    if (!restoredFromCache || resumedRef.current || !meta) return;
    resumedRef.current = true;
    const stillPending = tags.filter(
      (t) => t.generating && !t.spec && !t.error && !enqueuedRef.current.has(t.id),
    );
    if (stillPending.length === 0) return;
    for (const t of stillPending) {
      enqueuedRef.current.add(t.id);
      vizQueueRef.current.push(t);
    }
    pumpVizQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredFromCache, meta]);

  // ── Persist to sessionStorage (debounced) ────────────────────────────
  // The save is debounced because tags update in bursts (e.g. 4 tags arrive
  // from one detection call). On page hide/reload we ALSO flush
  // synchronously via the `pagehide` listener below, so the user never
  // loses the most recent state to the debounce window.
  useEffect(() => {
    if (tags.length === 0 && pagesAnalyzed.size === 0 && activeTagId == null) {
      return;
    }
    const t = setTimeout(() => {
      saveDocState(docId, {
        tags,
        activeTagId,
        pagesAnalyzed: Array.from(pagesAnalyzed),
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [docId, tags, activeTagId, pagesAnalyzed]);

  // Final save on page hide / reload — runs synchronously before the doc
  // unloads so the latest state always lands in sessionStorage. We use
  // pagehide rather than beforeunload because the latter is unreliable
  // on mobile and on bfcache restores. tagsRef itself was hoisted earlier
  // so that the runtime-error retry handler can read fresh state too.
  const activeTagIdRef = useRef(activeTagId);
  const pagesAnalyzedRef = useRef(pagesAnalyzed);
  tagsRef.current = tags;
  activeTagIdRef.current = activeTagId;
  pagesAnalyzedRef.current = pagesAnalyzed;
  useEffect(() => {
    const flush = () => {
      saveDocState(docId, {
        tags: tagsRef.current,
        activeTagId: activeTagIdRef.current,
        pagesAnalyzed: Array.from(pagesAnalyzedRef.current),
      });
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => {
      flush(); // also flush on component unmount (e.g. SPA navigation)
      window.removeEventListener("pagehide", flush);
    };
  }, [docId]);

  const activeTag = tags.find((t) => t.id === activeTagId) ?? null;
  const activeSpec = activeTag?.spec ?? null;

  // Auto-select the first ready tag when nothing is selected yet.
  useEffect(() => {
    if (activeTagId) return;
    const firstReady = tags.find((t) => t.ready);
    if (firstReady) setActiveTagId(firstReady.id);
  }, [tags, activeTagId]);

  const handleTagClick = useCallback(
    (id: string) => {
      setActiveTagId(id);
      const tag = tags.find((t) => t.id === id);
      if (!tag) return;
      if (!tag.spec && !tag.error && !tag.generating) {
        enqueueTagForGen(tag);
      }
    },
    [tags, enqueueTagForGen],
  );

  // When the user flips auto-generate from off to on mid-session, sweep
  // any idle tags into the queue so they don't sit there waiting for a
  // click. Off→on transitions are detected by comparing against a ref.
  // Off→on is the only transition that triggers work; on→off lets in-
  // flight generations finish naturally.
  const prevAutoRef = useRef(autoGenerate);
  useEffect(() => {
    if (!prevAutoRef.current && autoGenerate) {
      const idle = tagsRef.current.filter(
        (t) => !t.spec && !t.error && !t.generating && !enqueuedRef.current.has(t.id),
      );
      for (const t of idle) enqueueTagForGen(t);
    }
    prevAutoRef.current = autoGenerate;
  }, [autoGenerate, enqueueTagForGen]);

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[var(--surface-canvas)] text-[var(--ink-900)]">
        <AlertCircle className="h-7 w-7 text-rose-500" />
        <p className="text-sm text-[var(--ink-700)]">{loadError}</p>
        <Link
          href="/"
          className="rounded-full bg-[var(--ink-900)] px-4 py-1.5 text-sm font-medium text-white hover:bg-black"
        >
          Back to upload
        </Link>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface-canvas)] text-[var(--ink-500)]">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[var(--accent-600)]" />
        loading document…
      </div>
    );
  }

  const detecting = pagesAnalyzing.size > 0;
  const totalPages = meta.numPages;
  const doneCount = pagesAnalyzed.size;
  const tagReadyCount = tags.filter((t) => t.ready).length;
  const tagGeneratingCount = tags.filter((t) => t.generating).length;

  const truncated =
    docTitle && docTitle.length > 28 ? `${docTitle.slice(0, 28)}…` : docTitle ?? meta.filename;

  return (
    <div className="flex h-screen flex-col bg-[var(--surface-canvas)]">
      {/* Top tab bar */}
      <div className="tab-bar shrink-0">
        <TooltipChip tip="Back to upload">
          <Link href="/" aria-label="Back to upload" className="tab-icon-btn">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </TooltipChip>
        <div className="tab-item" data-active="true">
          <FileText className="h-3.5 w-3.5 text-[var(--accent-600)]" />
          <span className="max-w-[180px] truncate">{truncated}</span>
          {!autoGenerate && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-amber-700">
              <MousePointerClick className="h-2.5 w-2.5" /> manual
            </span>
          )}
        </div>
        <TooltipChip tip="Your library of opened PDFs.">
          <Link href="/library" aria-label="Open library" className="tab-item">
            <BookOpen className="h-3.5 w-3.5 text-[var(--ink-400)]" />
            <span>Library</span>
          </Link>
        </TooltipChip>
        <div className="ml-auto flex items-center gap-2 pr-1">
          <KGStatusBadge docId={docId} />
          <TagsChip
            pagesDone={doneCount}
            pagesTotal={totalPages}
            detecting={detecting}
            tagsReady={tagReadyCount}
            tagsTotal={tags.length}
            generating={tagGeneratingCount > 0}
          />
          <SettingsButton />
          <AccountButton />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 bg-[var(--surface-canvas)] p-2">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white">
          <PdfViewer
            pdfUrl={meta.pdfUrl}
            numPages={meta.numPages}
            pageDims={meta.pages.map((p) => ({ width: p.width, height: p.height }))}
            tags={tags}
            activeTagId={activeTagId}
            onTagClick={handleTagClick}
            detecting={detecting}
          />
        </div>
        <div className="flex w-[44%] min-w-[420px] max-w-[720px] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white">
          <RightPane
            docId={docId}
            mode={rightPaneMode}
            onModeChange={setRightPaneMode}
            visualizer={{
              // While retrying OR after final failure, hide the broken
              // spec so the loader / empty state shows. The spec is kept
              // on the tag itself only as repair context.
              spec: activeTag?.generating || activeTag?.error ? null : activeSpec,
              loading:
                activeTag != null && !activeTag.error &&
                (activeTag.generating || !activeTag.spec),
              loadingDetail:
                activeTag?.generating && (activeTag.attempts ?? 0) >= 1
                  ? `repairing — attempt ${(activeTag.attempts ?? 0) + 1} of ${maxRetries + 1}`
                  : undefined,
              onRuntimeError: activeTag
                ? (msg) => handleRuntimeError(activeTag.id, msg)
                : undefined,
              emptyHint: activeTag?.error
                ? "We weren't able to build a working visualization for this concept. Pick another tag — most of them work cleanly."
                : tags.length === 0
                  ? "codex is reading the document — tags will appear inline as soon as they're detected."
                  : autoGenerate
                    ? "Click any colored tag in the document to render its concept here."
                    : "Click any tag to generate its visualization. (manual mode — toggle auto-generate in settings)",
              activeTagError: activeTag?.error ?? null,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Merged badge for the page-detection + per-tag generation progress. The
 *  tag icon makes it obvious this is the document-tag pipeline; the two
 *  pairs are separated by a faint pipe so the eye can scan them as one
 *  surface. Spins whenever either side is in flight. */
/**
 * Visualization agent status pill.
 *
 * Two phases:
 *   • Detection in progress — `pagesDone < pagesTotal`. We show the
 *     page-scan progress (`N/total pages`). This is the concept-
 *     detection agent walking the document; until it's done, there's
 *     nothing meaningful to say about tags yet.
 *   • Detection done — switch to `N/total viz ready`. The numerator
 *     counts tags with a successfully-rendered visualization spec; the
 *     denominator is every tag the agent found. Works identically in
 *     auto-generate and manual mode — the only difference is how the
 *     numerator climbs (parallel vs on click).
 *
 * The tooltip explains which agent the chip is reporting on, so the
 * user can tell it apart from the knowledge-graph badge on its left.
 */
function TagsChip({
  pagesDone,
  pagesTotal,
  detecting,
  tagsReady,
  tagsTotal,
  generating,
}: {
  pagesDone: number;
  pagesTotal: number;
  detecting: boolean;
  tagsReady: number;
  tagsTotal: number;
  generating: boolean;
}) {
  const detectionDone = pagesTotal > 0 && pagesDone >= pagesTotal;
  const spinning = detectionDone ? generating : detecting;
  const tip = detectionDone
    ? "Visualization agent — concept detection done; each tag spins up a per-concept renderer (3D, animation, formula, graph, source)."
    : "Visualization agent — scanning each page for the concepts worth tagging.";
  return (
    <span className="viz-tooltip-anchor relative inline-flex">
      <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-2 py-1 text-[11px]">
        {spinning ? (
          <RefreshCw className="h-3 w-3 animate-spin text-[var(--accent-600)]" />
        ) : (
          <TagIcon className="h-3 w-3 text-[var(--ink-400)]" />
        )}
        {!detectionDone ? (
          <>
            <span className="tabular-nums font-medium text-[var(--ink-900)]">
              {pagesDone}
              <span className="font-normal text-[var(--ink-400)]">/{pagesTotal}</span>
            </span>
            <span className="text-[var(--ink-500)]">pages</span>
          </>
        ) : (
          <>
            <span className="tabular-nums font-medium text-[var(--ink-900)]">
              {tagsReady}
              <span className="font-normal text-[var(--ink-400)]">/{tagsTotal}</span>
            </span>
            <span className="text-[var(--ink-500)]">viz ready</span>
          </>
        )}
      </div>
      <span className="viz-tooltip" role="tooltip">
        {tip}
      </span>
    </span>
  );
}

/** Compact status badge for the knowledge-graph evaluator agent. Polls
 *  /api/kg/[docId]/state every 6 s and renders one of:
 *    • "Building graph"        — initial concept extraction in flight
 *    • "Graph error"           — build failed (rare)
 *    • "Evaluating"            — evaluator pass currently running
 *    • "No evaluations yet"    — graph ready, no interactions yet
 *    • "Synced <relative>"     — last successful evaluator pass
 *  Independent of the KG view's own poll: when the user is on a different
 *  right-pane mode this is the only thing keeping the badge fresh. */
function KGStatusBadge({ docId }: { docId: string }) {
  const [state, setState] = useState<{
    status: "missing" | "building" | "ready" | "error";
    evaluating: boolean;
    evaluationCount: number;
    lastEvaluatedAt: number | null;
    buildError?: string;
  } | null>(null);
  // Tick once a second so "X seconds ago" doesn't lag.
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const fetchOnce = async () => {
      try {
        const r = await fetch(`/api/kg/${docId}/state`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as {
          status: "missing" | "building" | "ready" | "error";
          evaluating?: boolean;
          evaluationCount: number;
          lastEvaluatedAt: number | null;
          buildError?: string;
        };
        if (cancelled) return;
        tries = 0;
        setState({
          status: j.status,
          evaluating: !!j.evaluating,
          evaluationCount: j.evaluationCount,
          lastEvaluatedAt: j.lastEvaluatedAt,
          buildError: j.buildError,
        });
      } catch {
        tries++;
      }
    };
    fetchOnce();
    // Faster cadence while the agent is actively working; slow down when idle.
    const id = setInterval(
      () => {
        fetchOnce();
      },
      state && (state.status === "building" || state.evaluating) ? 2500 : 6000,
    );
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, state?.status, state?.evaluating]);

  // Re-render once a second so the relative time stays current.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) return null;

  let icon: React.ReactNode;
  let label: string;
  let tone = "text-[var(--ink-500)]";
  let valueTone = "text-[var(--ink-900)]";
  let title = "";

  if (state.status === "building") {
    icon = <RefreshCw className="h-3 w-3 animate-spin text-[var(--accent-600)]" />;
    label = "Building graph";
    title = "Knowledge-graph agent is extracting concepts from the document";
  } else if (state.status === "error") {
    icon = <AlertCircle className="h-3 w-3 text-rose-500" />;
    label = "Graph error";
    valueTone = "text-rose-700";
    title = state.buildError ?? "Graph build failed";
  } else if (state.evaluating) {
    icon = <RefreshCw className="h-3 w-3 animate-spin text-[var(--accent-600)]" />;
    label = "Evaluating";
    title = "Evaluator is re-scoring concepts based on your latest interaction";
  } else if (state.status === "ready" && state.evaluationCount === 0) {
    icon = <Network className="h-3 w-3 text-[var(--ink-400)]" />;
    label = "No evaluations yet";
    tone = "text-[var(--ink-500)]";
    title = "Interact with chat / flashcards / feynman to start the evaluator";
  } else if (state.status === "ready" && state.lastEvaluatedAt) {
    icon = <Network className="h-3 w-3 text-emerald-600" />;
    label = `Synced ${humaniseAgo(state.lastEvaluatedAt)}`;
    title = `${state.evaluationCount} evaluation${state.evaluationCount === 1 ? "" : "s"} so far`;
  } else {
    // status === "missing" — viewer hasn't kicked the build yet.
    icon = <Network className="h-3 w-3 text-[var(--ink-400)]" />;
    label = "Graph pending";
    title = "Waiting to build the knowledge graph";
  }

  return (
    <span className="viz-tooltip-anchor relative inline-flex">
      <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-2 py-1 text-[11px]">
        {icon}
        <span className={`font-medium ${valueTone}`}>{label.split(" ")[0]}</span>
        <span className={tone}>{label.split(" ").slice(1).join(" ")}</span>
      </div>
      <span className="viz-tooltip" role="tooltip">
        Knowledge-graph agent — {title || "tracks per-concept mastery from your chats, flashcards and Feynman sessions."}
      </span>
    </span>
  );
}

function humaniseAgo(ts: number): string {
  const dt = Date.now() - ts;
  if (dt < 5_000) return "just now";
  if (dt < 60_000) return `${Math.round(dt / 1000)}s ago`;
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h ago`;
  return `${Math.round(dt / 86_400_000)}d ago`;
}

