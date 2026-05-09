"use client";

import { useEffect, useRef, useState } from "react";
import { compileFn } from "@/lib/viz-runtime";
import type { TwoDAnimSpec } from "@/lib/schemas";

type Props = { spec: TwoDAnimSpec };

export default function TwoDAnimView({ spec }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    type DrawFn = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      t: number,
      dt: number,
    ) => void;
    let drawCb: DrawFn | null = null;
    let lastT = performance.now();
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    try {
      const fn = compileFn(spec.setup_code);
      const ret = fn({ ctx, width: container.clientWidth, height: container.clientHeight }) as
        | { draw?: DrawFn }
        | undefined;
      if (ret && typeof ret.draw === "function") drawCb = ret.draw;
    } catch (e) {
      console.error("2D anim setup error", e);
      setError(`Animation crashed at setup: ${(e as Error).message}`);
    }

    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = (now - lastT) / 1000;
      lastT = now;
      try {
        drawCb?.(ctx, container.clientWidth, container.clientHeight, t, dt);
      } catch (e) {
        console.error("2D anim draw error", e);
        setError(`Animation crashed: ${(e as Error).message}`);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
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
