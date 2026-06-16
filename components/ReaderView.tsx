"use client";

/**
 * Reader view — a Readwise-style reading surface that's the default left panel
 * (the raw PDF is one toggle away). Renders from already-extracted content, so
 * selection is real DOM text and the Ghostreader works reliably.
 *
 *   • md / txt → the ORIGINAL text (markdown rendered with `marked`).
 *   • pdf → per-page clean text reflowed into a column, with figures preserved
 *     (no-text bands cropped from the rendered page, lazily; blanks skipped).
 *
 * Adds: an article hero (title · source · reading time), an AI summary card
 * ("Summarized by Ghostreader", auto when a provider is connected), a reading
 * progress bar + %, a Contents (TOC) slide-over with scroll-spy, and a
 * "Customize appearance" panel (theme / typeface / size / spacing / width).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, List, Loader2, Sparkles } from "lucide-react";
import { marked } from "marked";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { reflowPage, type Band, type ReflowPageInput } from "@/lib/reader-reflow";
import {
  WIDTH_CH,
  readingTimeMinutes,
  resolveTheme,
  slugify,
  type ReaderPrefs,
} from "@/lib/reader-prefs";
import ReaderAppearance from "@/components/reader/ReaderAppearance";
import ReaderContents, { type TocItem } from "@/components/reader/ReaderContents";
import { HIGHLIGHT_EVENT } from "@/components/GhostReader";

/** Wrap the first single-text-node occurrence of each saved highlight in a
 *  <mark> so it stays visibly highlighted across reloads. Single-node matches
 *  cover the common case (a sentence within one reflowed paragraph). */
function markHighlights(container: HTMLElement, texts: string[]) {
  for (const raw of texts) {
    const needle = raw.trim();
    if (needle.length < 4) continue;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = (node as Text).parentElement;
      if (!el || el.closest("mark.reader-highlight")) continue;
      const idx = (node.textContent ?? "").indexOf(needle);
      if (idx < 0) continue;
      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const mark = document.createElement("mark");
        mark.className = "reader-highlight";
        range.surroundContents(mark);
      } catch {
        /* spans multiple nodes — skip */
      }
      break;
    }
  }
}

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

type SourceMeta = {
  filename: string;
  sourceType: "pdf" | "txt" | "md";
  uploadedAt: number;
  numPages: number;
};
type SourceResponse =
  | { kind: "md" | "txt"; content: string; meta?: SourceMeta }
  | { kind: "pdf"; pages: ReflowPageInput[]; meta?: SourceMeta };

const SOURCE_LABEL: Record<SourceMeta["sourceType"], string> = {
  pdf: "PDF",
  md: "Markdown",
  txt: "Text",
};

/** True when a crop is essentially uniform background (a page margin), so the
 *  reader can skip it. Samples ~20k pixels and compares against the corner. */
function isMostlyBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  const total = data.length / 4;
  const step = 4 * Math.max(1, Math.floor(total / 20000));
  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];
  let sampled = 0;
  let nonBg = 0;
  for (let i = 0; i < data.length; i += step) {
    sampled++;
    if (Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB) > 24) {
      nonBg++;
    }
  }
  return sampled === 0 || nonBg / sampled < 0.005;
}

// ── Figure (lazy raster crop) ────────────────────────────────────────────────

function FigureBand({
  pdf,
  pageIndex,
  pageHeight,
  band,
}: {
  pdf: PDFDocumentProxy | null;
  pageIndex: number;
  pageHeight: number;
  band: Band;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pdf || src || failed) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        (async () => {
          try {
            const page = await pdf.getPage(pageIndex + 1);
            const scale = 2;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("no 2d ctx");
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
            // PDF units (bottom-left) → canvas px (top-down).
            const cropTop = Math.max(0, Math.floor((pageHeight - band.y1) * scale));
            const cropH = Math.min(
              canvas.height - cropTop,
              Math.ceil((band.y1 - band.y0) * scale),
            );
            if (cropH <= 2) throw new Error("empty band");
            const out = document.createElement("canvas");
            out.width = canvas.width;
            out.height = cropH;
            const octx = out.getContext("2d");
            if (!octx) throw new Error("no 2d ctx");
            octx.drawImage(canvas, 0, cropTop, canvas.width, cropH, 0, 0, canvas.width, cropH);
            if (isMostlyBlank(octx, out.width, out.height)) throw new Error("blank band");
            setSrc(out.toDataURL("image/png"));
            page.cleanup();
          } catch {
            setFailed(true);
          }
        })();
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pdf, pageIndex, pageHeight, band, src, failed]);

  if (failed) return null;

  return (
    <div ref={ref} className="my-5 flex justify-center">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Figure from page ${pageIndex + 1}`}
          className="max-w-full rounded-lg border border-[var(--reader-rule)]"
        />
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-[var(--reader-rule)] text-[var(--reader-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}

// ── Reader ────────────────────────────────────────────────────────────────

type SummaryState = "idle" | "loading" | "done" | "hidden";

export default function ReaderView({
  docId,
  pdfUrl,
  title,
  prefs,
  onPrefsChange,
  onTextSelect,
}: {
  docId: string;
  pdfUrl: string;
  title: string;
  prefs: ReaderPrefs;
  onPrefsChange: (p: ReaderPrefs) => void;
  onTextSelect: (sel: { text: string; rect: DOMRect; pageIndex: number }) => void;
}) {
  const [data, setData] = useState<SourceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Resolve theme (auto → OS preference, live).
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark =
    prefs.theme === "dark" || (prefs.theme === "auto" && systemDark);

  // ── Source ──
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/doc/${docId}/source`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as SourceResponse;
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const pdfPages = useMemo(
    () =>
      data?.kind === "pdf" ? data.pages.map((p) => ({ page: p, ...reflowPage(p) })) : [],
    [data],
  );
  const hasFigures = useMemo(() => pdfPages.some((p) => p.bands.length > 0), [pdfPages]);

  useEffect(() => {
    if (!hasFigures) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    getDocument(pdfUrl)
      .promise.then((d) => {
        if (cancelled) {
          d.destroy();
          return;
        }
        doc = d;
        setPdf(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (doc) doc.destroy();
    };
  }, [hasFigures, pdfUrl]);

  // ── Hero metadata + reading time ──
  const meta = data?.meta;
  const bodyText = useMemo(() => {
    if (!data) return "";
    return data.kind === "pdf" ? data.pages.map((p) => p.text).join(" ") : data.content;
  }, [data]);
  const readingMin = useMemo(() => (bodyText ? readingTimeMinutes(bodyText) : 0), [bodyText]);
  const dateStr = useMemo(
    () =>
      meta?.uploadedAt
        ? new Date(meta.uploadedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "",
    [meta?.uploadedAt],
  );

  // ── Selection → Ghostreader ──
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (text.length < 2) return;
    const container = containerRef.current;
    if (!container || !sel.anchorNode || !container.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    let node: Node | null = sel.anchorNode;
    let pageIndex = 0;
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.page != null) {
        pageIndex = Number(node.dataset.page) || 0;
        break;
      }
      node = node.parentNode;
    }
    onTextSelect({ text, rect, pageIndex });
  }, [onTextSelect]);

  // ── Reading progress + scroll restore ──
  const [pct, setPct] = useState(0);
  const ticking = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const max = el.scrollHeight - el.clientHeight;
      setPct(max > 0 ? (el.scrollTop / max) * 100 : 0);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          sessionStorage.setItem(`getit:${docId}:reader-scroll`, String(el.scrollTop));
        } catch {
          /* noop */
        }
      }, 300);
    });
  }, [docId]);

  useEffect(() => {
    if (!data) return;
    const el = scrollRef.current;
    if (!el) return;
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(`getit:${docId}:reader-scroll`) || "0");
    } catch {
      /* noop */
    }
    if (saved > 0) {
      const t = setTimeout(() => {
        el.scrollTop = saved;
      }, 90);
      return () => clearTimeout(t);
    }
  }, [data, docId]);

  // ── Table of contents (built from rendered headings) + scroll-spy ──
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !data) return;
    // Content headings only — never the hero title (also an <h1>).
    const headings = (Array.from(c.querySelectorAll("h1,h2,h3")) as HTMLElement[]).filter(
      (h) => !h.closest(".reader-hero"),
    );
    const seen = new Map<string, number>();
    const items: TocItem[] = headings
      .map((h) => {
        const text = (h.textContent || "").trim();
        if (!h.id) {
          const base = slugify(text);
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          h.id = n ? `${base}-${n}` : base;
        }
        return { id: h.id, text, level: Number(h.tagName.slice(1)) || 2 };
      })
      .filter((it) => it.text.length > 0);
    setToc(items);
    if (items.length < 2) {
      setActiveId(null);
      return;
    }
    const root = scrollRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActiveId((visible[0].target as HTMLElement).id);
      },
      { root, rootMargin: "-8% 0px -75% 0px", threshold: 0 },
    );
    headings.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [data, pdfPages]);

  const jumpTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // ── AI summary (auto when a provider is connected; cached) ──
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryState, setSummaryState] = useState<SummaryState>("idle");
  const [summaryOpen, setSummaryOpen] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSummaryState("idle");
    (async () => {
      try {
        const cached = await (await fetch(`/api/doc/${docId}/summary`)).json();
        if (cancelled) return;
        if (cached?.summary) {
          setSummary(cached.summary);
          setSummaryState("done");
          return;
        }
      } catch {
        /* fall through */
      }
      let ready = false;
      try {
        const st = await (await fetch("/api/providers/status", { cache: "no-store" })).json();
        ready =
          st.provider === "codex" ||
          (st.provider === "openrouter" && st.openrouter?.ready) ||
          (st.provider === "ollama" && st.ollama?.ready);
      } catch {
        /* assume not ready */
      }
      if (cancelled) return;
      if (!ready) {
        setSummaryState("hidden");
        return;
      }
      setSummaryState("loading");
      try {
        const gen = await fetch(`/api/doc/${docId}/summary`, { method: "POST" });
        const gj = await gen.json();
        if (cancelled) return;
        if (gen.ok && gj.summary) {
          setSummary(gj.summary);
          setSummaryState("done");
        } else {
          setSummaryState("hidden");
        }
      } catch {
        if (!cancelled) setSummaryState("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // ── Saved highlights — fetch + re-mark in the prose ──
  const [highlightTexts, setHighlightTexts] = useState<string[]>([]);
  const fetchHighlights = useCallback(() => {
    fetch(`/api/highlights/${docId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { highlights: [] }))
      .then((j: { highlights?: { text: string }[] }) =>
        setHighlightTexts((j.highlights ?? []).map((h) => h.text)),
      )
      .catch(() => {});
  }, [docId]);
  useEffect(() => {
    fetchHighlights();
    const onAdded = (e: Event) => {
      const detail = (e as CustomEvent).detail as { docId?: string } | undefined;
      if (!detail || detail.docId === docId) fetchHighlights();
    };
    window.addEventListener(HIGHLIGHT_EVENT, onAdded);
    return () => window.removeEventListener(HIGHLIGHT_EVENT, onAdded);
  }, [docId, fetchHighlights]);
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !data || highlightTexts.length === 0) return;
    markHighlights(c, highlightTexts);
  }, [data, pdfPages, highlightTexts]);

  // ── Panels ──
  const [showAppearance, setShowAppearance] = useState(false);
  const [showContents, setShowContents] = useState(false);

  const rootStyle = {
    "--reader-font-size": `${prefs.fontSize}px`,
    "--reader-line-height": String(prefs.lineHeight),
    "--reader-measure": `${WIDTH_CH[prefs.width]}ch`,
  } as React.CSSProperties;

  return (
    <div className={`reader-root relative ${dark ? "dark" : ""}`} style={rootStyle}>
      {/* Toolbar: progress line + appearance + contents + % read */}
      <div className="reader-toolbar">
        <div className="reader-progress">
          <div className="reader-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <button
          type="button"
          className="reader-tool-btn"
          onClick={() => setShowAppearance((v) => !v)}
          title="Customize appearance"
        >
          <span className="text-[13px] font-semibold leading-none">Aa</span>
        </button>
        {toc.length >= 2 && (
          <button
            type="button"
            className="reader-tool-btn"
            onClick={() => setShowContents(true)}
            title="Contents"
          >
            <List className="h-3.5 w-3.5" />
            Contents
          </button>
        )}
        <span className="reader-pct">{Math.round(pct)}%</span>
      </div>

      <div ref={scrollRef} className="reader-surface" onScroll={onScroll}>
        <div
          ref={containerRef}
          onMouseUp={handleMouseUp}
          data-typeface={prefs.typeface}
          className="reader-prose px-7 py-8"
        >
          {error && (
            <p className="text-[13px] text-rose-500">
              Couldn’t load the reader ({error}). Switch to the PDF view above.
            </p>
          )}
          {!data && !error && (
            <div className="flex items-center gap-2 py-10 text-[var(--reader-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> preparing reader…
            </div>
          )}

          {data && (
            <header className="reader-hero">
              <div className="reader-hero-blur" />
              {meta && <p className="reader-hero-source">{SOURCE_LABEL[meta.sourceType]}</p>}
              <h1 className="reader-hero-title">{title}</h1>
              <p className="reader-hero-meta">
                {[
                  readingMin ? `${readingMin} min read` : "",
                  meta && meta.sourceType === "pdf" && meta.numPages
                    ? `${meta.numPages} page${meta.numPages === 1 ? "" : "s"}`
                    : "",
                  dateStr,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <hr className="reader-hero-rule" />
            </header>
          )}

          {data && summaryState === "loading" && (
            <div className="reader-summary flex items-center gap-2 text-[13px] text-[var(--reader-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Summarizing…
            </div>
          )}
          {data && summaryState === "done" && summary && (
            <div className="reader-summary">
              <button
                type="button"
                onClick={() => setSummaryOpen((v) => !v)}
                className="mb-1 flex w-full items-center justify-between gap-2"
              >
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--reader-accent)" }}>
                  <Sparkles className="h-3.5 w-3.5" /> Summary
                </span>
                <ChevronDown
                  className="h-4 w-4 transition-transform"
                  style={{ transform: summaryOpen ? "none" : "rotate(-90deg)", color: "var(--reader-muted)" }}
                />
              </button>
              {summaryOpen && (
                <>
                  <p className="reader-summary-body">{summary}</p>
                  <p className="reader-summary-label">Summarized by Ghostreader</p>
                </>
              )}
            </div>
          )}

          {data?.kind === "md" && (
            <div
              className="reader-md"
              // Local, user-supplied markdown rendered for reading.
              dangerouslySetInnerHTML={{ __html: marked.parse(data.content, { async: false }) as string }}
            />
          )}

          {data?.kind === "txt" &&
            data.content.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="reader-para whitespace-pre-wrap">
                {para}
              </p>
            ))}

          {data?.kind === "pdf" &&
            pdfPages.map(({ page, blocks, bands }) => {
              const sortedBands = [...bands].sort((a, b) => b.y1 - a.y1);
              const rendered: React.ReactNode[] = [];
              let bandIdx = 0;
              const flushBandsAbove = (yTop: number) => {
                while (bandIdx < sortedBands.length && sortedBands[bandIdx].y0 >= yTop - 1) {
                  const b = sortedBands[bandIdx];
                  rendered.push(
                    <FigureBand
                      key={`fig-${page.pageIndex}-${bandIdx}`}
                      pdf={pdf}
                      pageIndex={page.pageIndex}
                      pageHeight={page.height}
                      band={b}
                    />,
                  );
                  bandIdx++;
                }
              };
              blocks.forEach((blk, i) => {
                flushBandsAbove(blk.yTop);
                if (blk.kind === "heading") {
                  rendered.push(
                    blk.level === 2 ? (
                      <h2 key={i} className="reader-h2">
                        {blk.text}
                      </h2>
                    ) : (
                      <h3 key={i} className="reader-h3">
                        {blk.text}
                      </h3>
                    ),
                  );
                } else {
                  rendered.push(
                    <p key={i} className="reader-para">
                      {blk.text}
                    </p>,
                  );
                }
              });
              while (bandIdx < sortedBands.length) {
                const b = sortedBands[bandIdx];
                rendered.push(
                  <FigureBand
                    key={`fig-${page.pageIndex}-${bandIdx}`}
                    pdf={pdf}
                    pageIndex={page.pageIndex}
                    pageHeight={page.height}
                    band={b}
                  />,
                );
                bandIdx++;
              }
              return (
                <section key={page.pageIndex} data-page={page.pageIndex}>
                  {rendered}
                </section>
              );
            })}
        </div>
      </div>

      {showAppearance && (
        <ReaderAppearance prefs={prefs} onChange={onPrefsChange} onClose={() => setShowAppearance(false)} />
      )}
      {showContents && (
        <ReaderContents
          items={toc}
          activeId={activeId}
          onJump={(id) => {
            jumpTo(id);
            setShowContents(false);
          }}
          onClose={() => setShowContents(false)}
        />
      )}
    </div>
  );
}
