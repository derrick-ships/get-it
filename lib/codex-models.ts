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
