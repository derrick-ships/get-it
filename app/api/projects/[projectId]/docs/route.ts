/**
 * POST /api/projects/[projectId]/docs
 *   body { docId, action: "add" | "remove" }
 *
 * Files a document into the project ("add") or unfiles it ("remove"). Single
 * membership: adding a doc that's already in another project just moves it.
 * Because the project KG depends on its members, we drop a stale "ready" graph
 * back to "missing" so the next visit rebuilds it with the new membership.
 */

import { NextResponse } from "next/server";
import { getDoc, setDocProject } from "@/lib/store";
import { getProject } from "@/lib/projects";
import { loadProjectKG, saveProjectKG } from "@/lib/projects-kg";
import { emptyKG } from "@/lib/kg";

export const runtime = "nodejs";

/** A membership change invalidates the project's cross-doc graph. Reset it to
 *  "missing" so it's rebuilt on demand rather than showing a stale map. */
function invalidateProjectKG(projectId: string): void {
  const kg = loadProjectKG(projectId);
  if (kg && kg.status !== "missing") {
    saveProjectKG({ ...emptyKG(projectId), status: "missing" });
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as {
    docId?: string;
    action?: string;
  };
  if (!b.docId || !getDoc(b.docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const action = b.action === "remove" ? "remove" : "add";

  if (action === "add") {
    const updated = setDocProject(b.docId, projectId);
    invalidateProjectKG(projectId);
    return NextResponse.json({ ok: true, doc: updated });
  }

  // remove — only unfile if it's actually in THIS project.
  const doc = getDoc(b.docId);
  if (doc?.projectId === projectId) {
    setDocProject(b.docId, null);
    invalidateProjectKG(projectId);
  }
  return NextResponse.json({ ok: true });
}
