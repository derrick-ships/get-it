"use client";

/**
 * Reader "Contents" slide-over (Readwise-style). Lists the document's headings;
 * clicking one scrolls to it. The active heading (from the reader's scroll-spy)
 * is highlighted. Closes on Escape / scrim click.
 */

import { useEffect } from "react";
import { X } from "lucide-react";

export type TocItem = { id: string; text: string; level: number };

export default function ReaderContents({
  items,
  activeId,
  onJump,
  onClose,
}: {
  items: TocItem[];
  activeId: string | null;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Headings start at level 1 (md h1) or 2 (pdf reader-h2); indent relative to
  // the shallowest present so the tree reads naturally regardless of source.
  const minLevel = items.reduce((m, it) => Math.min(m, it.level), 6);

  return (
    <div className="reader-toc">
      <div className="reader-toc-scrim" onClick={onClose} />
      <div className="reader-toc-panel">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--reader-heading)" }}>
            Contents
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contents"
            className="reader-tool-btn"
            style={{ paddingLeft: 6, paddingRight: 6 }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              data-active={activeId === it.id}
              onClick={() => onJump(it.id)}
              className="reader-toc-item"
              style={{ paddingLeft: 8 + (it.level - minLevel) * 14 }}
            >
              {it.text}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
