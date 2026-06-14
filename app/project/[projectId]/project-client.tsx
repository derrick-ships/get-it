"use client";

/**
 * Project page.
 *
 * A project groups documents; this page shows its member docs and the
 * cross-document knowledge graph that spans them all (the reason projects
 * exist). The graph reuses the doc-level KnowledgeGraphView via its
 * `endpoints` prop, pointed at /api/projects/[id]/kg/*.
 *
 * The name + emoji are editable inline (PATCH /api/projects/[id]). Removing a
 * doc here just unfiles it — it stays in the library.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Loader2,
  Network,
  Trash2,
} from "lucide-react";
import AccountButton from "@/components/AccountButton";
import SettingsButton from "@/components/SettingsButton";
import EmojiPicker from "@/components/projects/EmojiPicker";
import KnowledgeGraphView from "@/components/RightPane/KnowledgeGraphView";

type ProjectDoc = { id: string; filename: string; numPages: number; uploadedAt: number };
type Project = { id: string; name: string; emoji: string; docs: ProjectDoc[] };

function titleOf(filename: string): string {
  return filename.replace(/\.(pdf|txt|md|markdown)$/i, "");
}

export default function ProjectClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [tab, setTab] = useState<"graph" | "docs">("graph");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Project not found" : `HTTP ${r.status}`);
      const j = (await r.json()) as Project;
      setProject(j);
      setNameDraft(j.name);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (delta: { name?: string; emoji?: string }) => {
      setProject((cur) => (cur ? { ...cur, ...delta } : cur));
      try {
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(delta),
        });
      } catch {
        /* optimistic — reload on next visit */
      }
    },
    [projectId],
  );

  const removeDoc = useCallback(
    async (docId: string) => {
      await fetch(`/api/projects/${projectId}/docs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId, action: "remove" }),
      });
      await load();
    },
    [projectId, load],
  );

  return (
    <main className="flex flex-1 min-h-0 flex-col bg-[var(--surface-canvas)] text-[var(--ink-900)]">
      {/* Top bar */}
      <div className="tab-bar tab-bar--fused">
        <Link href="/library" aria-label="Back to library" className="tab-item">
          <ArrowLeft className="h-3.5 w-3.5 text-[var(--ink-400)]" />
          <span>Library</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 pr-1">
          <SettingsButton />
          <AccountButton />
        </div>
      </div>

      {error && (
        <div className="mx-auto mt-10 max-w-md rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          {error}
        </div>
      )}

      {!project && !error && (
        <div className="mt-10 flex items-center justify-center gap-2 text-[var(--ink-500)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" /> loading…
        </div>
      )}

      {project && (
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-raised)]">
          {/* Header */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] px-8 py-5">
            <div className="mx-auto flex max-w-5xl items-center gap-3">
              <EmojiPicker value={project.emoji} onPick={(e) => patch({ emoji: e })} />
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const v = nameDraft.trim();
                  if (v && v !== project.name) patch({ name: v });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[26px] font-bold tracking-tight text-[var(--ink-900)] hover:border-[var(--border-subtle)] focus:border-[var(--accent-500)] focus:outline-none"
              />
              <span className="shrink-0 text-[12.5px] text-[var(--ink-500)]">
                {project.docs.length} doc{project.docs.length === 1 ? "" : "s"}
              </span>
            </div>
            {/* Sub-tabs */}
            <div className="mx-auto mt-3 flex max-w-5xl gap-1">
              <SubTab active={tab === "graph"} onClick={() => setTab("graph")} Icon={Network}>
                Knowledge graph
              </SubTab>
              <SubTab active={tab === "docs"} onClick={() => setTab("docs")} Icon={BookOpen}>
                Documents
              </SubTab>
            </div>
          </div>

          {/* Body */}
          <div className="relative min-h-0 flex-1">
            {project.docs.length === 0 ? (
              <EmptyProject />
            ) : tab === "graph" ? (
              <KnowledgeGraphView
                docId={project.id}
                endpoints={{
                  state: `/api/projects/${project.id}/kg/state`,
                  build: `/api/projects/${project.id}/kg/build`,
                }}
              />
            ) : (
              <div className="mx-auto max-w-5xl px-8 py-6">
                <ul className="space-y-2">
                  {project.docs.map((d) => (
                    <li
                      key={d.id}
                      className="group flex items-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-white p-4"
                    >
                      <Link href={`/viewer/${d.id}`} className="flex flex-1 items-center gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--ink-500)]">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold text-[var(--ink-900)]">
                            {titleOf(d.filename)}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-[var(--ink-500)]">
                            {d.numPages} page{d.numPages === 1 ? "" : "s"}
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeDoc(d.id)}
                        title="Remove from project (keeps it in your library)"
                        className="shrink-0 rounded-md p-1.5 text-[var(--ink-400)] opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function SubTab({
  active,
  onClick,
  Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof Network;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[var(--accent-50)] text-[var(--accent-700)]"
          : "text-[var(--ink-500)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function EmptyProject() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-[var(--accent-100)] bg-[var(--accent-50)]/40 px-6 py-12 text-center">
      <Network className="mx-auto h-10 w-10 text-[var(--ink-300)]" />
      <p className="mt-3 text-[14px] font-medium text-[var(--ink-900)]">No documents yet</p>
      <p className="mt-1 text-[12.5px] text-[var(--ink-500)]">
        Add documents to this project from your library — use the project menu
        on any document. Once there are two or more, the cross-document
        knowledge graph maps how their ideas connect.
      </p>
      <Link
        href="/library"
        className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-600)] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[var(--accent-700)]"
      >
        <BookOpen className="h-3.5 w-3.5" />
        Go to library
      </Link>
    </div>
  );
}
