/**
 * GET    /api/projects/[projectId]   → project meta + its member docs
 * PATCH  /api/projects/[projectId]   → rename / change emoji { name?, emoji? }
 * DELETE /api/projects/[projectId]   → delete the project (docs become unfiled)
 */

import { NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/projects";
import { projectDocs } from "@/lib/projects-kg";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const docs = projectDocs(projectId).map((d) => ({
    id: d.id,
    filename: d.filename,
    numPages: d.numPages,
    uploadedAt: d.uploadedAt,
  }));
  return NextResponse.json({ ...project, docs });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const b = (body && typeof body === "object" ? body : {}) as {
    name?: string;
    emoji?: string;
  };
  const updated = updateProject(projectId, { name: b.name, emoji: b.emoji });
  if (!updated) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const ok = deleteProject(projectId);
  if (!ok) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  return NextResponse.json({ ok });
}
