/**
 * POST /api/upload
 *   multipart/form-data:
 *     - file: <PDF blob>      (when uploading from the user's machine)
 *     - sample: <name>        (when picking one of /public/pdfs/<name>.pdf)
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
import { extractPdf } from "@/lib/pdf-extract";
import { ensureDocDir, pdfPath } from "@/lib/paths";
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

  // Sanity: must look like a PDF.
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return NextResponse.json({ error: "not a PDF" }, { status: 400 });
  }

  const docId = presetDocId ?? newDocId();
  ensureDocDir(docId);
  await fs.writeFile(pdfPath(docId), buffer);

  // pdf.js refuses Buffer instances; copy to a plain Uint8Array.
  const u8 = new Uint8Array(buffer.byteLength);
  u8.set(buffer);
  const extracted = await extractPdf(u8);
  const pdfUrl = `/api/pdf/${docId}`;

  saveDoc({
    id: docId,
    filename,
    uploadedAt: Date.now(),
    numPages: extracted.numPages,
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
