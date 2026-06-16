/**
 * GET  /api/doc/[docId]/summary  → { summary: string | null }   (cached only)
 * POST /api/doc/[docId]/summary  → { summary: string }           (generate+cache)
 *
 * The Reader's "Summarized by Ghostreader" card. A short, neutral abstract of
 * the whole document, generated once via the active AI provider and cached
 * per-doc (summary.json). Provider-agnostic via runJson; 503 on provider error
 * so the Reader can hide the card gracefully when no provider is connected.
 */

import { NextResponse } from "next/server";
import { getDoc } from "@/lib/store";
import { runJson, toCodexErrorPayload } from "@/lib/codex";
import { docSummarySchema, type DocSummaryResult } from "@/lib/schemas-kg";
import { loadSummary, saveSummary } from "@/lib/summary-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CHARS = 12000;

const SYSTEM = `You are Ghostreader, a sharp, friendly reading companion inside a study app.
Write a short, neutral SUMMARY (an abstract) of the document below, for a reader
deciding what they're about to read. Rules:
- Same language as the document.
- 2 to 4 sentences. Plain-spoken and concrete — like a smart friend, not a
  textbook. Lead with what it's actually about, then its main point or payoff.
- Don't start with "This document/article/text". No hedging, no marketing, no
  meta-commentary. Just the gist.
Return ONE JSON object: { "summary": string }.`;

function buildPrompt(filename: string, text: string): string {
  return `${SYSTEM}

DOCUMENT TITLE: ${filename}

DOCUMENT TEXT:
"""
${text}
"""`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const cached = loadSummary(docId);
  return NextResponse.json({ summary: cached?.summary ?? null });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  const doc = getDoc(docId);
  if (!doc) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }

  // Idempotent: reuse the cached summary if we already have one.
  const cached = loadSummary(docId);
  if (cached) {
    return NextResponse.json({ summary: cached.summary, cached: true });
  }

  const text = doc.extracted.pages
    .map((p) => p.text)
    .join("\n\n")
    .slice(0, MAX_CHARS)
    .trim();
  if (text.length < 40) {
    return NextResponse.json({ error: "not enough text to summarize" }, { status: 422 });
  }

  try {
    const { data } = await runJson<DocSummaryResult>(
      buildPrompt(doc.filename, text),
      docSummarySchema,
      { reasoning: "medium" },
    );
    const summary = (data.summary ?? "").trim();
    if (!summary) {
      return NextResponse.json({ error: "empty summary" }, { status: 502 });
    }
    saveSummary(docId, summary);
    return NextResponse.json({ summary });
  } catch (e) {
    const p = toCodexErrorPayload(e);
    return NextResponse.json({ error: p.message, kind: p.kind }, { status: 503 });
  }
}
