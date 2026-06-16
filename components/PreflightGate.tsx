"use client";

/**
 * Pre-flight generation gate (Readwise-budget-style). Shown when a fresh
 * document is opened, BEFORE any visualizations are generated, so a 40-page PDF
 * can't silently spawn 64 viz calls and eat the usage window. The user picks
 * how many concepts to visualize (slider), sees a Light/Moderate/Heavy tier and
 * their current provider usage, then confirms — or chooses "Just read".
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Gauge, BookOpen, Loader2 } from "lucide-react";

type Usage = {
  provider: "codex" | "openrouter" | "ollama" | null;
  primaryPct: number | null; // codex 5h window
  secondaryPct: number | null; // codex weekly
  remainingUsd: number | null; // openrouter
  unlimited: boolean; // ollama / local
};

function estimateConcepts(numPages: number): number {
  // Detection aims for ≤4 rich concepts/page but skips thin pages — ~2.5/page
  // is a realistic central estimate. Capped so the slider stays sane.
  return Math.max(3, Math.min(64, Math.round(numPages * 2.5)));
}

function tierOf(n: number): { label: string; color: string } {
  if (n <= 8) return { label: "Light", color: "#10b981" };
  if (n <= 20) return { label: "Moderate", color: "#f59e0b" };
  return { label: "Heavy", color: "#ef4444" };
}

export default function PreflightGate({
  numPages,
  defaultBudget,
  onConfirm,
  onSkip,
}: {
  numPages: number;
  defaultBudget: number;
  onConfirm: (budget: number) => void;
  onSkip: () => void;
}) {
  const estMax = useMemo(() => estimateConcepts(numPages), [numPages]);
  const [n, setN] = useState(() => Math.max(1, Math.min(defaultBudget, estMax)));
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/codex/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const rl = j?.rateLimits ?? null;
        setUsage({
          provider: j?.provider ?? rl?.planType ? "codex" : null,
          primaryPct: rl?.primary?.usedPercent ?? null,
          secondaryPct: rl?.secondary?.usedPercent ?? null,
          remainingUsd: rl?.credits && !rl.credits.unlimited ? null : null,
          unlimited: !!rl?.credits?.unlimited,
        });
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tier = tierOf(n);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-white p-5 shadow-[0_24px_60px_rgba(17,17,19,0.22)]"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-50)] text-[var(--accent-600)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <h2 className="text-[16px] font-semibold text-[var(--ink-900)]">Before we visualize…</h2>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-[var(--ink-500)]">
          This document is <span className="font-medium text-[var(--ink-700)]">{numPages} pages</span> — roughly{" "}
          <span className="font-medium text-[var(--ink-700)]">~{estMax} concepts</span> worth visualizing. Each one is an
          AI call, so pick how many to generate now. The rest stay one click away.
        </p>

        {/* Slider + animated tier */}
        <div className="mb-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 p-3.5">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[12px] font-medium text-[var(--ink-600)]">Visualize</span>
            <span className="tabular-nums text-[20px] font-bold text-[var(--ink-900)]">
              {n}
              <span className="ml-1 text-[12px] font-normal text-[var(--ink-400)]">/ {estMax}</span>
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={estMax}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            className="w-full accent-[var(--accent-600)]"
          />
          <div className="mt-2 flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" style={{ color: tier.color }} />
            <span className="text-[12px] font-semibold" style={{ color: tier.color }}>
              {tier.label} usage
            </span>
            <div className="ml-auto h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <motion.div
                className="h-full rounded-full"
                style={{ background: tier.color }}
                animate={{ width: `${Math.round((n / estMax) * 100)}%` }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
              />
            </div>
          </div>
        </div>

        {/* Current provider usage context */}
        <div className="mb-4 text-[11.5px] text-[var(--ink-500)]">
          {!usage ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--ink-400)]">
              <Loader2 className="h-3 w-3 animate-spin" /> checking your usage…
            </span>
          ) : usage.unlimited ? (
            <span>Local model — generate freely, no usage limits.</span>
          ) : usage.primaryPct != null ? (
            <span>
              Your 5-hour limit is{" "}
              <span className={`font-medium ${usage.primaryPct >= 80 ? "text-rose-600" : "text-[var(--ink-700)]"}`}>
                {Math.round(usage.primaryPct)}% used
              </span>
              {usage.secondaryPct != null ? ` · weekly ${Math.round(usage.secondaryPct)}%` : ""}. Generating more uses more.
            </span>
          ) : (
            <span>Generating more uses more of your provider quota.</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--ink-600)] hover:bg-[var(--surface-sunken)]"
          >
            <BookOpen className="h-3.5 w-3.5" /> Just read
          </button>
          <button
            type="button"
            onClick={() => onConfirm(n)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--accent-700)]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate {n}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
