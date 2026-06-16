"use client";

/**
 * Add-documents dialog for a project. Lists the whole library so the user can
 * file documents into this project WITHOUT leaving the project page (the old
 * empty state only linked back to /library). Doubles as a manager: docs already
 * in this project can be removed right here.
 *
 * Filing reuses the existing single-doc endpoint
 *   POST /api/projects/[projectId]/docs  { docId, action: "add" | "remove" }
 * Adds run sequentially — setDocProject rewrites the shared docs index, so
 * parallel writes could race the JSON file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Loader2, Search, Upload, X } from "lucide-react";

type LibRow = {
  id: string;
  filename: string;
  numPages: number;
  projectId?: string | null;
};

function titleOf(filename: string): string {
  return filename.replace(/\.(pdf|txt|md|markdown)$/i, "");
}

export default function AddDocsModal({
  projectId,
  onClose,
  onChanged,
}: {
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<LibRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks docs whose membership we mutated locally (so the list reflects it
  // without a full refetch). Maps docId -> projectId|null.
  const [localMembership, setLocalMembership] = useState<Record<string, string | null>>({});

  const refetch = useCallback(async () => {
    try {
      const r = await fetch("/api/library", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { docs: LibRow[] };
      setRows(j.docs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const membershipOf = useCallback(
    (row: LibRow): string | null =>
      row.id in localMembership ? localMembership[row.id] : row.projectId ?? null,
    [localMembership],
  );

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter(
          (r) =>
            titleOf(r.filename).toLowerCase().includes(q) ||
            r.filename.toLowerCase().includes(q),
        )
      : rows;
    // In-project docs first, then addable, then those filed elsewhere.
    return [...list].sort((a, b) => rank(membershipOf(a)) - rank(membershipOf(b)));
    function rank(m: string | null): number {
      if (m === projectId) return 0;
      if (m == null) return 1;
      return 2;
    }
  }, [rows, query, membershipOf, projectId]);

  const toggle = (id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeOne = async (docId: string) => {
    setLocalMembership((m) => ({ ...m, [docId]: null }));
    try {
      await fetch(`/api/projects/${projectId}/docs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId, action: "remove" }),
      });
      onChanged();
    } catch {
      /* optimistic; project page reloads on change */
    }
  };

  const addPicked = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    // Sequential on purpose — each add rewrites the docs index on disk.
    for (const docId of picked) {
      try {
        await fetch(`/api/projects/${projectId}/docs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docId, action: "add" }),
        });
        setLocalMembership((m) => ({ ...m, [docId]: projectId }));
      } catch {
        /* skip this one, keep going */
      }
    }
    setPicked(new Set());
    setBusy(false);
    onChanged();
  };

  // Upload new files straight into the project (so users don't have to detour
  // through the Library). Each file goes through the normal /api/upload path,
  // then is filed into this project. Sequential to avoid racing the docs index.
  const onUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadError(null);
    let lastError: string | null = null;
    for (const file of Array.from(fileList)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.docId) {
          lastError = uj.error || `Couldn't upload ${file.name}`;
          continue;
        }
        await fetch(`/api/projects/${projectId}/docs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docId: uj.docId, action: "add" }),
        });
      } catch {
        lastError = `Couldn't upload ${file.name}`;
      }
    }
    if (lastError) setUploadError(lastError);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refetch();
    onChanged();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border-subtle)] bg-white shadow-[0_24px_60px_rgba(17,17,19,0.2)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <h2 className="text-[16px] font-semibold text-[var(--ink-900)]">Add documents</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--ink-400)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-[var(--border-default)] bg-white px-2.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-400)]" />
              <input
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your library…"
                className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--ink-900)] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Upload files straight into this project"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-3 text-[13px] font-medium text-[var(--ink-700)] hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown"
              className="hidden"
              onChange={(e) => onUploadFiles(e.target.files)}
            />
          </div>
          {uploadError && <p className="mt-2 text-[11.5px] text-rose-600">{uploadError}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {error && (
            <p className="px-2 py-3 text-[12.5px] text-rose-600">Couldn&apos;t load library: {error}</p>
          )}
          {!rows && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-[var(--ink-500)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" /> loading…
            </div>
          )}
          {rows && rows.length === 0 && (
            <p className="px-2 py-10 text-center text-[12.5px] text-[var(--ink-500)]">
              Your library is empty. Upload a document first.
            </p>
          )}
          {filtered.map((row) => {
            const m = membershipOf(row);
            const inThis = m === projectId;
            const elsewhere = m != null && m !== projectId;
            const isPicked = picked.has(row.id);
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--surface-sunken)]/60"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunken)] text-[var(--ink-500)]">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--ink-900)]">
                    {titleOf(row.filename)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--ink-500)]">
                    {row.numPages} page{row.numPages === 1 ? "" : "s"}
                    {elsewhere && " · in another project"}
                  </p>
                </div>
                {inThis ? (
                  <button
                    type="button"
                    onClick={() => removeOne(row.id)}
                    className="shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11.5px] font-medium text-[var(--ink-600)] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  >
                    In project · Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    aria-pressed={isPicked}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition ${
                      isPicked
                        ? "border-[var(--accent-600)] bg-[var(--accent-600)] text-white"
                        : "border-[var(--border-strong)] bg-white text-transparent hover:border-[var(--accent-500)]"
                    }`}
                    title={elsewhere ? "Move into this project" : "Add to this project"}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <span className="text-[12px] text-[var(--ink-500)]">
            {picked.size > 0 ? `${picked.size} selected` : "Pick documents to add"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--ink-600)] hover:bg-[var(--surface-sunken)]"
            >
              Done
            </button>
            <button
              type="button"
              onClick={addPicked}
              disabled={busy || picked.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[var(--accent-700)] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add {picked.size > 0 ? picked.size : ""} to project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
