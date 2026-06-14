"use client";

/**
 * Reader view — a clean, reflowable reading surface that's the default left
 * panel (the raw PDF is one toggle away). It renders from content the app
 * already extracted, so text selection is real DOM text and the Ghostreader
 * works reliably (the PDF text-layer drift is irrelevant here).
 *
 *   • md / txt → the ORIGINAL text (markdown rendered with `marked`, so
 *     headings/lists/images survive).
 *   • pdf → per-page clean text reflowed into a comfortable column, with
 *     figures preserved: vertical bands with no text are cropped from the
 *     rendered page and inlined (lazily, per page, so big docs stay fast). No
 *     figure is ever dropped; on any extraction error a page degrades to text.
 *
 * Selection is reported via onTextSelect using the same {text, rect, pageIndex}
 * shape the PdfViewer emits, so the viewer's GhostReader wiring is unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { marked } from "marked";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { reflowPage, type Band, type ReflowPageInput } from "@/lib/reader-reflow";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

export type ReaderTheme = "light" | "dark";

type SourceResponse =
  | { kind: "md" | "txt"; content: string }
  | { kind: "pdf"; pages: ReflowPageInput[] };

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
            // Drop essentially-blank crops (page margins the gap heuristic
            // over-proposes) so the reader never shows empty figure boxes.
            // Real figures have ink; a blank margin is ~uniform background.
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

export default function ReaderView({
  docId,
  pdfUrl,
  theme,
  onTextSelect,
}: {
  docId: string;
  pdfUrl: string;
  theme: ReaderTheme;
  onTextSelect: (sel: { text: string; rect: DOMRect; pageIndex: number }) => void;
}) {
  const [data, setData] = useState<SourceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
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
      data?.kind === "pdf"
        ? data.pages.map((p) => ({ page: p, ...reflowPage(p) }))
        : [],
    [data],
  );
  const hasFigures = useMemo(() => pdfPages.some((p) => p.bands.length > 0), [pdfPages]);

  // Load the PDF document only when there are figures to crop.
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
    // Nearest [data-page] ancestor → page index (md/txt = single page 0).
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

  return (
    <div className={`reader-surface h-full overflow-y-auto ${theme === "dark" ? "dark" : ""}`}>
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="reader-prose mx-auto max-w-[68ch] px-7 py-10"
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

        {data?.kind === "md" && (
          <div
            className="reader-md"
            // Local, user-supplied markdown rendered for reading.
            dangerouslySetInnerHTML={{ __html: marked.parse(data.content, { async: false }) as string }}
          />
        )}

        {data?.kind === "txt" &&
          data.content
            .split(/\n{2,}/)
            .map((para, i) => (
              <p key={i} className="reader-para whitespace-pre-wrap">
                {para}
              </p>
            ))}

        {data?.kind === "pdf" &&
          pdfPages.map(({ page, blocks, bands }) => {
            // Sort bands top-to-bottom (descending y) so they interleave in
            // reading order; render each band before the block beneath it.
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
            // Any remaining bands (below the last block).
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
  );
}
