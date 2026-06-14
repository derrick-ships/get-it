/**
 * Back-compat surface. The model layer is now provider-agnostic (see
 * lib/llm/ and lib/providers/), but every agent still imports the same names
 * from "@/lib/codex" — runJson, runJsonInThread, the error model, the health
 * mailbox, and the Codex model lists. This module just re-exports them so no
 * call site had to change when OpenRouter + Ollama were added.
 */

export { runJson, runJsonInThread, getCodexHealth } from "./llm";
export type { RunOptions, CodexHealth } from "./llm";

export {
  CodexError,
  classifyCodexError,
  toCodexErrorPayload,
} from "./codex-errors";
export type { CodexErrorKind } from "./codex-errors";

export { CODEX_MODEL, CODEX_MODELS } from "./codex-models";
