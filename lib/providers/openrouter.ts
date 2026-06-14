/**
 * OpenRouter provider (BYOK). Generation goes through the shared
 * OpenAI-compatible client; `/auth/key` is used to validate the key and read
 * the credit balance for the account UI.
 */

import { OPENROUTER_BASE_URL } from "../codex-models";
import type { OpenAiCompatConfig } from "./openai-compat";

// OpenRouter asks integrators to identify themselves; harmless if omitted.
const ATTRIBUTION_HEADERS = {
  "HTTP-Referer": "https://github.com/derrick-ships/get-it",
  "X-Title": "Get It.",
};

export function openrouterConfig(apiKey: string, model: string): OpenAiCompatConfig {
  return {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey,
    model,
    label: "OpenRouter",
    providerDownMessage:
      "Couldn't reach OpenRouter. Check your internet connection and try again.",
    extraHeaders: ATTRIBUTION_HEADERS,
  };
}

export type OpenRouterKeyInfo = {
  valid: boolean;
  label: string | null;
  /** Remaining credit in USD, when the account exposes a limit. null = unmetered. */
  remaining: number | null;
  usage: number | null;
};

/** Validate the key and read credit balance via GET /auth/key. */
export async function getOpenRouterKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo> {
  if (!apiKey || !apiKey.trim()) return { valid: false, label: null, remaining: null, usage: null };
  try {
    const r = await fetch(`${OPENROUTER_BASE_URL}/auth/key`, {
      headers: { authorization: `Bearer ${apiKey}`, ...ATTRIBUTION_HEADERS },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return { valid: false, label: null, remaining: null, usage: null };
    const j = (await r.json()) as {
      data?: { label?: string; usage?: number; limit?: number | null };
    };
    const d = j.data ?? {};
    const remaining =
      typeof d.limit === "number" && typeof d.usage === "number"
        ? Math.max(0, d.limit - d.usage)
        : null;
    return {
      valid: true,
      label: d.label ?? null,
      remaining,
      usage: typeof d.usage === "number" ? d.usage : null,
    };
  } catch {
    return { valid: false, label: null, remaining: null, usage: null };
  }
}
