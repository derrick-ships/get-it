/**
 * Pure PDF→reading-flow reflow used by the Reader view. Kept dependency-free
 * (no React, no pdfjs) so it can be unit-tested directly.
 *
 * Groups extracted text runs into lines (shared baseline), lines into
 * paragraphs (vertical gaps), flags clearly-larger short lines as headings,
 * and reports figure bands — vertical regions with no text, taller than a
 * fraction of the page, which the reader crops from the rendered page image.
 *
 * Coordinates are PDF units, bottom-left origin: a run covers y..y+height, so a
 * larger y is higher on the page.
 */

export type ReflowItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  eol: boolean;
};

export type ReflowPageInput = {
  pageIndex: number;
  width: number;
  height: number;
  text: string;
  items: ReflowItem[];
};

export type Block = {
  kind: "para" | "heading";
  level?: number;
  text: string;
  yTop: number;
  yBottom: number;
};

export type Band = { y0: number; y1: number };

/** A no-text band taller than this fraction of the page height is a figure. */
export const FIGURE_MIN_FRAC = 0.1;

export function reflowPage(page: ReflowPageInput): { blocks: Block[]; bands: Band[] } {
  const items = page.items.filter((it) => it.str.trim().length > 0);
  if (items.length === 0) return { blocks: [], bands: [] };

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; height: number; items: ReflowItem[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(it.height, last.height) * 0.6) {
      last.items.push(it);
      last.height = Math.max(last.height, it.height);
    } else {
      lines.push({ y: it.y, height: it.height, items: [it] });
    }
  }

  const lineObjs = lines
    .map((l) => {
      const xs = [...l.items].sort((a, b) => a.x - b.x);
      let text = "";
      for (let i = 0; i < xs.length; i++) {
        const cur = xs[i];
        if (i > 0) {
          const prev = xs[i - 1];
          const gap = cur.x - (prev.x + prev.width);
          if (gap > prev.height * 0.25 && !/\s$/.test(text) && !/^\s/.test(cur.str)) text += " ";
        }
        text += cur.str;
      }
      return {
        text: text.replace(/\s+/g, " ").trim(),
        height: l.height,
        top: l.y + l.height,
        bottom: l.y,
      };
    })
    .filter((l) => l.text.length > 0);

  if (lineObjs.length === 0) return { blocks: [], bands: [] };

  const heights = lineObjs.map((l) => l.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;

  const blocks: Block[] = [];
  let para: { lines: typeof lineObjs } | null = null;
  const flush = () => {
    if (!para) return;
    const text = para.lines.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    blocks.push({
      kind: "para",
      text,
      yTop: Math.max(...para.lines.map((l) => l.top)),
      yBottom: Math.min(...para.lines.map((l) => l.bottom)),
    });
    para = null;
  };

  for (let i = 0; i < lineObjs.length; i++) {
    const ln = lineObjs[i];
    const prev = lineObjs[i - 1];
    const isHeading = ln.height > median * 1.3 && ln.text.length <= 90;
    const bigGap = prev ? prev.bottom - ln.top > median * 1.1 : false;
    if (isHeading) {
      flush();
      blocks.push({
        kind: "heading",
        level: ln.height > median * 1.8 ? 2 : 3,
        text: ln.text,
        yTop: ln.top,
        yBottom: ln.bottom,
      });
      continue;
    }
    if (!para || bigGap) {
      flush();
      para = { lines: [ln] };
    } else {
      para.lines.push(ln);
    }
  }
  flush();

  const bands: Band[] = [];
  const minH = page.height * FIGURE_MIN_FRAC;
  const topMost = Math.max(...blocks.map((b) => b.yTop));
  const bottomMost = Math.min(...blocks.map((b) => b.yBottom));
  if (page.height - topMost > minH) bands.push({ y0: topMost, y1: page.height });
  for (let i = 1; i < blocks.length; i++) {
    const gap = blocks[i - 1].yBottom - blocks[i].yTop;
    if (gap > minH) bands.push({ y0: blocks[i].yTop, y1: blocks[i - 1].yBottom });
  }
  if (bottomMost > minH) bands.push({ y0: 0, y1: bottomMost });

  return { blocks, bands };
}
