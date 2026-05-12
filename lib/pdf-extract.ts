/**
 * Server-side PDF text extraction using pdfjs-dist.
 *
 * Returns one record per page containing both the rendered viewport
 * dimensions (so the client can scale tag overlays) and the per-glyph-run
 * text items with their PDF-space positions.
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextItem = {
  /** The text run as PDF.js gave us. */
  str: string;
  /** Bottom-left x coordinate in PDF units (1/72 inch). */
  x: number;
  /** Bottom-left y coordinate in PDF units. */
  y: number;
  /** Run width in PDF units. */
  width: number;
  /** Glyph height in PDF units. */
  height: number;
  /** Whether this run carries a soft EOL break. */
  eol: boolean;
};

export type PdfPage = {
  pageIndex: number; // 0-based
  width: number; // PDF units
  height: number; // PDF units
  items: PdfTextItem[];
  /** Plain text for that page, items joined by their natural spacing. */
  text: string;
};

export type ExtractedPdf = {
  numPages: number;
  pages: PdfPage[];
};

export async function extractPdf(buffer: ArrayBuffer | Uint8Array): Promise<ExtractedPdf> {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const pdf = await getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    // We're already on Node (server-side). Don't try to spawn a Web
    // Worker — in the Next standalone build the worker .mjs is not
    // emitted alongside the main module, and pdfjs falls over with
    // "Setting up fake worker failed". Running in-process is fine for
    // our PDF sizes (textbook samples + user uploads up to ~20 MB).
    disableWorker: true,
  } as Parameters<typeof getDocument>[0]).promise;

  const pages: PdfPage[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: PdfTextItem[] = [];
    const textParts: string[] = [];
    for (const it of tc.items as Array<Record<string, unknown>>) {
      const transform = it.transform as number[];
      // transform = [a, b, c, d, e, f] — scale_x, skew_y, skew_x, scale_y, e=x, f=y
      const x = transform[4];
      const y = transform[5];
      const width = (it.width as number) ?? 0;
      const height = (it.height as number) ?? Math.abs(transform[3]);
      const str = (it.str as string) ?? "";
      const eol = (it.hasEOL as boolean) ?? false;
      items.push({ str, x, y, width, height, eol });
      if (str) textParts.push(str);
      if (eol) textParts.push("\n");
      else if (str) textParts.push(" ");
    }
    pages.push({
      pageIndex: p - 1,
      width: viewport.width,
      height: viewport.height,
      items,
      text: textParts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n\n").trim(),
    });
    page.cleanup();
  }
  pdf.destroy();
  return { numPages: pdf.numPages, pages };
}

/** Find the bounding box of `anchor` (substring of page.text) inside the
 *  per-item positions. Returns the bbox of the LAST occurrence so we can put a
 *  tag right after the matched span. Returns null if no match.
 *
 *  Strategy: walk forward through items concatenating their `str`, track each
 *  item's [start,end) offset in the concatenated text. Then find the substring
 *  position in the joined string and map back. We use the same join scheme as
 *  the page.text so offsets line up.
 */
export function locateAnchor(page: PdfPage, anchor: string): {
  endX: number;
  endY: number;
  fontHeight: number;
} | null {
  const parts: string[] = [];
  const itemRanges: Array<{ start: number; end: number; item: PdfTextItem }> = [];
  for (const item of page.items) {
    if (item.str) {
      const start = parts.join("").length;
      parts.push(item.str);
      const end = start + item.str.length;
      itemRanges.push({ start, end, item });
    }
    if (item.eol) parts.push("\n");
    else if (item.str) parts.push(" ");
  }
  const haystack = parts.join("");
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const normHay = norm(haystack);
  const normNeedle = norm(anchor);
  const idx = normHay.lastIndexOf(normNeedle);
  if (idx < 0) return null;
  // Map normalized-index back to original-index (approximate).
  let nCount = 0;
  let origIdx = 0;
  for (; origIdx < haystack.length; origIdx++) {
    const ch = haystack[origIdx];
    if (/\s/.test(ch)) {
      if (origIdx > 0 && /\S/.test(haystack[origIdx - 1])) nCount++;
    } else {
      if (nCount === idx) break;
      nCount++;
    }
  }
  // Now find the item whose range contains origIdx + needle length.
  const target = Math.min(haystack.length - 1, origIdx + normNeedle.length);
  for (let i = itemRanges.length - 1; i >= 0; i--) {
    const r = itemRanges[i];
    if (target >= r.start && target <= r.end) {
      const it = r.item;
      // approximate "end of this run": x + width on the right, y at baseline
      return {
        endX: it.x + it.width,
        endY: it.y,
        fontHeight: it.height || 11,
      };
    }
  }
  // Fallback: use last item's end
  const last = itemRanges[itemRanges.length - 1];
  if (!last) return null;
  return {
    endX: last.item.x + last.item.width,
    endY: last.item.y,
    fontHeight: last.item.height || 11,
  };
}
