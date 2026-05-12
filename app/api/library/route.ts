/**
 * GET    /api/library          → [{ id, filename, uploadedAt, numPages, lastActivityAt, kgStatus }]
 * DELETE /api/library?id=...   → remove a doc from the library (PDF, workctx, KG, tags)
 *
 * The Library page renders this list. We enrich each row with two cheap
 * signals so the user gets a real "where was I" view:
 *   - lastActivityAt: max(uploadedAt, workctx.savedAt-ish, kg.lastEvaluatedAt)
 *   - kgStatus: from the on-disk KG file (or "missing")
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import { deleteDoc, listDocs, type DocMeta } from "@/lib/store";
import { kgPath, workCtxPath } from "@/lib/paths";
import { loadKG } from "@/lib/kg";

export const runtime = "nodejs";

function statMtime(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

type LibraryRow = DocMeta & {
  lastActivityAt: number;
  kgStatus: "missing" | "building" | "ready" | "error";
  kgEvaluationCount: number;
};

export async function GET() {
  const docs = listDocs();
  const rows: LibraryRow[] = docs.map((d) => {
    const wcMtime = statMtime(workCtxPath(d.id));
    const kgMtime = statMtime(kgPath(d.id));
    const kg = loadKG(d.id);
    const lastActivityAt = Math.max(
      d.uploadedAt,
      wcMtime ?? 0,
      kgMtime ?? 0,
      kg?.lastEvaluatedAt ?? 0,
    );
    return {
      ...d,
      lastActivityAt,
      kgStatus: kg?.status ?? "missing",
      kgEvaluationCount: kg?.evaluationCount ?? 0,
    };
  });
  return NextResponse.json({ docs: rows });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  const ok = deleteDoc(id);
  return NextResponse.json({ ok });
}
