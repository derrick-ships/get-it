/**
 * GET /api/highlights → every saved highlight across all documents, newest
 * first, enriched with doc + project context. Powers the global Highlights page.
 */

import { NextResponse } from "next/server";
import { listDocs } from "@/lib/store";
import { loadHighlights } from "@/lib/highlights-store";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  const docs = listDocs();
  const projectNames = new Map<string, { name: string; emoji: string }>();

  const rows = docs.flatMap((d) => {
    const hs = loadHighlights(d.id);
    if (hs.length === 0) return [];
    let project: { name: string; emoji: string } | null = null;
    if (d.projectId) {
      if (!projectNames.has(d.projectId)) {
        const p = getProject(d.projectId);
        if (p) projectNames.set(d.projectId, { name: p.name, emoji: p.emoji });
      }
      project = projectNames.get(d.projectId) ?? null;
    }
    return hs.map((h) => ({
      id: h.id,
      text: h.text,
      createdAt: h.createdAt,
      pageIndex: h.pageIndex,
      docId: d.id,
      filename: d.filename,
      projectId: d.projectId ?? null,
      projectName: project?.name ?? null,
      projectEmoji: project?.emoji ?? null,
    }));
  });

  rows.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ highlights: rows });
}
