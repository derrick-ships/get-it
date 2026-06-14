"use client";

/**
 * Tiny emoji picker for naming a project (Claude-style). A fixed palette of
 * study-friendly emoji in a popover, plus a free-text box so any emoji works.
 * No dependency — just a grid of buttons.
 */

import { useEffect, useRef, useState } from "react";

const PALETTE = [
  "📚", "📖", "🧠", "🔬", "🧪", "⚗️", "🧬", "🩺",
  "📐", "📊", "📈", "💹", "🧮", "💡", "⚙️", "🔭",
  "🌍", "🗺️", "⚖️", "🏛️", "💰", "🧑‍⚖️", "🎨", "🎵",
  "💻", "🤖", "🚀", "⚛️", "🔋", "🌱", "🐍", "🔥",
];

export default function EmojiPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  const firstGrapheme = (s: string): string => {
    const t = s.trim();
    if (!t) return "";
    try {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      for (const { segment } of seg.segment(t)) return segment;
    } catch {
      /* fall through */
    }
    return [...t][0] ?? "";
  };

  const pick = (emoji: string) => {
    const e = firstGrapheme(emoji);
    if (e) onPick(e);
    setOpen(false);
    setCustom("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose emoji"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-white text-[20px] hover:border-[var(--border-strong)]"
      >
        {value || "📚"}
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-50 w-[232px] rounded-xl border border-[var(--border-subtle)] bg-white p-2 shadow-[0_12px_32px_rgba(17,17,19,0.14)]">
          <div className="grid grid-cols-8 gap-0.5">
            {PALETTE.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => pick(e)}
                className={`flex h-7 w-7 items-center justify-center rounded-md text-[16px] hover:bg-[var(--surface-sunken)] ${
                  value === e ? "bg-[var(--accent-50)] ring-1 ring-[var(--accent-500)]" : ""
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5 border-t border-[var(--border-subtle)] pt-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pick(custom);
                }
              }}
              placeholder="or paste any emoji"
              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-[var(--accent-500)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => pick(custom)}
              disabled={!custom.trim()}
              className="shrink-0 rounded-md bg-[var(--accent-600)] px-2 text-[12px] font-medium text-white hover:bg-[var(--accent-700)] disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
