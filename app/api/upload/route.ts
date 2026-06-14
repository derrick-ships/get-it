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
import { PDFDocument } from "pdf-lib";

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

/** Validate one uploaded file and return its PDF bytes (pdf as-is, or .txt/.md
 *  converted via textToPdf). Returns a discriminated union so callers can
 *  forward the exact error response. */
type ConvertOk = {
  ok: true;
  pdf: Buffer;
  kind: SourceKind;
  originalBytes: Buffer | null;
  filename: string;
};
type ConvertErr = { ok: false; status: number; body: Record<string, unknown> };

async function fileToPdfBuffer(
  file: Blob,
  rawName: string | undefined,
): Promise<ConvertOk | ConvertErr> {
  const filename = (rawName ?? "uploaded.pdf").replace(/[^a-z0-9._-]/gi, "_");
  const kind = kindOf(filename);
  if (!kind) {
    return {
      ok: false,
      status: 400,
      body: { error: "Unsupported file type. Get It. accepts .pdf, .txt, and .md files." },
    };
  }
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());

  if (kind === "pdf") {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return { ok: false, status: 400, body: { error: `"${filename}" isn't a PDF.` } };
    }
    return { ok: true, pdf: buffer, kind, originalBytes: null, filename };
  }

  // Text upload: size / binary / utf-8 / budget gates, then convert to PDF.
  if (buffer.length > MAX_TEXT_BYTES) {
    return {
      ok: false,
      status: 422,
      body: { error: `"${filename}" is ${(buffer.length / 1024 / 1024).toFixed(1)} MB of text — far more than ${MAX_PDF_PAGES} pages.` },
    };
  }
  if (buffer.includes(0)) {
    return {
      ok: false,
      status: 422,
      body: { error: `"${filename}" isn't plain text — it looks like a binary file with a .txt/.md name.` },
    };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return {
      ok: false,
      status: 422,
      body: { error: `"${filename}" isn't valid UTF-8 text. Re-save it with UTF-8 encoding.` },
    };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return {
      ok: false,
      status: 422,
      body: {
        error: rejectionMessage(
          "too_many_pages",
          { numPages: Math.ceil(text.length / CHARS_PER_PAGE_ESTIMATE), textPages: 0, totalAlnum: 0, richRatio: 0 },
          kind,
        ),
        code: "too_many_pages",
      },
    };
  }
  const converted = await textToPdf(text, { kind, title: filename });
  if (converted.totalChars > 0 && converted.replacedChars / converted.totalChars > 0.2) {
    return {
      ok: false,
      status: 422,
      body: { error: `"${filename}" is mostly characters Get It. can't render yet (e.g. Cyrillic or CJK). Latin-script text works best for now.` },
    };
  }
  const originalBytes = buffer;
  buffer = converted.pdf;
  return { ok: true, pdf: buffer, kind, originalBytes, filename };
}

/** Concatenate several PDFs into one. Throws if a source is encrypted/corrupt. */
async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const b of buffers) {
    const src = await PDFDocument.load(b);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save());
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const form = await req.formData();

  let buffer: Buffer;
  let filename: string;
  let kind: SourceKind;
  let originalBytes: Buffer | null = null;
  let presetDocId: string | null = null;

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
    buffer = await fs.readFile(path.join(process.cwd(), "public", "pdfs", `${safe}.pdf`));
    filename = `${safe}.pdf`;
    kind = "pdf";
  } else {
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    if (files.length === 0) {
      return NextResponse.json({ error: "no file" }, { status: 400 });
    }
    const combine = form.get("combine") === "true" && files.length > 1;

    if (combine) {
      // Convert every file to PDF, then concatenate into ONE document so the
      // existing pipeline (extraction → detection → tags → KG → viewer) treats
      // them as a single continuous document — cross-file graph + animations.
      const pdfs: Buffer[] = [];
      const names: string[] = [];
      for (const f of files) {
        const r = await fileToPdfBuffer(f, f.name);
        if (!r.ok) return NextResponse.json(r.body, { status: r.status });
        pdfs.push(r.pdf);
        names.push(r.filename);
      }
      try {
        buffer = await mergePdfs(pdfs);
      } catch {
        return NextResponse.json(
          { error: "One of the files couldn't be combined — it may be encrypted or corrupted. Remove it and try again." },
          { status: 422 },
        );
      }
      const firstBase = names[0].replace(/\.(pdf|txt|md|markdown)$/i, "");
      filename = `${firstBase} + ${files.length - 1} more`;
      kind = "pdf";
    } else {
      const r = await fileToPdfBuffer(files[0], files[0].name);
      if (!r.ok) return NextResponse.json(r.body, { status: r.status });
      buffer = r.pdf;
      filename = r.filename;
      kind = r.kind;
      originalBytes = r.originalBytes;
    }
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
