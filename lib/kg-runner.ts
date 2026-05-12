/**
 * Server-side runners for the knowledge-graph agents.
 *
 * - buildKG(docId): one-shot creation of the concept graph from the PDF text.
 *   Idempotent — if a non-error KG already exists, returns it without
 *   touching codex.
 * - scheduleEvaluation(docId): debounced re-scoring of the existing graph
 *   based on the latest work context. Per-doc queue — at most one eval in
 *   flight, at most one pending after that — so chatty tools don't pile up
 *   redundant codex calls.
 *
 * Both runners are fire-and-forget from the caller's perspective; state is
 * committed to disk so the client polls /api/kg/[docId]/state to observe.
 */

import { runJson, CodexError } from "./codex";
import { getDoc } from "./store";
import {
  emptyKG,
  loadKG,
  saveKG,
  type KGEvaluation,
  type KGNode,
  type KnowledgeGraph,
} from "./kg";
import {
  kgBuildSchema,
  kgEvaluateSchema,
  type KGBuildResult,
  type KGEvaluateResult,
} from "./schemas-kg";
import { loadWorkContext, summariseForEvaluator } from "./work-context";

// ── Build prompt ──────────────────────────────────────────────────────

const BUILD_SYSTEM = `You are Braynr's knowledge-graph architect.

GOAL
You receive the full text of a textbook-style PDF. Build the BEST possible
concept graph for a learner working through this material.

NODES — each node is one CONCEPT. Pick:
  • the concepts a student would actually need to master (not minor asides)
  • a useful granularity: not so coarse that two distinct ideas share a node,
    not so fine that the graph turns into a glossary
  • 6–25 nodes is the typical sweet spot. Up to 30 only if the material
    genuinely demands it.
  • For each node provide: a stable lowercase-kebab id (\`circulatory-system\`),
    a short human label in the SOURCE LANGUAGE, a 1–2 sentence summary, and
    the page numbers (1-indexed) where the concept is treated.

EDGES — directed from source -> target — capture HOW concepts connect:
  • prerequisite ("you need X before Y" → Y depends on X, so source=X, target=Y)
  • composition / part-of
  • causal ("X causes Y")
  • specialisation ("X is a kind of Y")
  • parallel / contrast (use sparingly)
  Use the "relation" field to phrase the link in one short clause, in the
  source language. Skip trivial or duplicate edges.

GLOBAL NOTE — one short paragraph the student will read first: what this
document is about, what the spine of the learning path is, and where the
hardest / most central concepts are. SOURCE LANGUAGE.

LANGUAGE: detect the source language and write every label, summary,
relation, and the global note in that language. ids stay lowercase-kebab
(ASCII).

Return ONE JSON object matching the schema. No prose.`;

function buildPrompt(filename: string, pageBlobs: string[]): string {
  const text = pageBlobs.join("\n\n");
  return `${BUILD_SYSTEM}

--- DOCUMENT (filename: ${filename}) ---
${text}
--- END DOCUMENT ---`;
}

// Bound the prompt so we don't accidentally exceed the model's context on
// monster PDFs. Each page is also truncated individually so the agent sees
// every page (even if shallowly) rather than only the first few in full.
const MAX_PROMPT_CHARS = 90_000;
const MAX_PER_PAGE_CHARS = 4_000;

function packPages(pages: { pageIndex: number; text: string }[]): string[] {
  const trimmed = pages.map((p) => {
    const t = p.text.trim();
    const slice = t.length > MAX_PER_PAGE_CHARS ? t.slice(0, MAX_PER_PAGE_CHARS) + "…" : t;
    return `[page ${p.pageIndex + 1}]\n${slice}`;
  });
  let total = 0;
  const out: string[] = [];
  for (const blob of trimmed) {
    if (total + blob.length > MAX_PROMPT_CHARS) break;
    out.push(blob);
    total += blob.length + 2;
  }
  return out;
}

// ── Public: build ────────────────────────────────────────────────────

const buildInFlight = new Map<string, Promise<KnowledgeGraph>>();

export async function buildKG(docId: string): Promise<KnowledgeGraph> {
  // Reuse a result that's already on disk (idempotent at the API layer).
  const existing = loadKG(docId);
  if (existing && (existing.status === "ready" || existing.status === "building")) {
    if (existing.status === "ready") return existing;
  }
  const inFlight = buildInFlight.get(docId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const doc = getDoc(docId);
    if (!doc) throw new Error("doc not found");

    // Mark as building so the client UI can show a placeholder.
    const placeholder: KnowledgeGraph = {
      ...emptyKG(docId),
      status: "building",
    };
    saveKG(placeholder);

    try {
      const blobs = packPages(doc.extracted.pages);
      const prompt = buildPrompt(doc.filename, blobs);
      const { data } = await runJson<KGBuildResult>(prompt, kgBuildSchema, {
        reasoning: "medium",
      });

      // Drop edges referencing unknown ids — the model occasionally invents one.
      const ids = new Set(data.nodes.map((n) => n.id));
      const cleanEdges = data.edges.filter(
        (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
      );
      // Dedup by (source,target).
      const seen = new Set<string>();
      const dedupedEdges = cleanEdges.filter((e) => {
        const k = `${e.source}→${e.target}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const nodes: KGNode[] = data.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        summary: n.summary,
        pageHints: n.pageHints,
        evaluation: { memory: 0, comprehension: 0, structure: 0, application: 0 },
        evaluatorNote: "",
      }));

      const kg: KnowledgeGraph = {
        v: 1,
        docId,
        status: "ready",
        buildAt: Date.now(),
        lastEvaluatedAt: null,
        evaluationCount: 0,
        nodes,
        edges: dedupedEdges,
        globalNote: data.globalNote,
      };
      saveKG(kg);
      return kg;
    } catch (e) {
      const codexErr = e instanceof CodexError ? e : null;
      // Rate-limited or auth lost: leave the KG in "building" state and
      // schedule a deferred retry. The status badge keeps spinning, the
      // banner explains why; when the window clears we pick up where we
      // were without the user having to do anything.
      if (codexErr && (codexErr.kind === "rate_limit" || codexErr.kind === "auth_lost")) {
        if (codexErr.kind === "rate_limit" && codexErr.retryAt) {
          const wait = Math.max(1000, codexErr.retryAt - Date.now() + 500);
          setTimeout(() => {
            buildInFlight.delete(docId);
            buildKG(docId).catch(() => {});
          }, wait);
        }
        throw e;
      }
      const errored: KnowledgeGraph = {
        ...placeholder,
        status: "error",
        buildError: (e as Error).message,
      };
      saveKG(errored);
      throw e;
    }
  })();

  buildInFlight.set(docId, promise);
  promise.finally(() => {
    buildInFlight.delete(docId);
  });
  return promise;
}

// ── Evaluation ────────────────────────────────────────────────────────

const EVALUATE_SYSTEM = `You are Braynr's evaluator agent. You score how
well a student has mastered each concept in a knowledge graph based on
their actual interactions with three learning tools (chat, flashcards,
Feynman).

You must score, per concept, four 0–100 parameters:

  MEMORY — does the student RECALL the concept?
    • Use flashcard ratings (1=again, 4=easy), recall in chat, references
      across days. Recall over time > recall in the moment.

  COMPREHENSION — does the student understand it in their OWN WORDS?
    • Look at chat paraphrases, Feynman explanations. Verbatim repetition
      of the source = low. Original metaphors / lay-language re-explanations
      that match the substance = high. The Feynman "explain it to a child"
      step is the strongest signal here.

  STRUCTURE — does the student grasp how this concept CONNECTS to others?
    • Look for cause-effect chains, references to prerequisites, comparisons
      with sibling concepts. Isolated factoids = low. Multi-step reasoning
      that bridges concepts = high.

  APPLICATION — does the student TRANSFER the concept to new cases?
    • Look for original examples, edge cases the student invented, problem
      solving on novel scenarios. Solving textbook-clone problems alone =
      moderate. Spontaneously generating new cases = high.

CRITICAL RULES
1. Scores are MONOTONE NON-DECREASING across evaluations — a student can
   only progress, never regress. Engine-side we will clamp any decrease,
   so your job is to NEVER decrease, only raise scores when there is fresh
   evidence.
2. Be RIGOROUS. Quantity of interactions does NOT entitle a high score —
   only quality of evidence does. A student who has done 50 flashcards but
   rates them all "again" should sit very low on memory; a student who has
   given a single brilliant Feynman explanation can earn a strong jump on
   comprehension for that concept.
3. Only emit updates for concepts that have observable evidence in the
   work context. Concepts with no evidence are silently kept at 0 / their
   previous level.
4. evaluatorNote per concept: one or two short sentences in the source
   language saying what to focus on next for this concept. Empty if
   nothing to add yet.
5. globalNote: one paragraph in the source language summarising overall
   state and the single most leveraged next move (e.g. "Reinforce the
   structure dimension on X — comprehension is solid but you haven't
   connected it to Y yet").

OUTPUT
Single JSON object matching the schema. No prose.`;

function evaluatePrompt(kg: KnowledgeGraph, workCtxText: string): string {
  const kgSummary = kg.nodes
    .map(
      (n) =>
        `- ${n.id} :: ${n.label} (M${n.evaluation.memory} C${n.evaluation.comprehension} S${n.evaluation.structure} A${n.evaluation.application})\n  ${n.summary}`,
    )
    .join("\n");
  const edgesSummary =
    kg.edges
      .slice(0, 80)
      .map((e) => `${e.source} -[${e.relation}]-> ${e.target}`)
      .join("\n") || "(no edges)";
  return `${EVALUATE_SYSTEM}

--- KNOWLEDGE GRAPH (current scores in parens) ---
${kgSummary}

EDGES:
${edgesSummary}

GLOBAL NOTE (previous): ${kg.globalNote}

--- WORK CONTEXT (chronological) ---
${workCtxText}
--- END WORK CONTEXT ---

Score now. Only emit nodes with new evidence. Never decrease.`;
}

function clampMonotone(prev: KGEvaluation, next: KGEvaluation): KGEvaluation {
  return {
    memory: Math.max(prev.memory, Math.min(100, Math.max(0, Math.round(next.memory)))),
    comprehension: Math.max(prev.comprehension, Math.min(100, Math.max(0, Math.round(next.comprehension)))),
    structure: Math.max(prev.structure, Math.min(100, Math.max(0, Math.round(next.structure)))),
    application: Math.max(prev.application, Math.min(100, Math.max(0, Math.round(next.application)))),
  };
}

const evalInFlight = new Map<string, Promise<void>>();
const evalPending = new Map<string, boolean>();
const evalDeferredTimers = new Map<string, NodeJS.Timeout>();

/** Whether an evaluation pass is currently running for this doc. Used by
 *  the state route so the client can render a live "evaluating" indicator
 *  without polling a separate endpoint. */
export function isEvaluating(docId: string): boolean {
  return evalInFlight.has(docId);
}

/**
 * Schedule an evaluation pass for a doc. Coalesces back-to-back calls into
 * at most one in-flight + one pending so a chatty tool can't queue dozens
 * of redundant codex turns.
 */
export function scheduleEvaluation(docId: string): void {
  if (evalInFlight.has(docId)) {
    evalPending.set(docId, true);
    return;
  }
  const run = (async () => {
    try {
      await runEvaluation(docId);
    } catch (e) {
      const err = e instanceof CodexError ? e : null;
      console.warn("[kg-eval]", docId, (e as Error).message);
      // Rate-limited: defer a retry until the window expires. We hold an
      // intent (pending=true) so the next genuine interaction wakes us
      // up, but we also schedule a timer so progress resumes on its own
      // even if the user does nothing.
      if (err && err.kind === "rate_limit" && err.retryAt) {
        const wait = Math.max(1000, err.retryAt - Date.now() + 500);
        const existing = evalDeferredTimers.get(docId);
        if (existing) clearTimeout(existing);
        evalDeferredTimers.set(
          docId,
          setTimeout(() => {
            evalDeferredTimers.delete(docId);
            scheduleEvaluation(docId);
          }, wait),
        );
        evalPending.set(docId, true);
      }
    } finally {
      evalInFlight.delete(docId);
      if (evalPending.get(docId) && !evalDeferredTimers.has(docId)) {
        evalPending.delete(docId);
        scheduleEvaluation(docId);
      }
    }
  })();
  evalInFlight.set(docId, run);
}

async function runEvaluation(docId: string): Promise<void> {
  const kg = loadKG(docId);
  if (!kg || kg.status !== "ready") return;
  const workCtx = loadWorkContext(docId);

  const hasInteractions =
    workCtx.chats.length > 0 || workCtx.flashcards.length > 0 || workCtx.feynman.length > 0;
  if (!hasInteractions) return;

  const promptText = evaluatePrompt(kg, summariseForEvaluator(workCtx));
  const { data } = await runJson<KGEvaluateResult>(promptText, kgEvaluateSchema, {
    reasoning: "medium",
  });

  // Apply updates with monotone clamping.
  const byId = new Map(kg.nodes.map((n) => [n.id, n]));
  for (const u of data.updates) {
    const node = byId.get(u.id);
    if (!node) continue;
    node.evaluation = clampMonotone(node.evaluation, u.evaluation);
    if (u.evaluatorNote && u.evaluatorNote.trim()) {
      node.evaluatorNote = u.evaluatorNote.trim();
    }
  }

  kg.lastEvaluatedAt = Date.now();
  kg.evaluationCount += 1;
  if (data.globalNote && data.globalNote.trim()) {
    kg.globalNote = data.globalNote.trim();
  }
  saveKG(kg);
}
