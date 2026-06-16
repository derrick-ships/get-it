"use client";

/**
 * Reader "Customize appearance" popover (Readwise-style). Theme (Light/Dark/
 * Auto), typeface (Serif/Sans), font size, line spacing, line width. Edits flow
 * straight to onChange; the parent persists. Closes on Escape / outside click.
 */

import { useEffect, useRef } from "react";
import { Minus, Moon, Plus, Sun, SunMoon } from "lucide-react";
import {
  FONT_SIZE,
  LINE_HEIGHT,
  WIDTH_ORDER,
  clamp,
  roundStep,
  type ReaderPrefs,
  type ReaderThemeChoice,
  type ReaderWidth,
} from "@/lib/reader-prefs";

const THEMES: { value: ReaderThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "auto", label: "Auto", Icon: SunMoon },
];

const WIDTH_LABEL: Record<ReaderWidth, string> = {
  narrow: "Narrow",
  medium: "Medium",
  wide: "Wide",
};

export default function ReaderAppearance({
  prefs,
  onChange,
  onClose,
}: {
  prefs: ReaderPrefs;
  onChange: (p: ReaderPrefs) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      clearTimeout(t);
    };
  }, [onClose]);

  const set = (patch: Partial<ReaderPrefs>) => onChange({ ...prefs, ...patch });
  const bumpFont = (d: number) =>
    set({ fontSize: clamp(prefs.fontSize + d, FONT_SIZE.min, FONT_SIZE.max) });
  const bumpLine = (d: number) =>
    set({ lineHeight: clamp(roundStep(prefs.lineHeight + d), LINE_HEIGHT.min, LINE_HEIGHT.max) });
  const bumpWidth = (d: number) => {
    const i = clamp(WIDTH_ORDER.indexOf(prefs.width) + d, 0, WIDTH_ORDER.length - 1);
    set({ width: WIDTH_ORDER[i] });
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Customize appearance"
      className="absolute right-2 top-[44px] z-40 w-[300px] rounded-xl border p-3 shadow-[0_16px_44px_rgba(0,0,0,0.28)]"
      style={{
        background: "var(--reader-bg)",
        borderColor: "var(--reader-rule)",
        color: "var(--reader-ink)",
      }}
    >
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--reader-muted)" }}>
        System theme
      </p>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {THEMES.map(({ value, label, Icon }) => {
          const active = prefs.theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => set({ theme: value })}
              className="flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium transition"
              style={{
                borderColor: active ? "var(--reader-accent)" : "var(--reader-rule)",
                background: active ? "color-mix(in srgb, var(--reader-accent) 14%, transparent)" : "transparent",
                color: active ? "var(--reader-ink)" : "var(--reader-muted)",
              }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--reader-muted)" }}>
        Text styles
      </p>

      <Row label="Typeface">
        <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--reader-rule)" }}>
          {(["serif", "sans"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ typeface: t })}
              className="px-2.5 py-1 text-[12px] font-medium transition"
              style={{
                background: prefs.typeface === t ? "var(--reader-accent)" : "transparent",
                color: prefs.typeface === t ? "#fff" : "var(--reader-muted)",
              }}
            >
              {t === "serif" ? "Serif" : "Sans"}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Font size">
        <Stepper
          value={`${prefs.fontSize}px`}
          onDec={() => bumpFont(-FONT_SIZE.step)}
          onInc={() => bumpFont(FONT_SIZE.step)}
          decDisabled={prefs.fontSize <= FONT_SIZE.min}
          incDisabled={prefs.fontSize >= FONT_SIZE.max}
        />
      </Row>

      <Row label="Line spacing">
        <Stepper
          value={prefs.lineHeight.toFixed(1)}
          onDec={() => bumpLine(-LINE_HEIGHT.step)}
          onInc={() => bumpLine(LINE_HEIGHT.step)}
          decDisabled={prefs.lineHeight <= LINE_HEIGHT.min}
          incDisabled={prefs.lineHeight >= LINE_HEIGHT.max}
        />
      </Row>

      <Row label="Line width">
        <Stepper
          value={WIDTH_LABEL[prefs.width]}
          onDec={() => bumpWidth(-1)}
          onInc={() => bumpWidth(1)}
          decDisabled={prefs.width === "narrow"}
          incDisabled={prefs.width === "wide"}
        />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[13px]">{label}</span>
      {children}
    </div>
  );
}

function Stepper({
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  value: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-[42px] text-right text-[12px]" style={{ color: "var(--reader-muted)" }}>
        {value}
      </span>
      <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--reader-rule)" }}>
        <StepBtn onClick={onDec} disabled={decDisabled}>
          <Minus className="h-3.5 w-3.5" />
        </StepBtn>
        <span className="w-px self-stretch" style={{ background: "var(--reader-rule)" }} />
        <StepBtn onClick={onInc} disabled={incDisabled}>
          <Plus className="h-3.5 w-3.5" />
        </StepBtn>
      </div>
    </div>
  );
}

function StepBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-8 items-center justify-center transition disabled:opacity-35"
      style={{ color: "var(--reader-ink)" }}
    >
      {children}
    </button>
  );
}
