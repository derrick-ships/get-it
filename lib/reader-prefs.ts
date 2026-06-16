/**
 * Reader appearance preferences — global reading settings (not per-doc),
 * persisted to localStorage and applied to the Reader via CSS variables +
 * a data-typeface attribute. Mirrors Readwise's "Customize appearance".
 */

export type ReaderThemeChoice = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";
export type ReaderTypeface = "serif" | "sans";
export type ReaderWidth = "narrow" | "medium" | "wide";

export type ReaderPrefs = {
  theme: ReaderThemeChoice;
  typeface: ReaderTypeface;
  fontSize: number; // px
  lineHeight: number; // unitless multiplier
  width: ReaderWidth;
};

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  theme: "auto",
  typeface: "serif",
  fontSize: 18,
  lineHeight: 1.7,
  width: "medium",
};

export const FONT_SIZE = { min: 14, max: 24, step: 1 } as const;
export const LINE_HEIGHT = { min: 1.3, max: 2.1, step: 0.1 } as const;
export const WIDTH_CH: Record<ReaderWidth, number> = {
  narrow: 58,
  medium: 68,
  wide: 82,
};
export const WIDTH_ORDER: ReaderWidth[] = ["narrow", "medium", "wide"];

const KEY = "getit:reader-prefs";
const LEGACY_THEME_KEY = "getit:reader-theme";

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Round a line-height to one decimal so −/+ steps don't drift on floats. */
export function roundStep(n: number): number {
  return Math.round(n * 10) / 10;
}

function coerce(raw: Partial<ReaderPrefs> | null | undefined): ReaderPrefs {
  const d = DEFAULT_READER_PREFS;
  const theme: ReaderThemeChoice =
    raw?.theme === "light" || raw?.theme === "dark" || raw?.theme === "auto" ? raw.theme : d.theme;
  const typeface: ReaderTypeface = raw?.typeface === "sans" ? "sans" : "serif";
  const width: ReaderWidth =
    raw?.width === "narrow" || raw?.width === "wide" ? raw.width : "medium";
  const fontSize = clamp(
    typeof raw?.fontSize === "number" ? Math.round(raw.fontSize) : d.fontSize,
    FONT_SIZE.min,
    FONT_SIZE.max,
  );
  const lineHeight = clamp(
    typeof raw?.lineHeight === "number" ? roundStep(raw.lineHeight) : d.lineHeight,
    LINE_HEIGHT.min,
    LINE_HEIGHT.max,
  );
  return { theme, typeface, fontSize, lineHeight, width };
}

export function loadReaderPrefs(): ReaderPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_READER_PREFS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return coerce(JSON.parse(raw) as Partial<ReaderPrefs>);
    // Migrate the old single light/dark toggle into the new prefs object.
    const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === "light" || legacy === "dark") {
      return coerce({ theme: legacy });
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_READER_PREFS };
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/** Resolve "auto" against the OS preference; "light"/"dark" pass through. */
export function resolveTheme(choice: ReaderThemeChoice): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/** Stable, URL-ish id for a heading (used for the table-of-contents anchors). */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

/** Words-per-minute reading-time estimate (min 1 minute). */
export function readingTimeMinutes(text: string, wpm = 200): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / wpm));
}
