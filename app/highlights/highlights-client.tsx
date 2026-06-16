"use client";

/**
 * Highlights page — every passage the user saved in the Reader, newest first,
 * with its project + document + date, à la Readwise. Click a highlight to open
 * the document; delete removes it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Upload, BookOpen, Highlighter, RefreshCw, Trash2, Loader2 } from "lucide-react";
import AccountButton from "@/components/AccountButton";
import SettingsButton from "@/components/SettingsButton";
import TooltipChip from "@/components/TooltipChip";

type Row = {
  id: string;
  text: string;
  createdAt: number;
  docId: string;
  filename: string;
  projectName: string | null;
  projectEmoji: string | null;
};

function titleOf(filename: string): string {
  return filename.replace(/\.(pdf|txt|md|markdown)$/i, "");
}

function ago(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.round(d / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function HighlightsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/highlights", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { highlights: Row[] };
      setRows(j.highlights);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (row: Row) => {
    setRows((cur) => (cur ? cur.filter((r) => r.id !== row.id) : cur));
    try {
      await fetch(`/api/highlights/${row.docId}?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
    } catch {
      /* optimistic */
    }
  };

  return (
    <main className="flex flex-1 min-h-0 flex-col bg-[var(--surface-canvas)] text-[var(--ink-900)]">
      <div className="tab-bar tab-bar--fused">
        <TooltipChip tip="Open or drop a new document.">
          <Link href="/" aria-label="Go to upload" className="tab-item">
            <Upload className="h-3.5 w-3.5 text-[var(--ink-400)]" />
            <span>Upload</span>
          </Link>
        </TooltipChip>
        <TooltipChip tip="Your library of documents.">
          <Link href="/library" aria-label="Library" className="tab-item">
            <BookOpen className="h-3.5 w-3.5 text-[var(--ink-400)]" />
            <span>Library</span>
          </Link>
        </TooltipChip>
        <div className="tab-item" data-active="true">
          <Highlighter className="h-3.5 w-3.5 text-[var(--accent-600)]" />
          <span>Highlights</span>
        </div>
        <div className="ml-auto flex items-center gap-1 pr-1">
          <TooltipChip tip="Refresh highlights.">
            <button type="button" onClick={load} aria-label="Refresh" className="tab-icon-btn">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </TooltipChip>
          <SettingsButton />
          <AccountButton />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-raised)]">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <h1 className="mb-1 text-[22px] font-bold tracking-tight">Highlights</h1>
          <p className="mb-6 text-[13px] text-[var(--ink-500)]">
            Everything you’ve highlighted while reading — newest first.
          </p>

          {error && <p className="text-[13px] text-rose-600">Couldn’t load highlights: {error}</p>}
          {!rows && !error && (
            <div className="flex items-center gap-2 py-10 text-[var(--ink-500)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" /> loading…
            </div>
          )}
          {rows && rows.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border-default)] px-6 py-12 text-center">
              <Highlighter className="mx-auto h-9 w-9 text-[var(--ink-300)]" />
              <p className="mt-3 text-[14px] font-medium">No highlights yet</p>
              <p className="mt-1 text-[12.5px] text-[var(--ink-500)]">
                In the Reader, select any passage and click <span className="font-medium">Highlight</span> in the
                Ghostreader popup. They’ll collect here.
              </p>
            </div>
          )}

          <ul className="space-y-3">
            {rows?.map((row) => (
              <li
                key={row.id}
                className="group rounded-xl border border-[var(--border-subtle)] bg-white p-4 transition hover:border-[var(--border-strong)]"
              >
                <Link href={`/viewer/${row.docId}`} className="block">
                  <p className="border-l-2 border-amber-300 pl-3 text-[14px] leading-relaxed text-[var(--ink-800)]">
                    {row.text}
                  </p>
                </Link>
                <div className="mt-2.5 flex items-center gap-2 pl-3 text-[11.5px] text-[var(--ink-500)]">
                  {row.projectName && (
                    <span className="inline-flex items-center gap-1">
                      <span>{row.projectEmoji ?? "📁"}</span>
                      {row.projectName}
                      <span className="text-[var(--ink-300)]">·</span>
                    </span>
                  )}
                  <Link href={`/viewer/${row.docId}`} className="truncate hover:text-[var(--ink-800)]">
                    {titleOf(row.filename)}
                  </Link>
                  <span className="text-[var(--ink-300)]">·</span>
                  <span>{ago(row.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    aria-label="Delete highlight"
                    className="ml-auto rounded-md p-1 text-[var(--ink-400)] opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
