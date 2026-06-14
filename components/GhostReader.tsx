"use client";

/**
 * Ghostreader popup. Appears when the user highlights text in the document
 * viewer; lets them ask the active AI provider to simplify or elaborate the
 * passage, or ask a free-form question about it. Anchors to the selection's
 * viewport rect.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X, Wand2, BookOpen } from "lucide-react";

export type GhostSelection = { text: string; rect: DOMRect; pageIndex: number };

const POPUP_W = 360;
const MARGIN = 12;
const EST_H = 240;

export default function GhostReader({
  docId,
  selection,
  contextText,
  onClose,
}: {
  docId: string;
  selection: GhostSelection;
  contextText: string;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const ask = async (action: "simplify" | "elaborate" | "ask", q?: string) => {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const r = await fetch(`/api/ghostreader/${docId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedText: selection.text,
          context: contextText,
          action,
          question: q,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error ?? "Couldn't get an answer. Check your AI provider in Settings.");
      else setAnswer(j.answer ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Anchor below the selection, clamped to the viewport; flip above if tight.
  let left = selection.rect.left;
  let top = selection.rect.bottom + 8;
  if (typeof window !== "undefined") {
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - POPUP_W - MARGIN));
    if (top + EST_H > window.innerHeight) {
      top = Math.max(MARGIN, selection.rect.top - 8 - EST_H);
    }
  }

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: POPUP_W, zIndex: 60 }}
      className="rounded-xl border border-[var(--border-subtle)] bg-white shadow-[0_10px_40px_rgba(17,17,19,0.16)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink-800)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent-600)]" /> Ghostreader
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-0.5 text-[var(--ink-400)] transition hover:text-[var(--ink-700)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5">
        <p className="mb-2 line-clamp-2 rounded-md bg-[var(--surface-sunken)]/60 px-2 py-1 text-[11.5px] italic text-[var(--ink-500)]">
          &ldquo;{selection.text}&rdquo;
        </p>

        {!answer && !loading && !error && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => ask("simplify")}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-[12px] font-medium text-[var(--ink-700)] transition hover:border-[var(--accent-500)] hover:text-[var(--accent-700)]"
            >
              <Wand2 className="h-3.5 w-3.5" /> Simplify
            </button>
            <button
              type="button"
              onClick={() => ask("elaborate")}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-[12px] font-medium text-[var(--ink-700)] transition hover:border-[var(--accent-500)] hover:text-[var(--accent-700)]"
            >
              <BookOpen className="h-3.5 w-3.5" /> Elaborate
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-3 text-[12.5px] text-[var(--ink-500)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" /> Thinking…
          </div>
        )}
        {error && <p className="py-2 text-[12.5px] leading-relaxed text-rose-700">{error}</p>}
        {answer && (
          <p className="max-h-60 overflow-y-auto whitespace-pre-wrap py-1 text-[13px] leading-relaxed text-[var(--ink-800)]">
            {answer}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) ask("ask", question.trim());
          }}
          className="mt-2 flex gap-1.5"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this…"
            className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-[var(--accent-500)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="shrink-0 rounded-md bg-[var(--accent-600)] px-2.5 text-[12px] font-medium text-white transition hover:bg-[var(--accent-700)] disabled:opacity-50"
          >
            Ask
          </button>
        </form>

        {(answer || error) && !loading && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => ask("simplify")}
              className="text-[11px] text-[var(--ink-500)] transition hover:text-[var(--accent-700)]"
            >
              Simplify
            </button>
            <span className="text-[11px] text-[var(--ink-300)]">·</span>
            <button
              type="button"
              onClick={() => ask("elaborate")}
              className="text-[11px] text-[var(--ink-500)] transition hover:text-[var(--accent-700)]"
            >
              Elaborate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
