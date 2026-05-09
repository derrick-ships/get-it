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
} from "lucide-react";

import PdfViewer, { type Tag } from "@/components/PdfViewer";
import Visualizer from "@/components/Visualizer";
import type { DetectedConcept, VizSpec, VizType } from "@/lib/schemas";
import { AUTO_GENERATE_VIZ } from "@/lib/config";

const MAX_CONCURRENT_VIZ_GEN = 4;

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
};

const FILENAME_TO_TITLE: Record<string, string> = {
  "anatomy.pdf": "Anatomy & Physiology",
  "physics.pdf": "Classical Mechanics",
  "costituzione.pdf": "Costituzione Italiana",
  "calculus.pdf": "Differential & Integral Calculus",
  "chemistry.pdf": "Organic Chemistry",
};

export default function ViewerClient({ docId }: { docId: string }) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tags, setTags] = useState<TagState[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [pagesAnalyzing, setPagesAnalyzing] = useState<Set<number>>(new Set());
  const [pagesAnalyzed, setPagesAnalyzed] = useState<Set<number>>(new Set());

  // ── Load document metadata ────────────────────────────────────────────
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
  // Tracks tag IDs that are currently queued OR inflight, so we never
  // double-enqueue a manual click.
  const enqueuedRef = useRef<Set<string>>(new Set());
  const ctrlsRef = useRef<AbortController[]>([]);
  const cancelledRef = useRef(false);

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
      fetch("/api/generate-viz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: next.type,
          label: next.concept.label,
          context: next.concept.context,
          docTitle,
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
              t.id === next.id ? { ...t, spec, ready: true, generating: false } : t,
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
          console.error("viz generation error for", next.label, e);
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
      if (tag.spec || tag.error) return;
      enqueuedRef.current.add(tag.id);
      vizQueueRef.current.push(tag);
      // Mark the tag as generating so the pill shows the spinner.
      setTags((prev) =>
        prev.map((t) => (t.id === tag.id ? { ...t, generating: true } : t)),
      );
      pumpVizQueue();
    },
    [pumpVizQueue],
  );

  // ── Page-by-page concept detection ───────────────────────────────────
  useEffect(() => {
    if (!meta) return;
    cancelledRef.current = false;

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
        setTags((prev) => [...prev, ...newTags]);
        // In auto mode, eagerly queue every tag for generation. In manual
        // mode, wait for the user to click.
        if (AUTO_GENERATE_VIZ) {
          for (const t of newTags) {
            enqueuedRef.current.add(t.id);
            vizQueueRef.current.push(t);
          }
          pumpVizQueue();
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        console.error(`page ${pageIndex} analyze error`, e);
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

    // Run pages in parallel, but cap concurrency at 3 to avoid hammering codex.
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

  const activeTag = tags.find((t) => t.id === activeTagId) ?? null;
  const activeSpec = activeTag?.spec ?? null;

  // Auto-select the first ready tag the moment it becomes ready, so the
  // visualizer panel isn't empty when the user is waiting for tags. In
  // manual mode no tag is ever auto-generated, so this naturally no-ops
  // until the user clicks something.
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
      // In auto mode, generation is already in flight or done. In manual
      // mode the click itself triggers generation for this specific tag.
      if (!tag.spec && !tag.error && !tag.generating) {
        enqueueTagForGen(tag);
      }
    },
    [tags, enqueueTagForGen],
  );

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
              spec={activeSpec}
              loading={activeTag != null && !activeTag.spec && !activeTag.error}
              emptyHint={
                tags.length === 0
                  ? "codex is reading the document — tags will appear inline as soon as they're detected."
                  : AUTO_GENERATE_VIZ
                    ? "Click any colored tag in the document to render its concept here."
                    : "Click any tag to generate its visualization. (manual mode is on — see .env)"
              }
            />
          </div>
          {activeTag?.error && (
            <div className="shrink-0 border-t border-rose-200 bg-rose-50 px-5 py-3 text-xs text-rose-700">
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
