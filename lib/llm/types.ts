/**
 * Provider-neutral options + health types for the LLM layer. The shape is
 * unchanged from the original Codex wrapper so the 11 agent call sites and
 * the health banner keep working without edits.
 */

import type { ThreadOptions } from "@openai/codex-sdk";
import type { CodexErrorKind } from "../codex-errors";

export type RunOptions = {
  /** "low" (default) | "medium" | "high". Maps to Codex reasoning effort; ignored by HTTP providers. */
  reasoning?: "low" | "medium" | "high";
  /** Allow live web search for this call (Codex only). */
  webSearch?: boolean;
  /** AbortSignal forwarded to the underlying request/process. */
  signal?: AbortSignal;
  /** Codex-only thread option overrides. */
  threadOverrides?: Partial<ThreadOptions>;
};

/** Snapshot the health banner polls. `provider` lets the UI phrase copy correctly. */
export type CodexHealth = {
  ok: boolean;
  kind: CodexErrorKind | null;
  message: string | null;
  retryAt: number | null;
  window: "5h" | "weekly" | "unknown" | null;
  serial: number;
  lastOkAt: number | null;
  /** Which provider produced the last result/error. */
  provider: "codex" | "openrouter" | "ollama" | null;
};
