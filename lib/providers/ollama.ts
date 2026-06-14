/**
 * Local Ollama provider. Generation goes through the shared
 * OpenAI-compatible client at `{base}/v1`; the native `/api/*` endpoints are
 * used for detection, listing installed models, and pulling new ones.
 */

import { OLLAMA_BASE_URL } from "../codex-models";
import type { OpenAiCompatConfig } from "./openai-compat";

export function normalizeOllamaBase(url?: string): string {
  const base = (url && url.trim()) || OLLAMA_BASE_URL;
  return base.replace(/\/$/, "");
}

export function ollamaConfig(baseUrl: string | undefined, model: string): OpenAiCompatConfig {
  const base = normalizeOllamaBase(baseUrl);
  return {
    baseUrl: `${base}/v1`,
    model,
    label: "Ollama",
    providerDownMessage: `Ollama isn't reachable at ${base}. Make sure Ollama is installed and running, then try again.`,
  };
}

async function timed(url: string, init?: RequestInit, ms = 2500): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/** Is an Ollama server answering at this base URL? */
export async function isOllamaRunning(baseUrl?: string): Promise<boolean> {
  const base = normalizeOllamaBase(baseUrl);
  try {
    const r = await timed(`${base}/api/version`);
    return r.ok;
  } catch {
    return false;
  }
}

/** Names of installed models, e.g. ["qwen2.5:7b", "llama3.2:3b"]. */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const base = normalizeOllamaBase(baseUrl);
  try {
    const r = await timed(`${base}/api/tags`);
    if (!r.ok) return [];
    const j = (await r.json()) as { models?: Array<{ name?: string }> };
    return (j.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string");
  } catch {
    return [];
  }
}

/**
 * Start a streaming model pull. Returns the raw streaming Response so a route
 * can forward Ollama's newline-delimited JSON progress to the browser. Long-
 * running (multi-GB) — the route must not buffer it.
 */
export async function pullOllamaModelStream(
  baseUrl: string | undefined,
  model: string,
  signal?: AbortSignal,
): Promise<Response> {
  const base = normalizeOllamaBase(baseUrl);
  return fetch(`${base}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
}
