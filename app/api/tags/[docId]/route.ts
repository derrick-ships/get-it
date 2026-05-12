/**
 * GET  /api/tags/[docId]   → load the persisted tag/view state (or null)
 * POST /api/tags/[docId]   → save the tag/view state. Body shape matches
 *                            lib/tags-store.ts → PersistedTagsFile minus
 *                            v / docId / savedAt (server fills those in).
 *
 * The viewer client posts here debounced; we also load on Library re-open.
 */

import { NextResponse } from "next/server";
import { getDoc } from "@/lib/store";
import {
  loadTags,
  saveTags,
  type PersistedTagServer,
} from "@/lib/tags-store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const file = loadTags(docId);
  return NextResponse.json(file ?? null);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const b = body as {
    tags?: PersistedTagServer[];
    activeTagId?: string | null;
    pagesAnalyzed?: number[];
  };
  saveTags(docId, {
    tags: Array.isArray(b.tags) ? b.tags : [],
    activeTagId: b.activeTagId ?? null,
    pagesAnalyzed: Array.isArray(b.pagesAnalyzed) ? b.pagesAnalyzed : [],
  });
  return NextResponse.json({ ok: true });
}
