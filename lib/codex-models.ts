/**
 * Codex model identifiers — kept in their own dependency-free module so
 * both the server (lib/codex.ts, lib/settings-store.ts) and client
 * (components/SettingsButton.tsx) can import them without pulling in the
 * Codex SDK or Node-only modules, and without creating an import cycle.
 */

/** Default model — first in the picker, used when no preference is saved. */
export const CODEX_MODEL = "gpt-5.5";

/**
 * Models the user can pick from in Settings. All are valid for ChatGPT-
 * account auth at time of writing. If a model is later retired, OpenAI
 * returns a 400 and the in-app "model unsupported" banner tells the user
 * to switch — they can do so from the Settings dropdown without waiting
 * for an app update.
 */
export const CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5",
  "gpt-5-codex",
] as const;

// ── Providers ───────────────────────────────────────────────────────────

/** The three model backends the app can run agents against. */
export type Provider = "codex" | "openrouter" | "ollama";

export const PROVIDERS: readonly Provider[] = ["codex", "openrouter", "ollama"];

export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

/** Default OpenRouter base URL (OpenAI-compatible). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Default local Ollama base URL. */
export const OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Curated OpenRouter models that follow JSON-schema instructions well, the
 * first being a sensible default. The user can also type any model id.
 */
// Suggestions only — the Settings field is free-text, so ANY OpenRouter model
// id works (openrouter.ai/models has hundreds). These are strong, current
// defaults across price/quality.
export const OPENROUTER_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "anthropic/claude-3.7-sonnet",
  "anthropic/claude-3.5-haiku",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-chat",
  "moonshotai/kimi-k2",
  "x-ai/grok-2-1212",
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen-2.5-72b-instruct",
] as const;

export const OPENROUTER_DEFAULT_MODEL = OPENROUTER_MODELS[0];

/**
 * Recommend a local Ollama model by total RAM (GB). We favour the qwen2.5
 * family for its strong JSON / instruction adherence — the agents demand
 * strict structured output and smaller/older models fail it. The 3B tier is
 * a last resort (weaker on the knowledge-graph schema); we still suggest it
 * so low-RAM machines get *something* runnable.
 */
export function recommendOllamaModel(ramGB: number): {
  model: string;
  approxSizeGB: number;
  note: string;
} {
  if (ramGB < 8) {
    return {
      model: "qwen2.5:3b",
      approxSizeGB: 2,
      note: "Smallest viable model — fine for chat/flashcards/quizzes; the knowledge graph may be weaker.",
    };
  }
  if (ramGB < 16) {
    return {
      model: "qwen2.5:7b",
      approxSizeGB: 4.7,
      note: "Good all-round local model for an 8–16 GB machine.",
    };
  }
  if (ramGB < 32) {
    return {
      model: "qwen2.5:14b",
      approxSizeGB: 9,
      note: "Strong local model for 16–32 GB of RAM.",
    };
  }
  return {
    model: "qwen2.5:32b",
    approxSizeGB: 20,
    note: "High-quality local model for 32 GB+ machines.",
  };
}
