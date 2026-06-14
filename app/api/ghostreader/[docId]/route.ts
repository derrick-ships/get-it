/**
 * POST /api/ghostreader/[docId]
 *
 * The "ghostreader": the user highlighted a passage in the document and wants
 * help. Body: { selectedText, context?, action: "simplify"|"elaborate"|"ask",
 * question? }. Returns { answer }. One-shot, provider-agnostic via runJson.
 */

import { NextResponse } from "next/server";
import { getDoc } from "@/lib/store";
import { runJson, toCodexErrorPayload } from "@/lib/codex";
import { ghostReaderSchema, type GhostReaderResult } from "@/lib/schemas-kg";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are Ghostreader, a sharp, friendly reading companion inside a study app.
The reader highlighted a passage and wants help with it. Answer in the SAME
language as the passage. Voice: vivid, concrete, plain-spoken — like a smart
friend, not a textbook. Lead with the intuition. No hedging, no filler, no
"great question". Never invent facts beyond the passage + context.`;

function buildPrompt(args: {
  action: "simplify" | "elaborate" | "ask";
  selectedText: string;
  context: string;
  question: string;
  filename: string;
}): string {
  const task =
    args.action === "simplify"
      ? "Explain the highlighted text in the simplest terms a curious beginner would actually get. Reach for an everyday analogy if it helps. 2–4 short sentences."
      : args.action === "elaborate"
        ? "Go one level deeper on the highlighted text: the why, the mechanism, a concrete example, and one thing people commonly miss. Keep it tight — a short paragraph."
        : `Answer the reader's question about the highlighted text, grounded in it and the surrounding context.\nQUESTION: ${args.question}`;
  return `${SYSTEM}

DOCUMENT: ${args.filename}

SURROUNDING CONTEXT (for grounding only — don't quote it back verbatim):
${args.context || "(none)"}

HIGHLIGHTED TEXT:
"""
${args.selectedText}
"""

TASK: ${task}

Return ONE JSON object: { "answer": string }.`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  const doc = getDoc(docId);
  if (!doc) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }

  let body: {
    selectedText?: string;
    context?: string;
    action?: string;
    question?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const selectedText = (body.selectedText ?? "").toString().trim().slice(0, 4000);
  if (!selectedText) {
    return NextResponse.json({ error: "no text selected" }, { status: 400 });
  }
  const action =
    body.action === "elaborate" || body.action === "ask" ? body.action : "simplify";
  const question = (body.question ?? "").toString().slice(0, 500);
  const context = (body.context ?? "").toString().slice(0, 4000);

  try {
    const { data } = await runJson<GhostReaderResult>(
      buildPrompt({ action, selectedText, context, question, filename: doc.filename }),
      ghostReaderSchema,
      { reasoning: "low" },
    );
    return NextResponse.json({ answer: data.answer });
  } catch (e) {
    const p = toCodexErrorPayload(e);
    return NextResponse.json({ error: p.message, kind: p.kind }, { status: 503 });
  }
}
