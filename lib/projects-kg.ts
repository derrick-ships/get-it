/**
 * Project-level knowledge graph.
 *
 * Builds ONE concept graph that spans every document in a project, so a
 * learner sees how ideas connect ACROSS their sources — the whole point of
 * grouping docs into a project. We reuse the doc KG's schema and the same
 * client renderer (KnowledgeGraphView); only the prompt and the storage
 * location differ.
 *
 * The graph is stored at <DATA_DIR>/projects/<projectId>/kg.json. We reuse the
 * KnowledgeGraph shape verbatim, stashing the projectId in its `docId` field —
 * the renderer treats that field as an opaque identifier, so nothing
 * downstream needs to care that it's a project rather than a doc. Project
 * graphs don't run the per-doc evaluation loop (that's keyed to a single
 * doc's work context), so evaluationCount stays 0.
 */

import { runJson } from "./codex";
import fs from "node:fs";
import { ensureProjectDir, projectKgPath } from "./paths";
import { getDoc, listDocs } from "./store";
import { getProject } from "./projects";
import { emptyKG, type KGNode, type KnowledgeGraph } from "./kg";
import { kgBuildSchema, type KGBuildResult } from "./schemas-kg";

// ── Storage ──────────────────────────────────────────────────────────────

export function loadProjectKG(projectId: string): KnowledgeGraph | null {
  try {
    const raw = fs.readFileSync(projectKgPath(projectId), "utf-8");
    const parsed = JSON.parse(raw) as KnowledgeGraph;
    if (parsed && parsed.v === 1) return parsed;
  } catch {
    /* missing or malformed */
  }
  return null;
}

export function saveProjectKG(kg: KnowledgeGraph): void {
  ensureProjectDir(kg.docId);
  fs.writeFileSync(projectKgPath(kg.docId), JSON.stringify(kg, null, 2));
}

/** Member docs of a project, in upload order (oldest first reads naturally as
 *  a learning sequence). */
export function projectDocs(projectId: string) {
  return listDocs()
    .filter((d) => d.projectId === projectId)
    .sort((a, b) => a.uploadedAt - b.uploadedAt);
}

// ── Prompt ─────────────────────────────────────────────────────────────────

const BUILD_SYSTEM = `You are Get It.'s knowledge-graph architect, working at
the PROJECT level.

GOAL
You receive the full text of SEVERAL documents that a learner has grouped into
one project. Build the BEST single concept graph for the project as a WHOLE —
the cross-document map that shows how ideas in different sources connect.

NODES — each node is one CONCEPT that matters for mastering this project:
  • If two documents cover the same concept, MERGE them into ONE node (don't
    duplicate). The power of a project graph is unifying overlapping material.
  • Capture concepts that only appear in one document too, when they're
    important.
  • 8–30 nodes is the sweet spot. Each node: a stable lowercase-kebab id
    (ASCII, e.g. \`supply-and-demand\`), a short human label in the SOURCE
    LANGUAGE, and a 1–2 sentence summary. Set pageHints to [] (page numbers
    aren't meaningful across documents); instead, when useful, name the
    document in the summary.

EDGES — directed source -> target — capture HOW concepts connect, ESPECIALLY
ACROSS documents:
  • prerequisite ("you need X before Y" → source=X, target=Y)
  • composition / part-of, causal ("X causes Y"), specialisation
  • the most valuable edges link a concept from one document to a related
    concept in another — surface those.
  Phrase each link in one short clause via the "relation" field, in the source
  language. Skip trivial or duplicate edges.

GLOBAL NOTE — one short paragraph the student reads first: what this project is
about, how the documents relate, and where the spine of the learning path runs.
SOURCE LANGUAGE.

VOICE — write summaries and the global note like a sharp, curious friend
explaining it over coffee, not a textbook. Vivid, concrete, plain-spoken; lead
with intuition and why it matters; short sentences; no academic hedging.

LANGUAGE: detect the dominant source language and write every label, summary,
relation, and the global note in that language. ids stay lowercase-kebab ASCII.

Return ONE JSON object matching the schema. No prose.`;

/** Pack a doc's pages into one labelled blob, capped so a huge project still
 *  fits the model's context. We sample generously per doc but bound the total. */
function packDoc(title: string, pages: { pageIndex: number; text: string }[], charBudget: number): string {
  let acc = "";
  for (const p of pages) {
    const t = p.text.trim();
    if (!t) continue;
    if (acc.length + t.length > charBudget) {
      acc += t.slice(0, Math.max(0, charBudget - acc.length));
      break;
    }
    acc += `${t}\n\n`;
  }
  return `=== DOCUMENT: ${title} ===\n${acc.trim()}`;
}

// Total character budget for the merged prompt body. Generous but bounded so
// a 10-document project doesn't blow past model context; split evenly per doc.
const PROJECT_CHAR_BUDGET = 120_000;

function buildPrompt(docBlobs: string[]): string {
  return `${BUILD_SYSTEM}

--- PROJECT DOCUMENTS (${docBlobs.length}) ---
${docBlobs.join("\n\n")}
--- END PROJECT DOCUMENTS ---`;
}

// ── Build ────────────────────────────────────────────────────────────────

const buildInFlight = new Map<string, Promise<KnowledgeGraph>>();

export async function buildProjectKG(projectId: string): Promise<KnowledgeGraph> {
  const existing = loadProjectKG(projectId);
  if (existing && existing.status === "ready") return existing;

  const inFlight = buildInFlight.get(projectId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const project = getProject(projectId);
    if (!project) throw new Error("project not found");
    const docs = projectDocs(projectId);
    if (docs.length === 0) throw new Error("project has no documents yet");

    const placeholder: KnowledgeGraph = { ...emptyKG(projectId), status: "building" };
    saveProjectKG(placeholder);

    try {
      const perDocBudget = Math.floor(PROJECT_CHAR_BUDGET / docs.length);
      const blobs: string[] = [];
      for (const d of docs) {
        const full = getDoc(d.id);
        if (!full) continue;
        const title = d.filename.replace(/\.(pdf|txt|md|markdown)$/i, "");
        blobs.push(packDoc(title, full.extracted.pages, perDocBudget));
      }
      if (blobs.length === 0) throw new Error("no readable document text in project");

      const { data } = await runJson<KGBuildResult>(buildPrompt(blobs), kgBuildSchema, {
        reasoning: "medium",
      });

      // Drop edges referencing unknown ids; dedupe by (source,target).
      const ids = new Set(data.nodes.map((n) => n.id));
      const seen = new Set<string>();
      const edges = data.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
        .filter((e) => {
          const k = `${e.source}→${e.target}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

      const nodes: KGNode[] = data.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        summary: n.summary,
        pageHints: n.pageHints ?? [],
        evaluation: { memory: 0, comprehension: 0, structure: 0, application: 0 },
        evaluatorNote: "",
      }));

      const kg: KnowledgeGraph = {
        v: 1,
        docId: projectId,
        status: "ready",
        buildAt: Date.now(),
        lastEvaluatedAt: null,
        evaluationCount: 0,
        nodes,
        edges,
        globalNote: data.globalNote,
      };
      saveProjectKG(kg);
      return kg;
    } catch (e) {
      const errored: KnowledgeGraph = {
        ...placeholder,
        status: "error",
        buildError: (e as Error).message,
      };
      saveProjectKG(errored);
      throw e;
    }
  })();

  buildInFlight.set(projectId, promise);
  // Clear the in-flight entry on settle. The `.catch` swallows only this
  // cleanup chain's rejection — the original `promise` is still returned to
  // the caller and rejects normally — so a build failure can't surface as an
  // unhandled rejection.
  promise.finally(() => buildInFlight.delete(projectId)).catch(() => {});
  return promise;
}
