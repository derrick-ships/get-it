/**
 * POST /api/upload
 *   multipart/form-data:
 *     - file: <PDF / .txt / .md blob>  (when uploading from the user's machine)
 *     - sample: <name>        (when picking one of /public/pdfs/<name>.pdf)
 *
 * .txt and .md uploads are converted to a PDF with lib/text-to-pdf so the
 * whole downstream pipeline (extraction, viewer, tag anchoring, study
 * tools) runs on them unchanged; the raw text bytes are kept alongside
 * at original.<ext>.
 *
 * Returns: { docId, numPages, pages: [{ pageIndex, width, height, text }], pdfUrl }
 *
 * Sample idempotency: clicking the same sample twice returns the same
 * docId so the user's KG / chats / flashcards / quizzes / feynman sessions
 * survive a back-and-forth.
 * Real uploads always mint a new docId — students who genuinely re-upload
 * the same file get a new entry and can delete duplicates from Library.
 */

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  extractPdf,
  assessPdfQuality,
  PdfUnsupportedError,
  MAX_PDF_PAGES,
  type ExtractedPdf,
  type PdfRejectReason,
  type PdfQualityStats,
} from "@/lib/pdf-extract";
import {
  textToPdf,
  MAX_TEXT_BYTES,
  MAX_TEXT_CHARS,
  CHARS_PER_PAGE_ESTIMATE,
  type TextKind,
} from "@/lib/text-to-pdf";
import { ensureDocDir, originalPath, pdfPath } from "@/lib/paths";
import { getDoc, newDocId, saveDoc } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAMPLE_NAME_TO_DOC_ID: Record<string, string> = {
  anatomy: "sample-anatomy",
  physics: "sample-physics",
  costituzione: "sample-costituzione",
  calculus: "sample-calculus",
  chemistry: "sample-chemistry",
};

type SourceKind = "pdf" | TextKind;

/** Map the (sanitized) filename to how we'll ingest it. */
function kindOf(filename: string): SourceKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  return null;
}

/** User-facing copy for every rejection reason. Coherent voice across the
 *  whole gate so the UploadCard alert reads the same regardless of cause.
 *  Text uploads hit the same gates after conversion, so the copy drops the
 *  PDF-specific framing for them. */
function rejectionMessage(
  reason: PdfRejectReason,
  stats?: PdfQualityStats,
  kind: SourceKind = "pdf",
): string {
  if (kind !== "pdf") {
    switch (reason) {
      case "too_many_pages":
        return `This file comes out to ${stats?.numPages ?? "too many"} pages of text. Get It. supports documents up to ${MAX_PDF_PAGES} pages — try a single chapter or a shorter file.`;
      case "no_text":
        return "This file has almost no readable text. Get It. needs actual content to study from — add some text and upload it again.";
      case "image_dominant":
      case "unreadable":
      default:
        return "This file couldn't be read. Try re-saving it as plain UTF-8 text, then upload again.";
    }
  }
  switch (reason) {
    case "too_many_pages":
      return `This document has ${stats?.numPages ?? "too many"} pages. Get It. supports PDFs up to ${MAX_PDF_PAGES} pages — try a single chapter or a shorter export.`;
    case "no_text":
      return "This PDF has almost no selectable text. Get It. reads the text layer of a document, not pictures of pages — this looks like a scan or an image-only export. Try a digital, text-based PDF (one where you can select the text in a reader).";
    case "image_dominant":
      return `This looks like a scanned or image-heavy PDF — only ${stats?.textPages ?? 0} of ${stats?.numPages ?? 0} pages have a usable text layer. Get It. reads text, not images, so too much of this document would be lost. Try a digital, text-based PDF.`;
    case "unreadable":
    default:
      return "This PDF couldn't be read — it may be encrypted, password-protected, or corrupted. Try re-exporting it or removing protection, then upload again.";
  }
}

function rejectResponse(
  reason: PdfRejectReason,
  stats?: PdfQualityStats,
  kind: SourceKind = "pdf",
) {
  return NextResponse.json(
    { error: rejectionMessage(reason, stats, kind), code: reason, stats },
    { status: 422 },
  );
}

export async function POST(req: Request) {
  let buffer: Buffer;
  let filename = "uploaded.pdf";
  let presetDocId: string | null = null;

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const sample = form.get("sample");
    if (typeof sample === "string" && sample) {
      const safe = sample.replace(/[^a-z0-9-]/gi, "");
      const sampleDocId = SAMPLE_NAME_TO_DOC_ID[safe];
      if (!sampleDocId) {
        return NextResponse.json({ error: "unknown sample" }, { status: 400 });
      }
      // Already in the library? Reuse it.
      const existing = getDoc(sampleDocId);
      if (existing) {
        return NextResponse.json({
          docId: existing.id,
          filename: existing.filename,
          pdfUrl: existing.pdfUrl,
          numPages: existing.extracted.numPages,
          pages: existing.extracted.pages.map((p) => ({
            pageIndex: p.pageIndex,
            width: p.width,
            height: p.height,
            text: p.text,
          })),
        });
      }
      const p = path.join(process.cwd(), "public", "pdfs", `${safe}.pdf`);
      buffer = await fs.readFile(p);
      filename = `${safe}.pdf`;
      presetDocId = sampleDocId;
    } else {
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "no file" }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
      const fname = (file as unknown as { name?: string }).name;
      if (fname) filename = fname.replace(/[^a-z0-9._-]/gi, "_");
    }
  } else {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const kind = kindOf(filename);
  if (!kind) {
    return NextResponse.json(
      { error: "Unsupported file type. Get It. accepts .pdf, .txt, and .md files." },
      { status: 400 },
    );
  }

  // Raw .txt/.md bytes — persisted next to the converted PDF below.
  let originalBytes: Buffer | null = null;

  if (kind === "pdf") {
    // Sanity: must look like a PDF.
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ error: "not a PDF" }, { status: 400 });
    }
  } else {
    // Text uploads have no magic bytes — validate by size, binary sniff,
    // and a strict UTF-8 decode, then convert to PDF so the rest of the
    // pipeline runs unchanged.
    if (buffer.length > MAX_TEXT_BYTES) {
      return NextResponse.json(
        {
          error: `This file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB of text — far more than ${MAX_PDF_PAGES} pages. Try a single chapter or a shorter file.`,
        },
        { status: 422 },
      );
    }
    if (buffer.includes(0)) {
      return NextResponse.json(
        { error: "This file isn't plain text — it looks like a binary file with a .txt/.md name. Try exporting it as real UTF-8 text." },
        { status: 422 },
      );
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return NextResponse.json(
        { error: "This file isn't valid UTF-8 text. Re-save it with UTF-8 encoding, then upload again." },
        { status: 422 },
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      return rejectResponse(
        "too_many_pages",
        {
          numPages: Math.ceil(text.length / CHARS_PER_PAGE_ESTIMATE),
          textPages: 0,
          totalAlnum: 0,
          richRatio: 0,
        },
        kind,
      );
    }
    const converted = await textToPdf(text, { kind, title: filename });
    // pdfkit's built-in fonts are WinAnsi-only; if most of the file became
    // "?" (CJK, Cyrillic, …) the study material would be garbage — refuse.
    if (
      converted.totalChars > 0 &&
      converted.replacedChars / converted.totalChars > 0.2
    ) {
      return NextResponse.json(
        { error: "This file is mostly written in characters Get It. can't render yet (for example Cyrillic or CJK scripts). Latin-script text works best for now." },
        { status: 422 },
      );
    }
    originalBytes = buffer;
    buffer = converted.pdf;
  }

  // Extract FIRST, from the in-memory bytes, so we can gate the document
  // before writing anything to disk or kicking off any agent workflow. A
  // rejected upload leaves no orphan files behind.
  //
  // pdf.js refuses Buffer instances; copy to a plain Uint8Array.
  const u8 = new Uint8Array(buffer.byteLength);
  u8.set(buffer);
  let extracted: ExtractedPdf;
  try {
    extracted = await extractPdf(u8);
  } catch (e) {
    if (e instanceof PdfUnsupportedError) {
      return rejectResponse(e.reason, e.stats, kind);
    }
    // pdf.js throws on encrypted / corrupt files — surface a friendly hint
    // instead of a 500.
    return rejectResponse("unreadable", undefined, kind);
  }

  // Text-coverage gate. Samples are curated and known-good, so they skip it;
  // real uploads must carry enough machine-readable text to study from.
  if (!presetDocId) {
    const quality = assessPdfQuality(extracted);
    if (!quality.ok) {
      return rejectResponse(quality.reason as PdfRejectReason, quality.stats, kind);
    }
  }

  const docId = presetDocId ?? newDocId();
  ensureDocDir(docId);
  await fs.writeFile(pdfPath(docId), buffer);
  if (originalBytes && kind !== "pdf") {
    await fs.writeFile(originalPath(docId, kind), originalBytes);
  }
  const pdfUrl = `/api/pdf/${docId}`;

  saveDoc({
    id: docId,
    filename,
    uploadedAt: Date.now(),
    numPages: extracted.numPages,
    sourceType: kind,
    extracted,
    pdfUrl,
  });

  return NextResponse.json({
    docId,
    filename,
    pdfUrl,
    numPages: extracted.numPages,
    pages: extracted.pages.map((p) => ({
      pageIndex: p.pageIndex,
      width: p.width,
      height: p.height,
      text: p.text,
    })),
  });
}
