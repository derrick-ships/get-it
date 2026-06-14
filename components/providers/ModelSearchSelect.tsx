"use client";

/**
 * Searchable OpenRouter model picker. Replaces the old datalist combo, whose
 * native filtering hid every model except the one already typed (so the user
 * felt locked to a single model). This fetches the live catalog from
 * /api/providers/openrouter/models (hundreds of models, static fallback when
 * offline), filters as you type, commits immediately on click, and still lets
 * you type ANY id and press Enter for models not in the list.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";

type CatalogModel = {
  id: string;
  name: string;
  contextLength?: number | null;
  promptPrice?: number | null;
};

const MAX_VISIBLE = 50;

export default function ModelSearchSelect({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [source, setSource] = useState<"live" | "static" | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/providers/openrouter/models", { cache: "no-store" });
        const j = (await r.json()) as { models: CatalogModel[]; source?: "live" | "static" };
        if (!cancelled) {
          setModels(j.models ?? []);
          setSource(j.source ?? null);
        }
      } catch {
        if (!cancelled) setModels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : models;
    return list.slice(0, MAX_VISIBLE);
  }, [models, query]);

  const commit = (id: string) => {
    const v = id.trim();
    if (v && v !== value) onCommit(v);
    setQuery("");
    setOpen(false);
  };

  const q = query.trim();
  const exactExists = !!models?.some((m) => m.id === q);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[11.5px] text-[var(--ink-600)]">Model</span>
        <span
          className="min-w-0 flex-1 truncate text-right text-[11.5px] font-medium text-[var(--ink-900)]"
          title={value}
        >
          {value || "—"}
        </span>
      </div>

      <div className="relative">
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-2 focus-within:border-[var(--accent-500)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-400)]" />
          <input
            value={query}
            placeholder="Search models, or type any id…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q) {
                e.preventDefault();
                commit(q);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ink-900)] focus:outline-none"
          />
          {models === null && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--ink-400)]" />}
        </div>

        {open && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 max-h-56 overflow-y-auto rounded-md border border-[var(--border-default)] bg-white py-1 shadow-[0_12px_32px_rgba(17,17,19,0.14)]"
            onMouseDown={() => {
              // keep focus from closing the panel before the click lands
              if (blurTimer.current) clearTimeout(blurTimer.current);
            }}
          >
            {q && !exactExists && (
              <button
                type="button"
                onClick={() => commit(q)}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11.5px] text-[var(--accent-700)] hover:bg-[var(--accent-50)]"
              >
                Use “{q}”
              </button>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => commit(m.id)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {m.id === value && <Check className="h-3.5 w-3.5 text-[var(--accent-600)]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-[var(--ink-900)]">
                    {m.id}
                  </span>
                  {m.name && m.name !== m.id && (
                    <span className="block truncate text-[10px] text-[var(--ink-400)]">
                      {m.name}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {models && filtered.length === 0 && !q && (
              <p className="px-2.5 py-2 text-[11px] text-[var(--ink-400)]">No models loaded.</p>
            )}
            {models && filtered.length === 0 && q && exactExists && (
              <p className="px-2.5 py-2 text-[11px] text-[var(--ink-400)]">Already selected.</p>
            )}
          </div>
        )}
      </div>

      <p className="text-[10.5px] leading-snug text-[var(--ink-400)]">
        {source === "static"
          ? "Showing curated shortcuts (couldn’t reach openrouter.ai). You can still type any model id and press Enter."
          : "Search the full openrouter.ai catalog, or type any id (e.g. moonshotai/kimi-k2) and press Enter."}
      </p>
    </div>
  );
}
