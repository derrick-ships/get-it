"use client";

/**
 * Mind map — a NotebookLM-style expandable hierarchical map of the document,
 * derived from the knowledge graph (lib/kg). The KG is a graph, so we build a
 * spanning tree (BFS from the highest-degree concept, one branch per connected
 * component) rooted at the document, then render it left-to-right with
 * collapsible branches and zoom. Reuses GET /api/kg/[docId]/state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Minus, Plus, RefreshCw, ListTree } from "lucide-react";
import type { KGNode, KGEdge, KnowledgeGraphStatus } from "@/lib/kg-types";

type KGState = {
  status: KnowledgeGraphStatus;
  nodes: KGNode[];
  edges: KGEdge[];
  globalNote: string;
};

type Tree = {
  byId: Map<string, KGNode>;
  childrenOf: Map<string, string[]>;
  topRoots: string[];
};

const BRANCH_COLORS = [
  "#4f5ae0",
  "#0d9488",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0284c7",
  "#059669",
  "#dc2626",
];

function buildTree(nodes: KGNode[], edges: KGEdge[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }
  const degree = (id: string) => adj.get(id)?.length ?? 0;
  const visited = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  const topRoots: string[] = [];
  const order = [...nodes].sort((a, b) => degree(b.id) - degree(a.id));
  for (const start of order) {
    if (visited.has(start.id)) continue;
    topRoots.push(start.id);
    visited.add(start.id);
    const q = [start.id];
    while (q.length) {
      const cur = q.shift()!;
      const kids = (adj.get(cur) ?? [])
        .filter((x) => !visited.has(x))
        .sort((a, b) => degree(b) - degree(a));
      childrenOf.set(cur, kids);
      for (const k of kids) {
        visited.add(k);
        q.push(k);
      }
    }
  }
  return { byId, childrenOf, topRoots };
}

export default function MindMapView({ docId }: { docId: string }) {
  const [state, setState] = useState<KGState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);

  const load = useCallback(() => {
    fetch(`/api/kg/${docId}/state`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: KGState | null) => j && setState(j))
      .catch(() => {});
  }, [docId]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      // Keep polling while the graph is still building.
      setState((cur) => {
        if (!cur || cur.status === "building") load();
        return cur;
      });
    }, 4000);
    return () => clearInterval(id);
  }, [load]);

  const tree = useMemo(
    () => (state ? buildTree(state.nodes, state.edges) : null),
    [state],
  );

  // Collapse everything past depth 2 on first load so the map opens tidy.
  useEffect(() => {
    if (!tree) return;
    const deep = new Set<string>();
    const walk = (id: string, depth: number) => {
      if (depth >= 2) deep.add(id);
      for (const c of tree.childrenOf.get(id) ?? []) walk(c, depth + 1);
    };
    tree.topRoots.forEach((r) => walk(r, 1));
    setCollapsed(deep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.nodes.length]);

  const toggle = (id: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!state || (state.status === "building" && state.nodes.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-[var(--ink-500)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" />
        {state?.status === "building" ? "Building the mind map…" : "Loading…"}
      </div>
    );
  }
  if (state.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-[13px] text-[var(--ink-500)]">
        <ListTree className="h-8 w-8 text-[var(--ink-300)]" />
        <p>No knowledge graph yet — generate the document’s concepts to build the mind map.</p>
      </div>
    );
  }

  const renderNode = (id: string, depth: number, colorIdx: number): React.ReactNode => {
    const node = tree!.byId.get(id);
    if (!node) return null;
    const kids = tree!.childrenOf.get(id) ?? [];
    const isCollapsed = collapsed.has(id);
    const color = BRANCH_COLORS[colorIdx % BRANCH_COLORS.length];
    return (
      <div key={id} className="flex items-center">
        <div className="flex flex-col items-start">
          <button
            type="button"
            onClick={() => kids.length > 0 && toggle(id)}
            title={node.summary || node.label}
            className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] font-medium transition hover:shadow-sm"
            style={{
              borderColor: color,
              color: "var(--reader-ink, var(--ink-900))",
              background: depth === 0 ? color : "var(--surface-raised, #fff)",
              ...(depth === 0 ? { color: "#fff" } : {}),
            }}
          >
            {kids.length > 0 && (
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                style={{ color: depth === 0 ? "#fff" : color }}
              />
            )}
            <span className="truncate">{node.label}</span>
          </button>
        </div>
        {kids.length > 0 && !isCollapsed && (
          <>
            <div className="h-px w-5 shrink-0" style={{ background: color }} />
            <div className="flex flex-col gap-2 border-l-2 pl-3" style={{ borderColor: color }}>
              {kids.map((k) => renderNode(k, depth + 1, depth === 0 ? colorIdx : colorIdx))}
            </div>
          </>
        )}
      </div>
    );
  };

  const rootLabel = "Document";

  return (
    <div className="relative h-full overflow-auto bg-[var(--surface-raised)]">
      {/* Zoom controls */}
      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-white shadow-sm">
        <button type="button" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))} aria-label="Zoom in" className="flex h-7 w-7 items-center justify-center text-[var(--ink-600)] hover:bg-[var(--surface-sunken)]">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} aria-label="Zoom out" className="flex h-7 w-7 items-center justify-center text-[var(--ink-600)] hover:bg-[var(--surface-sunken)]">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom" className="flex h-7 w-7 items-center justify-center text-[var(--ink-600)] hover:bg-[var(--surface-sunken)]">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className="min-w-max p-6" style={{ transform: `scale(${zoom})`, transformOrigin: "left top" }}>
        <div className="flex items-center">
          {/* Synthetic root */}
          <div
            className="inline-flex items-center rounded-lg px-3 py-2 text-[13px] font-bold text-white shadow"
            style={{ background: "var(--ink-900)" }}
          >
            {rootLabel}
          </div>
          <div className="h-px w-5 shrink-0 bg-[var(--ink-400)]" />
          <div className="flex flex-col gap-3">
            {tree!.topRoots.map((r, i) => renderNode(r, 0, i))}
          </div>
        </div>
      </div>
    </div>
  );
}
