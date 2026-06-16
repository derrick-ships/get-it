/**
 * GET /api/doc/[docId]/source
 *
 * Feeds the Reader view a clean, reflowable representation of the document:
 *   - md / txt uploads → the ORIGINAL text, preserved at upload (the PDF we
 *     render is just a converted copy; markdown structure/images survive here).
 *   - pdf → per-page clean text PLUS the per-run geometry (items), so the
 *     reader can infer headings (font size) and detect figure bands (text gaps)
 *     and crop them from the rendered page.
 *
 * Distinct from GET /api/doc/[docId], which omits `items` and the raw markdown.
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import { getDoc } from "@/lib/store";
import { originalPath } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  const doc = getDoc(docId);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const kind = doc.sourceType ?? "pdf";

  // Shared metadata block powering the Reader's article hero (title line,
  // source label, reading-time/date).
  const meta = {
    filename: doc.filename,
    sourceType: kind,
    uploadedAt: doc.uploadedAt,
    numPages: doc.extracted.numPages,
  };

  if (kind === "md" || kind === "txt") {
    try {
      const content = fs.readFileSync(originalPath(docId, kind), "utf-8");
      return NextResponse.json({ kind, content, meta });
    } catch {
      // Original missing (older doc) — fall back to the extracted text so the
      // reader still has something clean to show.
      const content = doc.extracted.pages.map((p) => p.text).join("\n\n");
      return NextResponse.json({ kind, content, meta });
    }
  }

  return NextResponse.json({
    kind: "pdf",
    meta,
    pages: doc.extracted.pages.map((p) => ({
      pageIndex: p.pageIndex,
      width: p.width,
      height: p.height,
      text: p.text,
      items: p.items,
    })),
  });
}
