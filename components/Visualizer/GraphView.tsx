"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphSpec } from "@/lib/schemas";

type Props = {
  spec: GraphSpec;
  /** Called once per spec instance if the chart fails to render. */
  onRuntimeError?: (message: string) => void;
};

// Refined, harmonious palette with strong contrast on white.
const PALETTE = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#ec4899", // pink
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ef4444", // red
  "#8b5cf6", // violet
  "#14b8a6", // teal
];
const INK = "#0f172a";
const SUBTLE = "#64748b";
const GRID = "rgba(15,23,42,0.06)";
const AXIS = "rgba(15,23,42,0.20)";

function safeFn(expr: string): (x: number) => number {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function("Math", "x", `return (${expr});`) as (M: typeof Math, x: number) => number;
  return (x: number) => fn(Math, x);
}

/** Compact, readable tick label. */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  if (a < 1) return `${+v.toFixed(2)}`;
  if (a < 100) return `${+v.toFixed(2)}`;
  return `${Math.round(v)}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, Math.abs(h)));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexA(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

export default function GraphView({ spec, onRuntimeError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportedRef = useRef(false);

  useEffect(() => {
    setError(null);
    reportedRef.current = false;
    const reportError = (msg: string) => {
      setError(msg);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onRuntimeError?.(msg);
      }
    };
    const c = canvasRef.current;
    const cont = containerRef.current;
    if (!c || !cont) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const W = cont.clientWidth;
    const H = cont.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const padL = 58;
    const padR = 26;
    const padT = 30;
    const padB = 50;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const labelFont = "600 12px ui-sans-serif, system-ui, sans-serif";
    const tickFont = "500 11px ui-sans-serif, system-ui, sans-serif";
    const legendFont = "500 11.5px ui-sans-serif, system-ui, sans-serif";

    const drawAxisLabels = () => {
      ctx.fillStyle = SUBTLE;
      ctx.font = labelFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(spec.x_label || "", padL + plotW / 2, H - 14);
      ctx.save();
      ctx.translate(16, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "top";
      ctx.fillText(spec.y_label || "", 0, 0);
      ctx.restore();
    };

    type Pt = [number, number];
    type Series = { name?: string; color: string; points: Pt[] };
    const series: Series[] = [];

    try {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(spec.data_json) as Record<string, unknown>;
      } catch (parseErr) {
        throw new Error(`Could not parse graph data_json: ${(parseErr as Error).message}`);
      }

      // ── Bars ──────────────────────────────────────────────────────────
      if (spec.chart_type === "bars") {
        const bars = (data.bars as Array<{ label: string; value: number }>) ?? [];
        if (!bars.length) throw new Error("No bars to plot");
        const maxV = Math.max(...bars.map((b) => b.value), 0);
        const minV = Math.min(...bars.map((b) => b.value), 0);
        const span = maxV - minV || 1;
        const baseY = padT + plotH - ((0 - minV) / span) * plotH;
        const slot = plotW / bars.length;
        const bw = Math.min(slot * 0.62, 64);

        // subtle horizontal guides
        ctx.strokeStyle = GRID;
        ctx.lineWidth = 1;
        ctx.font = tickFont;
        ctx.fillStyle = SUBTLE;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let i = 0; i <= 4; i++) {
          const v = minV + (span * i) / 4;
          const py = padT + plotH - ((v - minV) / span) * plotH;
          ctx.beginPath();
          ctx.moveTo(padL, py);
          ctx.lineTo(padL + plotW, py);
          ctx.stroke();
          ctx.fillText(fmtNum(v), padL - 8, py);
        }

        bars.forEach((b, i) => {
          const cx = padL + i * slot + slot / 2;
          const x = cx - bw / 2;
          const vy = padT + plotH - ((b.value - minV) / span) * plotH;
          const top = Math.min(vy, baseY);
          const h = Math.abs(baseY - vy);
          const color = PALETTE[i % PALETTE.length];
          const grad = ctx.createLinearGradient(0, top, 0, top + h);
          grad.addColorStop(0, color);
          grad.addColorStop(1, hexA(color, 0.72));
          ctx.fillStyle = grad;
          roundRect(ctx, x, top, bw, h || 1, 5);
          ctx.fill();
          // value
          ctx.fillStyle = INK;
          ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(fmtNum(b.value), cx, top - 5);
          // label
          ctx.fillStyle = SUBTLE;
          ctx.font = tickFont;
          ctx.textBaseline = "top";
          const lbl = b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label;
          ctx.fillText(lbl, cx, padT + plotH + 8);
        });
        drawAxisLabels();
        return;
      }

      // ── Series-based (function / points / lines) ──────────────────────
      if (spec.chart_type === "function") {
        const fn = safeFn((data.fn as string) || "x");
        const xMin = (data.x_min as number) ?? -5;
        const xMax = (data.x_max as number) ?? 5;
        const samples = Math.max(20, Math.min(2000, (data.samples as number) ?? 240));
        const pts: Pt[] = [];
        for (let i = 0; i <= samples; i++) {
          const x = xMin + ((xMax - xMin) * i) / samples;
          const y = fn(x);
          if (Number.isFinite(y)) pts.push([x, y]);
        }
        series.push({ color: PALETTE[0], points: pts, name: spec.title });
      } else if (spec.chart_type === "points") {
        series.push({ color: PALETTE[0], points: (data.points as Pt[]) ?? [], name: spec.title });
      } else if (spec.chart_type === "lines") {
        const ss = (data.series as Array<{ name: string; color?: string; points: Pt[] }>) ?? [];
        ss.forEach((s, i) =>
          series.push({ name: s.name, color: s.color || PALETTE[i % PALETTE.length], points: s.points }),
        );
      }

      const allPts = series.flatMap((s) => s.points);
      if (!allPts.length) {
        ctx.fillStyle = SUBTLE;
        ctx.font = labelFont;
        ctx.textAlign = "center";
        ctx.fillText("No data points to plot", W / 2, H / 2);
        return;
      }
      const xs = allPts.map((p) => p[0]);
      const ys = allPts.map((p) => p[1]);
      let xMin = Math.min(...xs);
      let xMax = Math.max(...xs);
      let yMin = Math.min(...ys);
      let yMax = Math.max(...ys);
      if (xMin === xMax) { xMin -= 1; xMax += 1; }
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      const padY = (yMax - yMin) * 0.08;
      yMin -= padY;
      yMax += padY;

      const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
      const sy = (y: number) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

      // Horizontal gridlines + y ticks
      ctx.font = tickFont;
      ctx.fillStyle = SUBTLE;
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yTicks = 5;
      for (let i = 0; i <= yTicks; i++) {
        const y = yMin + ((yMax - yMin) * i) / yTicks;
        const py = sy(y);
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();
        ctx.fillText(fmtNum(y), padL - 8, py);
      }
      // x ticks (marks + labels, no full vertical grid for a cleaner look)
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xTicks = 6;
      for (let i = 0; i <= xTicks; i++) {
        const x = xMin + ((xMax - xMin) * i) / xTicks;
        const px = sx(x);
        ctx.strokeStyle = AXIS;
        ctx.beginPath();
        ctx.moveTo(px, padT + plotH);
        ctx.lineTo(px, padT + plotH + 4);
        ctx.stroke();
        ctx.fillText(fmtNum(x), px, padT + plotH + 9);
      }

      // Zero axes (only when in range)
      ctx.strokeStyle = AXIS;
      ctx.lineWidth = 1.25;
      if (yMin <= 0 && yMax >= 0) {
        ctx.beginPath();
        ctx.moveTo(padL, sy(0));
        ctx.lineTo(padL + plotW, sy(0));
        ctx.stroke();
      }

      const single = series.length === 1;

      series.forEach((s) => {
        if (spec.chart_type === "points") {
          for (const [px, py] of s.points) {
            ctx.beginPath();
            ctx.arc(sx(px), sy(py), 4, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
          return;
        }
        // Area fill under a single line/function for depth.
        if (single && s.points.length > 1) {
          const baseY = sy(Math.max(yMin, Math.min(yMax, 0)));
          const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
          grad.addColorStop(0, hexA(s.color, 0.22));
          grad.addColorStop(1, hexA(s.color, 0.02));
          ctx.beginPath();
          s.points.forEach(([px, py], i) => {
            const X = sx(px), Y = sy(py);
            if (i === 0) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          });
          ctx.lineTo(sx(s.points[s.points.length - 1][0]), baseY);
          ctx.lineTo(sx(s.points[0][0]), baseY);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }
        // Line stroke
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        s.points.forEach(([px, py], i) => {
          const X = sx(px), Y = sy(py);
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        });
        ctx.stroke();
      });

      // Legend (multi-series) — rounded swatches in a soft pill
      if (series.length > 1) {
        ctx.font = legendFont;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const items = series.map((s) => ({ s, w: ctx.measureText(s.name || "").width }));
        const totalW = items.reduce((acc, it) => acc + 16 + it.w + 16, 0);
        let lx = padL + Math.max(8, (plotW - totalW) / 2);
        const ly = padT - 14;
        items.forEach(({ s, w }) => {
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = INK;
          ctx.fillText(s.name || "", lx + 13, ly);
          lx += 16 + w + 16;
        });
      }

      drawAxisLabels();
    } catch (e) {
      console.warn("graph render threw (will be reported for repair):", e);
      reportError(`Graph render failed: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" />
      {error && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}
