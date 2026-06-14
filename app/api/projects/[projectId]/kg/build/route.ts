/**
 * POST /api/projects/[projectId]/kg/build — build the cross-document graph.
 *
 * Mirrors /api/kg/[docId]/build. Idempotent: returns the existing graph if one
 * is already ready. The build merges every member doc's text into one concept
 * graph (lib/projects-kg.ts).
 */

import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { buildProjectKG, loadProjectKG } from "@/lib/projects-kg";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const existing = loadProjectKG(projectId);
  if (existing && existing.status === "ready") {
    return NextResponse.json(existing);
  }
  try {
    const kg = await buildProjectKG(projectId);
    return NextResponse.json(kg);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
