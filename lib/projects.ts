/**
 * Project store — Claude-style grouping of documents under a named project
 * with an emoji. A project is just metadata (name + emoji + timestamps); doc
 * membership lives on each DocMeta (`projectId`), so a doc belongs to at most
 * one project. The cross-document knowledge graph for a project is built
 * separately (lib/projects-kg.ts) from all its member docs' text.
 *
 * Index at <DATA_DIR>/projects.json: { v: 1, projects: ProjectMeta[] }.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PROJECTS_INDEX_PATH, projectDir } from "./paths";
import { clearProjectMembership } from "./store";

export type ProjectMeta = {
  id: string;
  name: string;
  emoji: string;
  createdAt: number;
  updatedAt: number;
};

const VERSION = 1 as const;

function readIndex(): ProjectMeta[] {
  try {
    const raw = fs.readFileSync(PROJECTS_INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { v: number; projects: ProjectMeta[] };
    if (parsed && parsed.v === VERSION && Array.isArray(parsed.projects)) {
      return parsed.projects;
    }
  } catch {
    /* fresh install or malformed — start empty */
  }
  return [];
}

function writeIndex(projects: ProjectMeta[]): void {
  const tmp = `${PROJECTS_INDEX_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: VERSION, projects }, null, 2));
  fs.renameSync(tmp, PROJECTS_INDEX_PATH);
}

/** Newest-first, like the doc library. */
export function listProjects(): ProjectMeta[] {
  return readIndex()
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getProject(id: string): ProjectMeta | null {
  return readIndex().find((p) => p.id === id) ?? null;
}

const DEFAULT_EMOJI = "📚";

function cleanName(name: unknown): string {
  const s = typeof name === "string" ? name.trim() : "";
  return s.slice(0, 80) || "Untitled project";
}

/** Take the first GRAPHEME so we store exactly one emoji, not a sentence —
 *  and without truncating multi-codepoint emoji (variation selectors like
 *  ⚗️, ZWJ sequences like 🧑‍⚖️, skin tones, flags). Falls back to a book
 *  when empty. */
function cleanEmoji(emoji: unknown): string {
  const s = typeof emoji === "string" ? emoji.trim() : "";
  if (!s) return DEFAULT_EMOJI;
  // Intl.Segmenter (Node 18+) groups by grapheme cluster; code-point split
  // would chop ⚗️ to ⚗. Fall back to code points if it's ever unavailable.
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const { segment } of seg.segment(s)) return segment;
  } catch {
    /* fall through */
  }
  return [...s][0] ?? DEFAULT_EMOJI;
}

export function createProject(input: { name?: string; emoji?: string }): ProjectMeta {
  const now = Date.now();
  const project: ProjectMeta = {
    id: randomUUID(),
    name: cleanName(input.name),
    emoji: cleanEmoji(input.emoji),
    createdAt: now,
    updatedAt: now,
  };
  const projects = readIndex();
  projects.push(project);
  writeIndex(projects);
  return project;
}

export function updateProject(
  id: string,
  patch: { name?: string; emoji?: string },
): ProjectMeta | null {
  const projects = readIndex();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next: ProjectMeta = {
    ...projects[idx],
    name: patch.name !== undefined ? cleanName(patch.name) : projects[idx].name,
    emoji: patch.emoji !== undefined ? cleanEmoji(patch.emoji) : projects[idx].emoji,
    updatedAt: Date.now(),
  };
  projects[idx] = next;
  writeIndex(projects);
  return next;
}

/**
 * Delete a project. Member docs are NOT deleted — their membership is cleared
 * so they fall back to "unfiled". The project's KG folder is removed.
 */
export function deleteProject(id: string): boolean {
  const projects = readIndex();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  writeIndex(next);
  clearProjectMembership(id);
  try {
    fs.rmSync(projectDir(id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return true;
}
