/**
 * GET /api/codex/account
 *
 * Provider-aware account summary for the top-bar account button.
 *  - codex      → ChatGPT account decoded from ~/.codex/auth.json + rate limits.
 *  - openrouter → key validity + remaining credit (via /auth/key).
 *  - ollama     → local server status + installed model count (no account).
 *
 * Fully resilient — anything that can't be fetched comes back null so the UI
 * renders "no data" rather than crashing.
 */

import { NextResponse } from "next/server";
import {
  readAccountInfo,
  readRateLimits,
  type CodexAccountInfo,
  type CodexRateLimits,
} from "@/lib/codex-account";
import { loadSettings } from "@/lib/settings-store";
import { getOpenRouterKeyInfo } from "@/lib/providers/openrouter";
import { isOllamaRunning, listOllamaModels } from "@/lib/providers/ollama";

export const runtime = "nodejs";

export async function GET() {
  const s = loadSettings();

  if (s.provider === "openrouter") {
    const info = s.openrouterApiKey
      ? await getOpenRouterKeyInfo(s.openrouterApiKey)
      : { valid: false, label: null, remaining: null, usage: null };
    const account: CodexAccountInfo = {
      email: null,
      name: info.label || "OpenRouter (BYOK)",
      planType: info.valid
        ? info.remaining != null
          ? `$${info.remaining.toFixed(2)} credit left`
          : "key active"
        : "key invalid / missing",
      organizations: [],
      subscriptionActiveUntil: null,
      authMode: "openrouter",
    };
    return NextResponse.json({ provider: "openrouter", account, rateLimits: null });
  }

  if (s.provider === "ollama") {
    const [running, models] = await Promise.all([
      isOllamaRunning(s.ollamaBaseUrl),
      listOllamaModels(s.ollamaBaseUrl),
    ]);
    const account: CodexAccountInfo = {
      email: null,
      name: "Local · Ollama",
      planType: running
        ? `${models.length} model${models.length === 1 ? "" : "s"} installed`
        : "not running",
      organizations: [],
      subscriptionActiveUntil: null,
      authMode: "ollama",
    };
    return NextResponse.json({ provider: "ollama", account, rateLimits: null });
  }

  // codex (default)
  const account: CodexAccountInfo | null = (() => {
    try {
      return readAccountInfo();
    } catch {
      return null;
    }
  })();
  let limits: CodexRateLimits | null = null;
  try {
    limits = await readRateLimits();
  } catch {
    limits = null;
  }
  return NextResponse.json({ provider: "codex", account, rateLimits: limits });
}
