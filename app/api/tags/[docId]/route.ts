/**
 * GET  /api/tags/[docId]   → load the persisted tag/view state, with
 *                            live job-status flags appended:
 *                              { ...PersistedTagsFile, detectionRunning,
 *                                vizQueueRunning, numPages }
 *                            The viewer polls this to mirror server-
 *                            owned state (tags + pagesAnalyzed).
 *
 * POST /api/tags/[docId]   → only `activeTagId` is honored. Tags and
 *                            pagesAnalyzed are server-owned (see
 *                            lib/jobs.ts) and cannot be overwritten by
 *                            the client — the previous overwrite
 *                            behaviour would clobber in-progress
 *                            detection / viz queue work.
 */

import { NextResponse } from "next/server";
import { getDoc } from "@/lib/store";
import { loadTags, saveTags } from "@/lib/tags-store";
import { getJobStatus } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  const doc = getDoc(docId);
  if (!doc) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const file = loadTags(docId);
  const status = getJobStatus(docId);
  return NextResponse.json({
    file,
    ...status,
    numPages: doc.extracted.numPages,
  });
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
  const b = body as { activeTagId?: string | null };
  // Merge into the current file — tags + pagesAnalyzed are owned by the
  // server-side jobs runner; only the client-side selection is honored.
  const current = loadTags(docId);
  saveTags(docId, {
    tags: current?.tags ?? [],
    activeTagId:
      b.activeTagId === null
        ? null
        : typeof b.activeTagId === "string"
          ? b.activeTagId
          : (current?.activeTagId ?? null),
    pagesAnalyzed: current?.pagesAnalyzed ?? [],
    detectionError: current?.detectionError ?? null,
  });
  return NextResponse.json({ ok: true });
}
