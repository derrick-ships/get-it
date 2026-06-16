/**
 * GET    /api/highlights/[docId]            → { highlights: Highlight[] }
 * POST   /api/highlights/[docId]  {text,pageIndex} → { highlight }
 * DELETE /api/highlights/[docId]?id=...      → { ok }
 *
 * Per-document persisted reader highlights.
 */

import { NextResponse } from "next/server";
import { getDoc } from "@/lib/store";
import { addHighlight, loadHighlights, removeHighlight } from "@/lib/highlights-store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ highlights: loadHighlights(docId) });
}

export async function POST(req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: { text?: string; pageIndex?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (body.text ?? "").toString().trim();
  if (text.length < 2) return NextResponse.json({ error: "empty highlight" }, { status: 400 });
  const highlight = addHighlight(docId, text, Number(body.pageIndex) || 0);
  return NextResponse.json({ highlight });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  removeHighlight(docId, id);
  return NextResponse.json({ ok: true });
}
