/**
 * GET /api/projects/[projectId]/kg/state — current cross-document graph.
 *
 * Mirrors /api/kg/[docId]/state so the same client renderer
 * (KnowledgeGraphView) can drive it via its `endpoints` prop. Returns
 * status="missing" (200) when not yet built. evaluating is always false —
 * project graphs don't run the per-doc evaluation loop.
 */

import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { emptyKG } from "@/lib/kg";
import { loadProjectKG } from "@/lib/projects-kg";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const kg = loadProjectKG(projectId) ?? emptyKG(projectId);
  return NextResponse.json({ ...kg, evaluating: false });
}
