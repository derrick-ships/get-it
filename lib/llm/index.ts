/**
 * Provider-agnostic LLM dispatcher. `runJson` / `runJsonInThread` keep their
 * exact original signatures, so all 11 agent call sites are untouched; here
 * we read the active provider from settings (per call, so a Settings switch
 * takes effect immediately) and route to Codex, OpenRouter, or Ollama. The
 * health mailbox + error classification are shared across providers.
 */

import { loadSettings } from "../settings-store";
import {
  type Provider,
  OPENROUTER_DEFAULT_MODEL,
} from "../codex-models";
import { CodexError, classifyCodexError } from "../codex-errors";
import type { CodexHealth, RunOptions } from "./types";
import {
  codexRunJson,
  codexRunResume,
  codexRunStart,
} from "../providers/codex";
import { openaiCompatRunJson, type OpenAiCompatConfig } from "../providers/openai-compat";
import { ollamaConfig } from "../providers/ollama";
import { openrouterConfig } from "../providers/openrouter";

export type { RunOptions, CodexHealth } from "./types";

function getActiveProvider(): Provider {
  try {
    return loadSettings().provider;
  } catch {
    return "codex";
  }
}

function classify(err: unknown): CodexError {
  return err instanceof CodexError ? err : classifyCodexError(err);
}

/** Build the OpenAI-compatible config for the active non-codex provider. */
function activeHttpConfig(provider: Provider): OpenAiCompatConfig {
  const s = loadSettings();
  if (provider === "ollama") {
    const model = s.ollamaModel?.trim();
    if (!model) {
      throw new CodexError(
        "model_unsupported",
        "No local model selected. Open Settings → choose or download an Ollama model.",
      );
    }
    return ollamaConfig(s.ollamaBaseUrl, model);
  }
  // openrouter
  const key = s.openrouterApiKey?.trim();
  if (!key) {
    throw new CodexError(
      "auth_lost",
      "No OpenRouter API key set. Open Settings → paste your key.",
    );
  }
  const model = s.openrouterModel?.trim() || OPENROUTER_DEFAULT_MODEL;
  return openrouterConfig(key, model);
}

// ── Health mailbox (shared by every provider) ───────────────────────────

declare global {
  var __getitCodexHealth: CodexHealth | undefined;
}

const _initialHealth: CodexHealth = {
  ok: true,
  kind: null,
  message: null,
  retryAt: null,
  window: null,
  serial: 0,
  lastOkAt: null,
  provider: null,
};

const health: CodexHealth =
  globalThis.__getitCodexHealth ??
  (globalThis.__getitCodexHealth = { ..._initialHealth });

export function getCodexHealth(): CodexHealth {
  if (
    health.kind === "rate_limit" &&
    health.retryAt != null &&
    Date.now() >= health.retryAt
  ) {
    Object.assign(health, _initialHealth, { serial: health.serial });
  }
  return { ...health };
}

function markOk(provider: Provider) {
  if (!health.ok) {
    Object.assign(health, _initialHealth, { serial: health.serial + 1 });
  }
  health.lastOkAt = Date.now();
  health.ok = true;
  health.provider = provider;
}

function markError(err: CodexError, provider: Provider) {
  health.ok = false;
  health.kind = err.kind;
  health.message = err.message;
  health.retryAt = err.retryAt ?? null;
  health.window = err.window ?? null;
  health.serial += 1;
  health.provider = provider;
}

function preflightHealth(): CodexError | null {
  if (
    health.kind === "rate_limit" &&
    health.retryAt != null &&
    Date.now() < health.retryAt
  ) {
    return new CodexError("rate_limit", health.message ?? "Rate limit active", {
      retryAt: health.retryAt,
      window: health.window ?? "unknown",
    });
  }
  return null;
}

// ── Public runners ──────────────────────────────────────────────────────

async function providerRunJson<T>(
  provider: Provider,
  prompt: string,
  outputSchema: object,
  opts: RunOptions,
): Promise<{ data: T; usage: unknown }> {
  if (provider === "codex") return codexRunJson<T>(prompt, outputSchema, opts);
  const cfg = activeHttpConfig(provider);
  return openaiCompatRunJson<T>(cfg, prompt, outputSchema, { signal: opts.signal });
}

/** One-shot JSON generation against `outputSchema`. Retries once on a generic
 *  (parse/transient) failure; account-level errors bubble immediately. */
export async function runJson<T>(
  prompt: string,
  outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown }> {
  const preflight = preflightHealth();
  if (preflight) throw preflight;
  const provider = getActiveProvider();

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await providerRunJson<T>(provider, prompt, outputSchema, opts);
      markOk(provider);
      return result;
    } catch (err) {
      lastErr = err;
      const classified = classify(err);
      if (classified.kind !== "generic") {
        markError(classified, provider);
        throw classified;
      }
    }
  }
  const finalErr = classify(lastErr);
  if (finalErr.kind !== "generic") markError(finalErr, provider);
  throw finalErr;
}

/**
 * Multi-turn runner (chat). For Codex this uses real thread resume/start.
 * For stateless HTTP providers, resume is impossible — we throw a generic
 * error so the caller's existing fallback re-sends full context via `start`,
 * which we serve as a one-shot completion (threadId always null).
 */
export async function runJsonInThread<T>(args: {
  outputSchema: object;
  opts?: RunOptions;
  resume?: { threadId: string; input: string };
  start?: { input: string };
}): Promise<{ data: T; usage: unknown; threadId: string | null }> {
  const preflight = preflightHealth();
  if (preflight) throw preflight;
  const provider = getActiveProvider();
  const opts = args.opts ?? {};

  if (provider !== "codex") {
    if (!args.start) {
      // Resume requested but unsupported — trigger the caller's full-context fallback.
      throw new CodexError("generic", "resume unsupported for this provider");
    }
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cfg = activeHttpConfig(provider);
        const { data, usage } = await openaiCompatRunJson<T>(
          cfg,
          args.start.input,
          args.outputSchema,
          { signal: opts.signal },
        );
        markOk(provider);
        return { data, usage, threadId: null };
      } catch (err) {
        lastErr = err;
        const classified = classify(err);
        if (classified.kind !== "generic") {
          markError(classified, provider);
          throw classified;
        }
      }
    }
    const finalErr = classify(lastErr);
    if (finalErr.kind !== "generic") markError(finalErr, provider);
    throw finalErr;
  }

  // ── Codex ──
  if (args.resume) {
    try {
      const r = await codexRunResume<T>(
        args.resume.threadId,
        args.resume.input,
        args.outputSchema,
        opts,
      );
      markOk(provider);
      return r;
    } catch (err) {
      const classified = classify(err);
      if (classified.kind !== "generic") markError(classified, provider);
      throw classified;
    }
  }

  if (!args.start) throw new Error("runJsonInThread: provide `start` or `resume`");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await codexRunStart<T>(args.start.input, args.outputSchema, opts);
      markOk(provider);
      return r;
    } catch (err) {
      lastErr = err;
      const classified = classify(err);
      if (classified.kind !== "generic") {
        markError(classified, provider);
        throw classified;
      }
    }
  }
  const finalErr = classify(lastErr);
  if (finalErr.kind !== "generic") markError(finalErr, provider);
  throw finalErr;
}
