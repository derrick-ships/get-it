"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  RefreshCw,
  AlertCircle,
  MousePointerClick,
  ChevronDown,
  Plus,
  Settings2,
  BookOpen,
  Users,
  Calendar,
  RotateCcw,
} from "lucide-react";

import PdfViewer, { type Tag } from "@/components/PdfViewer";
import Visualizer from "@/components/Visualizer";
import type { DetectedConcept, VizSpec, VizType } from "@/lib/schemas";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "@/lib/config";
import {
  clearDocState,
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
      if (attemptsSoFar > MAX_VIZ_GEN_RETRIES) {
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
              generating: AUTO_GENERATE_VIZ,
              concept: c,
            };
          })
          .filter((t): t is TagState => t !== null);
        // Dedup by id in case a stale persisted entry collides.
        setTags((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...newTags.filter((t) => !seen.has(t.id))];
        });
        if (AUTO_GENERATE_VIZ) {
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
  }, [meta, docId]);

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

  const handleResetCache = useCallback(() => {
    clearDocState(docId);
    window.location.reload();
  }, [docId]);

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
        <Link href="/" className="tab-icon-btn" title="Back">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <div className="tab-item" data-active="true">
          <FileText className="h-3.5 w-3.5 text-[var(--accent-600)]" />
          <span className="max-w-[180px] truncate">{truncated}</span>
          {!AUTO_GENERATE_VIZ && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-amber-700">
              <MousePointerClick className="h-2.5 w-2.5" /> manual
            </span>
          )}
          {restoredFromCache && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-sky-700"
              title="State restored from this tab's session"
            >
              restored
            </span>
          )}
        </div>
        <div className="tab-item">
          <BookOpen className="h-3.5 w-3.5 text-[var(--ink-400)]" />
          <span>Library</span>
        </div>
        <div className="tab-item">
          <Users className="h-3.5 w-3.5 text-[var(--ink-400)]" />
          <span>Concepts</span>
        </div>
        <div className="tab-item">
          <Calendar className="h-3.5 w-3.5 text-[var(--ink-400)]" />
          <span>Recent</span>
        </div>
        <div className="tab-icon-btn ml-1">
          <Plus className="h-3.5 w-3.5" />
        </div>
        <div className="ml-auto flex items-center gap-2 pr-1">
          <ProgressChip
            label="pages"
            value={doneCount}
            total={totalPages}
            spinning={detecting}
          />
          <ProgressChip
            label={AUTO_GENERATE_VIZ ? "viz ready" : "clicked"}
            value={tagReadyCount}
            total={AUTO_GENERATE_VIZ ? tags.length : tagReadyCount + tagGeneratingCount}
            spinning={tagGeneratingCount > 0}
          />
          <button
            type="button"
            onClick={handleResetCache}
            title="Forget cached state for this document and re-detect from scratch"
            className="tab-icon-btn"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <div className="tab-icon-btn">
            <ChevronDown className="h-3.5 w-3.5" />
          </div>
          <div className="tab-icon-btn">
            <Settings2 className="h-3.5 w-3.5" />
          </div>
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
          <div className="min-h-0 flex-1">
            <Visualizer
              // While retrying OR after final failure, hide the broken
              // spec so the loader / empty state shows. The spec is kept
              // on the tag itself only as repair context.
              spec={activeTag?.generating || activeTag?.error ? null : activeSpec}
              loading={
                activeTag != null && !activeTag.error &&
                (activeTag.generating || !activeTag.spec)
              }
              loadingDetail={
                activeTag?.generating && (activeTag.attempts ?? 0) >= 1
                  ? `repairing — attempt ${(activeTag.attempts ?? 0) + 1} of ${MAX_VIZ_GEN_RETRIES + 1}`
                  : undefined
              }
              onRuntimeError={
                activeTag ? (msg) => handleRuntimeError(activeTag.id, msg) : undefined
              }
              emptyHint={
                activeTag?.error
                  ? "We weren't able to build a working visualization for this concept. Pick another tag — most of them work cleanly."
                  : tags.length === 0
                    ? "codex is reading the document — tags will appear inline as soon as they're detected."
                    : AUTO_GENERATE_VIZ
                      ? "Click any colored tag in the document to render its concept here."
                      : "Click any tag to generate its visualization. (manual mode is on — see .env)"
              }
            />
          </div>
          {activeTag?.error && (
            <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-5 py-3 text-[12px] text-amber-800">
              {activeTag.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressChip({
  label,
  value,
  total,
  spinning,
}: {
  label: string;
  value: number;
  total: number;
  spinning?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-2 py-1 text-[11px]">
      {spinning && <RefreshCw className="h-3 w-3 animate-spin text-[var(--accent-600)]" />}
      <span className="tabular-nums font-medium text-[var(--ink-900)]">
        {value}
        <span className="font-normal text-[var(--ink-400)]">/{total}</span>
      </span>
      <span className="text-[var(--ink-500)]">{label}</span>
    </div>
  );
}
