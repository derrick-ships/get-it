/**
 * GET  /api/projects   → list projects, each with a doc count + KG status
 * POST /api/projects   → create a project { name, emoji }
 *
 * The Library page reads the list to render project sections; doc membership
 * itself rides along on each /api/library row's projectId.
 */

import { NextResponse } from "next/server";
import { createProject, listProjects, type ProjectMeta } from "@/lib/projects";
import { listDocs } from "@/lib/store";
import { loadProjectKG } from "@/lib/projects-kg";

export const runtime = "nodejs";

type ProjectRow = ProjectMeta & {
  docCount: number;
  kgStatus: "missing" | "building" | "ready" | "error";
};

export async function GET() {
  const docs = listDocs();
  const counts = new Map<string, number>();
  for (const d of docs) {
    if (d.projectId) counts.set(d.projectId, (counts.get(d.projectId) ?? 0) + 1);
  }
  const projects: ProjectRow[] = listProjects().map((p) => ({
    ...p,
    docCount: counts.get(p.id) ?? 0,
    kgStatus: loadProjectKG(p.id)?.status ?? "missing",
  }));
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
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
  const project = createProject({ name: b.name, emoji: b.emoji });
  return NextResponse.json(project, { status: 201 });
}
