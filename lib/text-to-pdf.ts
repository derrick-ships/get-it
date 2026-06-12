/**
 * Server-side .txt / .md → PDF conversion using pdfkit.
 *
 * Plain-text and Markdown uploads are converted to a real PDF at upload
 * time so the rest of the pipeline — extraction, quality gates, the
 * canvas viewer, tag anchoring, every study tool — runs on them
 * completely unchanged. The converted PDF is round-tripped through
 * extractPdf(), so rendered pixels and glyph coordinates always agree.
 *
 * Layout constants mirror scripts/generate-sample-pdfs.ts renderDoc()
 * so converted documents have the same text density as the curated
 * samples (~3,500 chars per A4 page).
 *
 * pdfkit's built-in fonts (Helvetica / Times / Courier) only encode
 * WinAnsi (CP1252). Characters outside that set are NFKD-decomposed to
 * strip diacritics where possible; anything still unencodable becomes
 * "?" and is counted, so the upload route can refuse files that would
 * lose too much content (e.g. CJK or Cyrillic text).
 */

import PDFDocument from "pdfkit";
import { lexer, type Token, type Tokens } from "marked";
import { MAX_PDF_PAGES } from "./pdf-extract";

export type TextKind = "txt" | "md";

/** Rough A4-page capacity at the layout below — used only for the cheap
 *  pre-conversion size gate in the upload route. */
export const CHARS_PER_PAGE_ESTIMATE = 3000;
/** Character budget equivalent of the MAX_PDF_PAGES ceiling. */
export const MAX_TEXT_CHARS = MAX_PDF_PAGES * CHARS_PER_PAGE_ESTIMATE;
/** Raw upload cap for text files — far beyond any real study document. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export type TextToPdfResult = {
  pdf: Buffer;
  /** Characters that couldn't be encoded in WinAnsi and became "?". */
  replacedChars: number;
  /** Total characters examined by the sanitizer. */
  totalChars: number;
};

// ── WinAnsi sanitation ──────────────────────────────────────────────────

/** CP1252 codepoints above 0xFF (curly quotes, dashes, €, ™, …). */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isWinAnsi(cp: number): boolean {
  return cp <= 0xff || WINANSI_EXTRAS.has(cp);
}

function sanitizeWinAnsi(input: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = "";
  for (const ch of input.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (isWinAnsi(cp)) {
      out += ch;
      continue;
    }
    // Try to keep readability: decompose and drop combining marks
    // (e.g. "ő" → "o"). Counts as kept — the letter survives.
    const stripped = ch.normalize("NFKD").replace(/\p{M}+/gu, "");
    if (
      stripped.length > 0 &&
      [...stripped].every((c) => isWinAnsi(c.codePointAt(0)!))
    ) {
      out += stripped;
    } else {
      out += "?";
      replaced++;
    }
  }
  return { text: out, replaced };
}

// ── Layout (cloned from scripts/generate-sample-pdfs.ts renderDoc) ─────

const MARGIN = 72;
const CONTENT_WIDTH = 451; // A4 (595pt) minus 72pt margins
const BODY_FONT = "Times-Roman";
const BODY_SIZE = 11.5;
const BODY_COLOR = "#1e293b";
const HEADING_COLOR = "#0f172a";
const PAGE_BREAK_Y = 700;

function ensureRoom(doc: PDFKit.PDFDocument): void {
  if (doc.y > PAGE_BREAK_Y) doc.addPage();
}

function bodyFont(doc: PDFKit.PDFDocument): PDFKit.PDFDocument {
  return doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(BODY_COLOR);
}

function paragraph(doc: PDFKit.PDFDocument, text: string): void {
  if (!text.trim()) return;
  ensureRoom(doc);
  bodyFont(doc).text(text, {
    align: "justify",
    paragraphGap: 8,
    lineGap: 2.5,
  });
}

function rule(doc: PDFKit.PDFDocument): void {
  ensureRoom(doc);
  doc
    .strokeColor("#cbd5e1")
    .lineWidth(0.7)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + CONTENT_WIDTH, doc.y)
    .stroke();
  doc.moveDown(0.8);
}

// ── Markdown rendering (block tokens only, inline formatting flattened) ─

/** Collapse inline tokens (bold/italic/links/code spans…) to plain text. */
function flattenInline(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  let out = "";
  for (const t of tokens) {
    switch (t.type) {
      case "br":
        out += "\n";
        break;
      case "image":
        out += (t as Tokens.Image).text;
        break;
      case "html":
        break; // raw inline HTML is dropped
      default: {
        const children = (t as { tokens?: Token[] }).tokens;
        if (children && children.length > 0) out += flattenInline(children);
        else out += (t as { text?: string }).text ?? (t as { raw?: string }).raw ?? "";
      }
    }
  }
  return out;
}

const HEADING_SIZES: Record<number, number> = { 1: 20, 2: 15, 3: 12.5 };

function renderList(
  doc: PDFKit.PDFDocument,
  list: Tokens.List,
  depth: number,
): void {
  const start = typeof list.start === "number" ? list.start : 1;
  list.items.forEach((item, i) => {
    const marker = list.ordered ? `${start + i}.` : "•";
    const nested = (item.tokens ?? []).filter((t) => t.type === "list");
    const text = flattenInline(
      (item.tokens ?? []).filter((t) => t.type !== "list"),
    ).trim();
    if (text) {
      ensureRoom(doc);
      const x = MARGIN + depth * 16;
      bodyFont(doc).text(`${marker}  ${text}`, x, doc.y, {
        width: CONTENT_WIDTH - depth * 16,
        lineGap: 2.5,
        paragraphGap: 3,
      });
      doc.x = MARGIN;
    }
    for (const sub of nested) renderList(doc, sub as Tokens.List, depth + 1);
  });
  if (depth === 0) doc.moveDown(0.4);
}

function renderMarkdown(doc: PDFKit.PDFDocument, tokens: Token[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const t = token as Tokens.Heading;
        ensureRoom(doc);
        doc
          .font("Helvetica-Bold")
          .fontSize(HEADING_SIZES[t.depth] ?? 12.5)
          .fillColor(HEADING_COLOR)
          .text(flattenInline(t.tokens) || t.text);
        doc.moveDown(0.4);
        break;
      }
      case "paragraph":
        paragraph(doc, flattenInline((token as Tokens.Paragraph).tokens));
        break;
      case "list":
        renderList(doc, token as Tokens.List, 0);
        break;
      case "code": {
        const t = token as Tokens.Code;
        ensureRoom(doc);
        doc
          .font("Courier")
          .fontSize(9)
          .fillColor("#334155")
          .text(t.text, { lineGap: 1.5, paragraphGap: 8 });
        break;
      }
      case "blockquote": {
        const t = token as Tokens.Blockquote;
        const text = flattenInline(t.tokens).trim();
        if (!text) break;
        ensureRoom(doc);
        doc
          .font("Times-Italic")
          .fontSize(BODY_SIZE)
          .fillColor("#475569")
          .text(text, MARGIN + 24, doc.y, {
            width: CONTENT_WIDTH - 24,
            lineGap: 2.5,
            paragraphGap: 8,
          });
        doc.x = MARGIN;
        break;
      }
      case "table": {
        const t = token as Tokens.Table;
        ensureRoom(doc);
        doc.font("Courier").fontSize(9).fillColor(BODY_COLOR);
        const row = (cells: Tokens.TableCell[]) =>
          cells.map((c) => flattenInline(c.tokens)).join("  |  ");
        doc.text(row(t.header), { lineGap: 1.5 });
        for (const r of t.rows) doc.text(row(r), { lineGap: 1.5 });
        doc.moveDown(0.6);
        break;
      }
      case "hr":
        rule(doc);
        break;
      case "space":
        doc.moveDown(0.3);
        break;
      case "html":
        break; // raw HTML blocks are dropped
      default: {
        const text = (token as { text?: string }).text;
        if (text) paragraph(doc, text);
      }
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────

export async function textToPdf(
  raw: string,
  opts: { kind: TextKind; title?: string },
): Promise<TextToPdfResult> {
  // Strip BOM, normalize line endings.
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const { text, replaced } = sanitizeWinAnsi(normalized);

  const title = (opts.title ?? "").replace(/\.(txt|md|markdown)$/i, "");

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: title || "Text document",
      Producer: "Get It. Text Converter",
    },
    bufferPages: true,
    pdfVersion: "1.7",
    tagged: true,
    displayTitle: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Title header — mirrors the sample PDFs' title page so converted
  // docs read as first-class documents in the viewer.
  if (title) {
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor(HEADING_COLOR)
      .text(title);
    doc.moveDown(0.8);
    rule(doc);
  }

  if (opts.kind === "md") {
    renderMarkdown(doc, lexer(text));
  } else {
    // Plain text: paragraphs separated by blank lines.
    for (const para of text.split(/\n{2,}/)) {
      paragraph(doc, para.replace(/\n/g, " ").trim());
    }
  }

  // Page numbers, same style as the sample generator. Writing below the
  // bottom margin would trigger pdfkit's auto page break and append a
  // blank page — zero the margin for the footer pass to keep it inert.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#94a3b8")
      .text(`page ${i + 1} of ${range.count}`, MARGIN, 800, {
        align: "center",
        width: CONTENT_WIDTH,
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return { pdf: await finished, replacedChars: replaced, totalChars: text.length };
}
