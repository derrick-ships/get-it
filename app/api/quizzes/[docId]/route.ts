/**
 * Quizzes.
 *
 *   GET  /api/quizzes/[docId]                       → all sessions
 *   POST /api/quizzes/[docId] { action:"generate", topic? }
 *                                                   → new session with questions
 *   POST /api/quizzes/[docId] { action:"answer", sessionId, questionIndex, chosenIndex }
 *                                                   → record a forced-choice pick
 *   POST /api/quizzes/[docId] { action:"end", sessionId }
 *                                                   → mark session ended; trigger KG eval
 *   DELETE /api/quizzes/[docId]?sessionId=...
 *
 * Sibling tool to flashcards: same lifecycle, same KG-evaluation handoff
 * when a quiz ends. Where flashcards measure open-ended recall (self-
 * graded 1–4), quizzes measure forced-choice discrimination — can the
 * student pick the correct option *over* a plausible distractor? — and
 * give the evaluator a clean correct/incorrect signal per concept.
 */

import { NextResponse } from "next/server";
import { runJson } from "@/lib/codex";
import { getDoc } from "@/lib/store";
import {
  loadWorkContext,
  saveWorkContext,
  newId,
  type QuizQuestion,
  type QuizSession,
} from "@/lib/work-context";
import {
  quizGenerateSchema,
  type QuizGenerateResult,
} from "@/lib/schemas-kg";
import { loadKG } from "@/lib/kg";
import { scheduleEvaluation } from "@/lib/kg-runner";

export const runtime = "nodejs";
export const maxDuration = 180;

const SYSTEM = `You are Get It.'s quiz generator.

Goal: produce a focused multiple-choice quiz (4–8 questions) on the
requested topic that PROBES UNDERSTANDING — not surface recognition.

QUESTION QUALITY
  • Each question is ONE concept / one decision. No "all of the above",
    no "which of these is NOT" trick framings.
  • Exactly FOUR options per question. One is unambiguously correct; the
    other three are PLAUSIBLE DISTRACTORS — wrong for an interesting
    reason a student would actually trip on (common confusion, swapped
    cause/effect, right concept wrong magnitude, sibling concept).
    Random or silly options are forbidden.
  • Mix tiers: ~25% factual / definitional, ~50% reasoning-from-the-text
    (why does X happen, what follows from Y), ~25% applied (small
    novel scenario, edge case).
  • The correct option must be the SHORTEST consistent restatement of
    the truth — not padded with extra true-but-irrelevant clauses that
    would otherwise tip the student off.
  • The "explanation" field is one or two sentences: WHY the correct
    answer is correct AND, when useful, why the most tempting distractor
    is wrong. It surfaces after the student picks.

LANGUAGE
  If the source PDF is in Italian / Spanish / etc., write every stem,
  option, and explanation in that same language. Code or formulae stay
  as-is.

OUTPUT
A JSON object matching the schema. No prose.`;

function generationPrompt(docId: string, topic: string): string {
  const doc = getDoc(docId)!;
  const kg = loadKG(docId);
  const kgPart =
    kg && kg.status === "ready"
      ? `\nKEY CONCEPTS:\n${kg.nodes.map((n) => `- ${n.label}: ${n.summary}`).join("\n")}\n`
      : "";
  const excerpt = doc.extracted.pages
    .map((p) => `[page ${p.pageIndex + 1}]\n${p.text}`)
    .join("\n\n")
    .slice(0, 50_000);
  return `${SYSTEM}

DOCUMENT: ${doc.filename}
TOPIC: ${topic === "all" ? "the whole document — broad coverage" : topic}
${kgPart}
DOCUMENT TEXT (excerpt):
${excerpt}

Produce the quiz now. Output JSON.`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const wc = loadWorkContext(docId);
  return NextResponse.json({ sessions: wc.quizzes });
}

type Body =
  | { action: "generate"; topic?: string }
  | { action: "answer"; sessionId: string; questionIndex: number; chosenIndex: number }
  | { action: "end"; sessionId: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const body = (await req.json()) as Body;
  const wc = loadWorkContext(docId);

  if (body.action === "generate") {
    const topic = (body.topic ?? "all").trim() || "all";
    const { data } = await runJson<QuizGenerateResult>(
      generationPrompt(docId, topic),
      quizGenerateSchema,
      { reasoning: "low" },
    );
    // Defensive clamp: in case the model emits a stray correctIndex
    // outside 0..3 we treat the first option as correct rather than
    // throwing — the JSON Schema already enforces bounds but the
    // server-side guard keeps us safe if the schema is ever loosened.
    const questions: QuizQuestion[] = data.questions.map((q) => ({
      stem: q.stem,
      options: q.options.slice(0, 4),
      correctIndex: Math.min(3, Math.max(0, q.correctIndex | 0)),
      explanation: q.explanation,
    }));
    const session: QuizSession = {
      id: newId(),
      topic,
      createdAt: Date.now(),
      questions,
    };
    const reloaded = loadWorkContext(docId);
    reloaded.quizzes.unshift(session);
    saveWorkContext(reloaded);
    return NextResponse.json({ session });
  }

  if (body.action === "answer") {
    const session = wc.quizzes.find((s) => s.id === body.sessionId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const question = session.questions[body.questionIndex];
    if (!question) {
      return NextResponse.json({ error: "question index out of range" }, { status: 400 });
    }
    if (body.chosenIndex < 0 || body.chosenIndex > 3) {
      return NextResponse.json({ error: "chosenIndex must be 0..3" }, { status: 400 });
    }
    // Write-once: the first answer sticks. Ignore re-submits silently so
    // a double-click can't change a recorded choice.
    if (question.chosenIndex == null) {
      question.chosenIndex = body.chosenIndex;
      question.answeredAt = Date.now();
      saveWorkContext(wc);
    }
    return NextResponse.json({ session });
  }

  if (body.action === "end") {
    const session = wc.quizzes.find((s) => s.id === body.sessionId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (!session.endedAt) {
      session.endedAt = Date.now();
      saveWorkContext(wc);
      scheduleEvaluation(docId);
    }
    return NextResponse.json({ session });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ docId: string }> },
) {
  const { docId } = await ctx.params;
  if (!getDoc(docId)) {
    return NextResponse.json({ error: "doc not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  const wc = loadWorkContext(docId);
  wc.quizzes = wc.quizzes.filter((s) => s.id !== sessionId);
  saveWorkContext(wc);
  return NextResponse.json({ ok: true });
}
