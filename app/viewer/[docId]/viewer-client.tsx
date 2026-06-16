"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  FileText,
  RefreshCw,
  AlertCircle,
  MousePointerClick,
  Upload,
  BookOpen,
  BookOpenText,
  Tag as TagIcon,
  Network,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import PdfViewer, { type Tag } from "@/components/PdfViewer";
import ReaderView from "@/components/ReaderView";
import { loadReaderPrefs, saveReaderPrefs, type ReaderPrefs } from "@/lib/reader-prefs";
import GhostReader, { type GhostSelection } from "@/components/GhostReader";
import PreflightGate from "@/components/PreflightGate";
import RightPane, { type RightPaneMode } from "@/components/RightPane";
import AccountButton from "@/components/AccountButton";
import SettingsButton, { SETTINGS_EVENT } from "@/components/SettingsButton";
import TooltipChip from "@/components/TooltipChip";
import type { DetectedConcept, VizSpec } from "@/lib/schemas";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "@/lib/config";

type DocMeta = {
  docId: string;
  filename: string;
  pdfUrl: string;
  numPages: number;
  pages: Array<{ pageIndex: number; width: number; height: number; text: string }>;
};

type TagState = Tag & {
  concept: DetectedConcept;
  spec?: VizSpec;
  error?: string;
  attempts?: number;
  lastRuntimeError?: string;
};

type TagsApiResponse = {
  file: {
    v: 1;
    docId: string;
    savedAt: number;
    tags: TagState[];
    activeTagId: string | null;
    pagesAnalyzed: number[];
    detectionError?: string | null;
  } | null;
  detectionRunning: boolean;
  vizQueueRunning: boolean;
  numPages: number;
};

/** The provider/model/credential fields whose change should re-trigger
 *  generation. Comparing a signature avoids re-running on unrelated setting
 *  toggles (auto-generate, repair budget). */
type SettingsLike = {
  autoGenerate?: boolean;
  maxRetries?: number;
  vizBudget?: number;
  provider?: string;
  codexModel?: string;
  openrouterModel?: string;
  openrouterApiKey?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
};
function providerSig(s: SettingsLike): string {
  return [
    s.provider,
    s.codexModel,
    s.openrouterModel,
    s.openrouterApiKey,
    s.ollamaModel,
    s.ollamaBaseUrl,
  ]
    .map((x) => x ?? "")
    .join("|");
}

const FILENAME_TO_TITLE: Record<string, string> = {
  "anatomy.pdf": "Anatomy & Physiology",
  "physics.pdf": "Classical Mechanics",
  "costituzione.pdf": "Costituzione Italiana",
  "calculus.pdf": "Differential & Integral Calculus",
  "chemistry.pdf": "Organic Chemistry",
};

const POLL_FAST_MS = 1500;
const POLL_IDLE_MS = 5000;

export default function ViewerClient({ docId }: { docId: string }) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Server-owned state — refreshed by polling /api/tags/<docId>. The
  // viewer is a *consumer*: it reads, never authoritatively mutates,
  // except for `activeTagId` (which is purely a UI selection).
  const [tags, setTags] = useState<TagState[]>([]);
  const [pagesAnalyzed, setPagesAnalyzed] = useState<Set<number>>(new Set());
  const [detectionRunning, setDetectionRunning] = useState(false);
  const [vizQueueRunning, setVizQueueRunning] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  // Ghostreader: set when the user highlights text in the document.
  const [ghost, setGhost] = useState<GhostSelection | null>(null);

  // Left-panel surface: the clean Reader is the default; the raw PDF is one
  // click away. Tab-scoped (sessionStorage) so a reload restores the choice.
  const [docView, setDocView] = useState<"reader" | "pdf">(() => {
    if (typeof window === "undefined") return "reader";
    return window.sessionStorage.getItem(`getit:${docId}:doc-view`) === "pdf" ? "pdf" : "reader";
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(`getit:${docId}:doc-view`, docView);
    } catch {
      /* noop */
    }
  }, [docId, docView]);

  // Reader appearance prefs (theme / typeface / size / spacing / width) —
  // global reading preferences, persisted across docs.
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(() => loadReaderPrefs());
  const updateReaderPrefs = useCallback((p: ReaderPrefs) => {
    setReaderPrefs(p);
    saveReaderPrefs(p);
  }, []);

  // Signature of the active provider/model/key; used to re-run generation
  // only when the AI backend actually changes (not on every settings save).
  const providerSigRef = useRef<string | null>(null);

  // Settings (auto-generate, max repair attempts) — start from env-baked
  // defaults, hydrate from /api/settings, react to `getit:settings`
  // CustomEvents the SettingsButton fires.
  const [autoGenerate, setAutoGenerate] = useState<boolean>(AUTO_GENERATE_VIZ);
  const [maxRetries, setMaxRetries] = useState<number>(MAX_VIZ_GEN_RETRIES);

  // Pre-flight generation gate: nothing is analyzed/visualized until the user
  // confirms a budget (so a long doc can't silently burn the usage window).
  const [preflight, setPreflight] = useState<"checking" | "show" | "done">("checking");
  const [defaultBudget, setDefaultBudget] = useState<number>(12);
  const [autoVizBudget, setAutoVizBudget] = useState<number>(0);
  const analysisStartedRef = useRef(false);
  const kickedVizRef = useRef<Set<string>>(new Set());

  // Focused reading mode — hides the visualizer pane so the reader takes the
  // full width (distraction-free). User-toggled, off by default.
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: SettingsLike) => {
        if (cancelled) return;
        if (typeof s.autoGenerate === "boolean") setAutoGenerate(s.autoGenerate);
        if (typeof s.maxRetries === "number") setMaxRetries(s.maxRetries);
        if (typeof s.vizBudget === "number") setDefaultBudget(s.vizBudget);
        providerSigRef.current = providerSig(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as SettingsLike | undefined;
      if (!detail) return;
      if (typeof detail.autoGenerate === "boolean") setAutoGenerate(detail.autoGenerate);
      if (typeof detail.maxRetries === "number") setMaxRetries(detail.maxRetries);

      // Re-run generation when (and only when) the AI provider/model/key
      // actually changes: reset detection so previously-analyzed pages are
      // re-examined by the new model, and re-kick the KG build (it rebuilds
      // from an error/missing state). This is the "try again when I switch
      // providers" behaviour.
      const nextSig = providerSig(detail);
      const prevSig = providerSigRef.current;
      providerSigRef.current = nextSig;
      if (prevSig !== null && nextSig !== prevSig) {
        setDetectionError(null);
        void fetch(`/api/jobs/detect/${docId}?reset=true`, { method: "POST" }).catch(() => {});
        void fetch(`/api/kg/${docId}/build`, { method: "POST" }).catch(() => {});
      }
    };
    window.addEventListener(SETTINGS_EVENT, onChange);
    return () => window.removeEventListener(SETTINGS_EVENT, onChange);
  }, [docId]);

  // Right-pane mode (Visualizer / KG / Chat / Flashcards / Feynman) —
  // tab-scoped, sessionStorage backed so a reload restores it.
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>(() => {
    if (typeof window === "undefined") return "visualizer";
    const v = window.sessionStorage.getItem(`getit:${docId}:right-mode`);
    if (
      v === "visualizer" ||
      v === "graph" ||
      v === "mindmap" ||
      v === "chat" ||
      v === "flashcards" ||
      v === "quizzes" ||
      v === "feynman"
    ) {
      return v;
    }
    return "visualizer";
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(`getit:${docId}:right-mode`, rightPaneMode);
    } catch {
      /* noop */
    }
  }, [docId, rightPaneMode]);

  // ── Chat → knowledge-graph evaluation, batched per visit ──────────────
  //
  // The Chat tool no longer triggers an evaluation after every reply. Instead
  // the student can chat freely — many messages, many threads — and we run a
  // SINGLE evaluation pass when they leave the Chat tab (or close the doc),
  // and only if they actually sent something while there. ChatView fires a
  // `getit:chat-sent` event on each successful send; we just track whether one
  // happened since we entered Chat.
  const chatDirtyRef = useRef(false);
  useEffect(() => {
    const onChatSent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { docId?: string } | undefined;
      if (!detail || detail.docId === docId) chatDirtyRef.current = true;
    };
    window.addEventListener("getit:chat-sent", onChatSent);
    return () => window.removeEventListener("getit:chat-sent", onChatSent);
  }, [docId]);

  const flushChatEval = useCallback(
    (useKeepalive = false) => {
      if (!chatDirtyRef.current) return;
      chatDirtyRef.current = false;
      void fetch(`/api/kg/${docId}/evaluate`, {
        method: "POST",
        keepalive: useKeepalive,
      }).catch(() => {});
    },
    [docId],
  );

  // Fire when the student switches AWAY from the Chat tab.
  const prevModeRef = useRef<RightPaneMode>(rightPaneMode);
  useEffect(() => {
    if (prevModeRef.current === "chat" && rightPaneMode !== "chat") {
      flushChatEval();
    }
    prevModeRef.current = rightPaneMode;
  }, [rightPaneMode, flushChatEval]);

  // Fire on unmount too (navigating to Upload/Library, closing the doc) so a
  // chat-and-leave still scores. keepalive lets the request outlive the page.
  useEffect(() => {
    return () => flushChatEval(true);
  }, [flushChatEval]);

  // Start the analysis agents (detection + knowledge graph) and set the
  // auto-visualize budget. Kicked only once the user has passed the pre-flight
  // gate (or on a doc that was already analyzed before). Idempotent server-side.
  const startAnalysis = useCallback(
    (budget: number) => {
      if (!analysisStartedRef.current) {
        analysisStartedRef.current = true;
        void fetch(`/api/kg/${docId}/build`, { method: "POST" }).catch(() => {});
        void fetch(`/api/jobs/detect/${docId}`, { method: "POST" }).catch(() => {});
      }
      setAutoVizBudget(budget);
      setPreflight("done");
      if (budget > 0) {
        void fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vizBudget: budget }),
        }).catch(() => {});
      }
    },
    [docId],
  );

  // ── Bootstrap: doc meta + bump lastOpenedAt + start polling. Generation is
  //    gated behind the pre-flight (see the fresh-check effect below).
  useEffect(() => {
    let cancelled = false;
    // Doc meta — without it the PdfViewer can't render.
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
    // Touch (so library's "last opened" reflects this open).
    void fetch(`/api/doc/${docId}/touch`, { method: "POST" }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // ── Pre-flight decision ───────────────────────────────────────────────
  // A doc that was already analyzed before (has tags / analyzed pages) resumes
  // silently. A fresh doc shows the budget gate; nothing is generated until the
  // user chooses. One check, after meta loads.
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    fetch(`/api/tags/${docId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TagsApiResponse | null) => {
        if (cancelled) return;
        const f = data?.file;
        const started = !!f && ((f.pagesAnalyzed?.length ?? 0) > 0 || (f.tags?.length ?? 0) > 0);
        if (started) startAnalysis(0); // resume — don't auto-spend on new viz
        else setPreflight("show");
      })
      .catch(() => {
        if (!cancelled) setPreflight("show");
      });
    return () => {
      cancelled = true;
    };
  }, [meta, docId, startAnalysis]);

  // ── Auto-visualize within the budget ──────────────────────────────────
  // After consent, kick viz for idle tags up to the chosen budget (counting any
  // already generating/ready). kickedVizRef dedupes across polls.
  useEffect(() => {
    if (autoVizBudget <= 0) return;
    const active = tags.filter((t) => t.generating || t.ready || t.spec).length;
    let slots = autoVizBudget - active;
    if (slots <= 0) return;
    for (const t of tags) {
      if (slots <= 0) break;
      if (t.spec || t.error || t.generating || kickedVizRef.current.has(t.id)) continue;
      kickedVizRef.current.add(t.id);
      slots--;
      void fetch(`/api/jobs/viz/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: t.id }),
      }).catch(() => {});
    }
  }, [tags, autoVizBudget, docId]);

  // ── Polling loop ─────────────────────────────────────────────────────
  //
  // Single source of truth: GET /api/tags/<docId>. Updates `tags`,
  // `pagesAnalyzed`, and the two job-running flags. Cadence speeds up
  // while any background work is in progress and slows down when idle
  // so a doc that's fully prepared doesn't poll itself in the foot.
  const lastSavedAtRef = useRef<number>(0);
  const anyWorkInFlight = detectionRunning || vizQueueRunning;
  useEffect(() => {
    let cancelled = false;
    const pollOnce = async () => {
      try {
        const r = await fetch(`/api/tags/${docId}`, { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as TagsApiResponse;
        if (cancelled) return;
        setDetectionRunning(data.detectionRunning);
        setVizQueueRunning(data.vizQueueRunning);
        const file = data.file;
        if (!file) {
          // Tags file doesn't exist yet — leave local state empty.
          return;
        }
        // Skip re-renders if savedAt hasn't moved (no real change).
        if (file.savedAt === lastSavedAtRef.current) return;
        lastSavedAtRef.current = file.savedAt;
        setTags(file.tags as TagState[]);
        setPagesAnalyzed(new Set(file.pagesAnalyzed));
        setDetectionError(file.detectionError ?? null);
        // Only honor the server's active tag if the user hasn't picked
        // one locally yet — otherwise the server's stale value would
        // override a fresh click.
        setActiveTagId((cur) => cur ?? file.activeTagId);
      } catch {
        /* network blip — try again next tick */
      }
    };
    pollOnce();
    const id = setInterval(
      pollOnce,
      anyWorkInFlight ? POLL_FAST_MS : POLL_IDLE_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [docId, anyWorkInFlight]);

  // Persist activeTagId to the server (it's the one piece of state the
  // viewer still owns end-to-end). Debounced so a quick browse doesn't
  // hammer the API.
  useEffect(() => {
    const handle = setTimeout(() => {
      void fetch(`/api/tags/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeTagId }),
        keepalive: true,
      }).catch(() => {});
    }, 250);
    return () => clearTimeout(handle);
  }, [docId, activeTagId]);

  const docTitle = useMemo(
    () =>
      meta && (FILENAME_TO_TITLE[meta.filename] || meta.filename.replace(/\.pdf$/i, "")),
    [meta],
  );

  // Auto-select the first ready tag when nothing is selected yet.
  useEffect(() => {
    if (activeTagId) return;
    const firstReady = tags.find((t) => t.ready);
    if (firstReady) setActiveTagId(firstReady.id);
  }, [tags, activeTagId]);

  // Clicking a tag: select it + ask the server-side viz queue to
  // generate the spec if we don't have one yet. The server flips
  // `generating: true` immediately, the next poll picks it up.
  const handleTagClick = useCallback(
    (id: string) => {
      setActiveTagId(id);
      // Bring the Visualizer forward no matter which tool is open, so the
      // clicked concept renders (or starts rendering) where the user can see
      // it. Switching mode also runs the normal tab-change side effects —
      // e.g. leaving Chat flushes a knowledge-graph evaluation (see the
      // rightPaneMode effect above) — so it stays fully coherent.
      setRightPaneMode("visualizer");
      const tag = tags.find((t) => t.id === id);
      if (!tag) return;
      if (tag.generating) return; // already in flight — don't double-queue
      if (tag.spec && !tag.error) return; // already rendered — selecting is enough
      // Idle OR previously failed → (re)generate. Clearing any error optimistically
      // marks it generating so the spinner shows at once; this is also the manual
      // retry path after a backend Codex error left the tag idle/errored.
      setTags((prev) =>
        prev.map((t) => (t.id === id ? { ...t, generating: true, error: undefined } : t)),
      );
      void fetch(`/api/jobs/viz/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: id }),
      }).catch(() => {});
    },
    [docId, tags],
  );

  // Visualizer reported a runtime error → ask the server to repair.
  const handleRuntimeError = useCallback(
    (tagId: string, message: string) => {
      // Optimistic flip so the loader appears while the server queues
      // the repair attempt.
      setTags((prev) =>
        prev.map((t) =>
          t.id === tagId
            ? {
                ...t,
                ready: false,
                generating: true,
                lastRuntimeError: message,
              }
            : t,
        ),
      );
      void fetch(`/api/jobs/viz/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId, runtimeError: message }),
      }).catch(() => {});
    },
    [docId],
  );

  // (Auto-visualization is now governed by the pre-flight budget effect above,
  // which caps how many tags generate — replacing the old "generate every idle
  // tag" behavior that could spawn dozens of viz calls unprompted.)

  if (loadError) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 bg-[var(--surface-canvas)] text-[var(--ink-900)]">
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
      <div className="flex flex-1 min-h-0 items-center justify-center bg-[var(--surface-canvas)] text-[var(--ink-500)]">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[var(--accent-600)]" />
        loading document…
      </div>
    );
  }

  const totalPages = meta.numPages;
  const doneCount = pagesAnalyzed.size;
  const tagReadyCount = tags.filter((t) => t.ready).length;
  const tagGeneratingCount = tags.filter((t) => t.generating).length;
  const detecting = detectionRunning && doneCount < totalPages;

  const activeTag = tags.find((t) => t.id === activeTagId) ?? null;
  const activeSpec = activeTag?.spec ?? null;

  // Step through ready visualizations from the reader side (prev/next), so the
  // user can move through them without hunting for each tag in the text.
  const readyVizTags = tags.filter((t) => t.ready && t.spec);
  const readyIndex = readyVizTags.findIndex((t) => t.id === activeTagId);
  const stepViz = (dir: 1 | -1) => {
    if (readyVizTags.length === 0) return;
    const base = readyIndex < 0 ? (dir === 1 ? -1 : 0) : readyIndex;
    const next = (base + dir + readyVizTags.length) % readyVizTags.length;
    setActiveTagId(readyVizTags[next].id);
    setRightPaneMode("visualizer");
    if (focused) setFocused(false); // reveal the pane so the stepped viz is visible
  };

  const truncated =
    docTitle && docTitle.length > 28
      ? `${docTitle.slice(0, 28)}…`
      : docTitle ?? meta.filename;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-[var(--surface-canvas)]">
      {preflight === "show" && (
        <PreflightGate
          numPages={meta.numPages}
          defaultBudget={defaultBudget}
          onConfirm={(n) => startAnalysis(n)}
          onSkip={() => startAnalysis(0)}
        />
      )}
      {/* Top tab bar — Upload + Library pinned on the left, then the
          open-document tab (acts as the active "window"). Clicking
          Upload or Library navigates away, closing this doc tab. */}
      <div className="tab-bar tab-bar--fused shrink-0">
        <TooltipChip tip="Upload a new PDF.">
          <Link href="/" aria-label="Upload" className="tab-item">
            <Upload className="h-3.5 w-3.5 text-[var(--ink-400)]" />
            <span>Upload</span>
          </Link>
        </TooltipChip>
        <TooltipChip tip="Your library of opened PDFs.">
          <Link href="/library" aria-label="Open library" className="tab-item">
            <BookOpen className="h-3.5 w-3.5 text-[var(--ink-400)]" />
            <span>Library</span>
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
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white">
          {/* Surface toggle: Reader (default) ⇄ PDF. Reader theme/typography
              live in the Reader's own "Aa" appearance panel. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5">
            <div className="flex items-center gap-0.5 rounded-lg bg-[var(--surface-sunken)] p-0.5">
              <SurfaceTab active={docView === "reader"} onClick={() => setDocView("reader")} Icon={BookOpenText}>
                Reader
              </SurfaceTab>
              <SurfaceTab active={docView === "pdf"} onClick={() => setDocView("pdf")} Icon={FileText}>
                PDF
              </SurfaceTab>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {readyVizTags.length > 1 && (
                <div className="mr-1 flex items-center gap-0.5 text-[var(--ink-500)]">
                  <button
                    type="button"
                    onClick={() => stepViz(-1)}
                    aria-label="Previous visualization"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[44px] text-center text-[11px] tabular-nums">
                    {readyIndex >= 0 ? readyIndex + 1 : "–"}/{readyVizTags.length} viz
                  </span>
                  <button
                    type="button"
                    onClick={() => stepViz(1)}
                    aria-label="Next visualization"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setFocused((v) => !v)}
                title={focused ? "Exit focused reading" : "Focused reading (hide visualizer)"}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition ${
                  focused
                    ? "bg-[var(--accent-50)] text-[var(--accent-700)]"
                    : "text-[var(--ink-500)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
                }`}
              >
                {focused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {focused ? "Exit focus" : "Focus"}
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            {docView === "reader" ? (
              <ReaderView
                docId={docId}
                pdfUrl={meta.pdfUrl}
                title={docTitle || meta.filename}
                prefs={readerPrefs}
                onPrefsChange={updateReaderPrefs}
                onTextSelect={setGhost}
              />
            ) : (
              <PdfViewer
                pdfUrl={meta.pdfUrl}
                numPages={meta.numPages}
                pageDims={meta.pages.map((p) => ({ width: p.width, height: p.height }))}
                tags={tags}
                activeTagId={activeTagId}
                onTagClick={handleTagClick}
                detecting={detecting}
                onTextSelect={setGhost}
              />
            )}
          </div>
          {ghost && meta && (
            <GhostReader
              docId={docId}
              selection={ghost}
              contextText={meta.pages[ghost.pageIndex]?.text ?? ""}
              onClose={() => setGhost(null)}
            />
          )}
        </div>
        <div
          className={`flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white transition-all duration-300 ${
            focused ? "pointer-events-none w-0 min-w-0 max-w-0 border-0 opacity-0" : "w-[44%] min-w-[420px] max-w-[720px]"
          }`}
          aria-hidden={focused}
        >
          <RightPane
            docId={docId}
            mode={rightPaneMode}
            onModeChange={setRightPaneMode}
            visualizer={{
              spec: activeTag?.generating || activeTag?.error ? null : activeSpec,
              loading:
                activeTag != null &&
                !activeTag.error &&
                (activeTag.generating || !activeTag.spec),
              loadingDetail:
                activeTag?.generating && (activeTag.attempts ?? 0) >= 1
                  ? `repairing — attempt ${(activeTag.attempts ?? 0) + 1} of ${maxRetries + 1}`
                  : undefined,
              onRuntimeError: activeTag
                ? (msg) => handleRuntimeError(activeTag.id, msg)
                : undefined,
              emptyHint: activeTag?.error
                ? "We weren't able to build a working visualization for this concept. Retry below, or pick another tag — most of them work cleanly."
                : tags.length === 0 && detectionError
                  ? `Tag detection stopped — ${detectionError} Switch your AI provider or model in Settings to try again.`
                  : tags.length === 0
                    ? detecting
                      ? "Reading the document — concept tags appear in the text on the left as they're found, then you click a tag to render it here. (The icons above are just a legend of the five visual types.)"
                      : "No tags found yet. Click a colored tag in the document text to render it here — or switch AI provider in Settings if none appear. (The icons above are a legend of the five visual types, not buttons.)"
                    : autoGenerate
                      ? "Click any colored tag in the document to render its concept here."
                      : "Click any tag to generate its visualization. (manual mode — toggle auto-generate in settings)",
              activeTagError: activeTag?.error ?? null,
              onRetry: activeTag ? () => handleTagClick(activeTag.id) : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Segmented tab for the left-panel surface toggle (Reader ⇄ PDF). */
function SurfaceTab({
  active,
  onClick,
  Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
        active
          ? "bg-white text-[var(--ink-900)] shadow-[0_1px_2px_rgba(17,17,19,0.08)]"
          : "text-[var(--ink-500)] hover:text-[var(--ink-900)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/**
 * Visualization agent status pill.
 *
 * Two phases:
 *   • Detection in progress — `pagesDone < pagesTotal`. We show the
 *     page-scan progress (`N/total pages`).
 *   • Detection done — switch to `N/total viz ready`.
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

/** Compact status badge for the knowledge-graph evaluator agent. */
function KGStatusBadge({ docId }: { docId: string }) {
  const [state, setState] = useState<{
    status: "missing" | "building" | "ready" | "error";
    evaluating: boolean;
    evaluationCount: number;
    lastEvaluatedAt: number | null;
    buildError?: string;
  } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
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
        setState({
          status: j.status,
          evaluating: !!j.evaluating,
          evaluationCount: j.evaluationCount,
          lastEvaluatedAt: j.lastEvaluatedAt,
          buildError: j.buildError,
        });
      } catch {
        /* ignore */
      }
    };
    fetchOnce();
    const id = setInterval(
      fetchOnce,
      state && (state.status === "building" || state.evaluating) ? 2500 : 6000,
    );
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, state?.status, state?.evaluating]);

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
    title = "Interact with chat / flashcards / quizzes / feynman to start the evaluator";
  } else if (state.status === "ready" && state.lastEvaluatedAt) {
    icon = <Network className="h-3 w-3 text-emerald-600" />;
    label = `Synced ${humaniseAgo(state.lastEvaluatedAt)}`;
    title = `${state.evaluationCount} evaluation${state.evaluationCount === 1 ? "" : "s"} so far`;
  } else {
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
        Knowledge-graph agent —{" "}
        {title ||
          "tracks per-concept mastery from your chats, flashcards, quizzes and Feynman sessions."}
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
