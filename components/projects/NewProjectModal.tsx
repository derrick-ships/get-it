"use client";

/**
 * Create-a-project dialog (Claude-style): pick a name and an emoji. POSTs to
 * /api/projects and hands the created project back to the caller so it can
 * refresh and (optionally) file a doc into it right away.
 */

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import EmojiPicker from "./EmojiPicker";

export type CreatedProject = { id: string; name: string; emoji: string };

export default function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: CreatedProject) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📚");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled project", emoji }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = (await r.json()) as CreatedProject;
      onCreated(p);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-white p-5 shadow-[0_24px_60px_rgba(17,17,19,0.2)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-[var(--ink-900)]">New project</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--ink-400)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--ink-500)]">
          Group related documents so their knowledge graphs connect across
          files. Give it a name and an emoji.
        </p>
        <div className="flex items-center gap-2">
          <EmojiPicker value={emoji} onPick={setEmoji} />
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) submit();
            }}
            placeholder="e.g. Organic Chemistry"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border-default)] bg-white px-3 text-[14px] text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
          />
        </div>
        {error && <p className="mt-2 text-[12px] text-rose-600">Couldn&apos;t create: {error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--ink-600)] hover:bg-[var(--surface-sunken)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[var(--accent-700)] disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
