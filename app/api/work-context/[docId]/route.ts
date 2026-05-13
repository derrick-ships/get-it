/**
 * GET /api/work-context/[docId]
 *
 * Returns the raw work-context JSON for a doc — the full journal of every
 * chat message, flashcard rating, quiz answer, and Feynman turn. Used by
 * the right-pane "Download work context" menu so the user can pull their
 * own data out.
 *
 * If the user has never interacted with a tool, returns the empty default
 * shape so the download is still well-formed.
 */

import { NextResponse } from "next/server";
import { getDoc } from "@/lib/store";
import { loadWorkContext } from "@/lib/work-context";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const wc = loadWorkContext(docId);
  return NextResponse.json(wc);
}
