"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Box, Activity, FileText, Sigma, BarChart3, MoreHorizontal } from "lucide-react";
import type { VizSpec, VizType } from "@/lib/schemas";
import ThreeDView from "./ThreeDView";
import TwoDAnimView from "./TwoDAnimView";
import TwoDTextView from "./TwoDTextView";
import FormulaView from "./FormulaView";
import GraphView from "./GraphView";

const TYPE_LABEL: Record<VizType, string> = {
  "3d": "3D Model",
  "2d-anim": "Animation",
  "2d-text": "Source",
  formula: "Formula",
  graph: "Graph",
};

const TYPE_ICON: Record<VizType, React.ComponentType<{ className?: string }>> = {
  "3d": Box,
  "2d-anim": Activity,
  "2d-text": FileText,
  formula: Sigma,
  graph: BarChart3,
};

type Props = {
  spec: VizSpec | null;
  loading?: boolean;
  emptyHint?: string;
};

export default function Visualizer({ spec, loading, emptyHint }: Props) {
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {spec ? (
            <span className="chip-soft">
              {(() => {
                const Icon = TYPE_ICON[spec.type];
                return <Icon className="h-3 w-3" />;
              })()}
              {TYPE_LABEL[spec.type]}
            </span>
          ) : (
            <span className="chip-plain">
              <Sigma className="h-3 w-3" />
              Visualizer
            </span>
          )}
          <p className="truncate text-[13.5px] font-medium text-[var(--ink-900)]">
            {spec ? spec.title : loading ? "Preparing visualization…" : "Pick a tag to begin"}
          </p>
        </div>
        <button type="button" className="tab-icon-btn">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-white">
        <AnimatePresence mode="wait">
          {loading && !spec && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-3 text-[var(--ink-500)]">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-400)] [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-400)] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-400)] [animation-delay:300ms]" />
                </div>
                <p className="text-xs">codex is composing the visualization</p>
              </div>
            </motion.div>
          )}

          {!spec && !loading && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center px-8 text-center"
            >
              <div className="max-w-sm">
                <div className="mb-4 flex justify-center gap-2.5">
                  {(["3d", "2d-anim", "formula", "graph", "2d-text"] as VizType[]).map((t) => {
                    const Icon = TYPE_ICON[t];
                    return (
                      <div
                        key={t}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-white"
                      >
                        <Icon className="h-4 w-4 text-[var(--ink-500)]" />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[13.5px] leading-relaxed text-[var(--ink-500)]">
                  {emptyHint ?? "Click any tag in the document to render its concept here."}
                </p>
              </div>
            </motion.div>
          )}

          {spec && (
            <motion.div
              key={spec.title}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0"
            >
              {spec.type === "3d" && <ThreeDView spec={spec} />}
              {spec.type === "2d-anim" && <TwoDAnimView spec={spec} />}
              {spec.type === "2d-text" && <TwoDTextView spec={spec} />}
              {spec.type === "formula" && <FormulaView spec={spec} />}
              {spec.type === "graph" && <GraphView spec={spec} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {spec && (
        <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-white px-5 py-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--ink-700)]">{spec.caption}</p>
        </footer>
      )}
    </div>
  );
}
