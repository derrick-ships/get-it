/**
 * GET /api/providers/openrouter/models
 *
 * Returns the OpenRouter model catalog so the Settings picker can let the user
 * browse and search the hundreds of available models (not just the curated
 * shortcuts). OpenRouter's /models endpoint is public; we proxy it server-side
 * to avoid CORS and to optionally pass the saved key. Cached in-memory for an
 * hour. On any failure we fall back to the static curated list with a 200 so
 * the picker is never empty/offline-broken.
 */

import { NextResponse } from "next/server";
import { OPENROUTER_BASE_URL, OPENROUTER_MODELS, OPENROUTER_DEFAULT_MODEL } from "@/lib/codex-models";
import { loadSettings } from "@/lib/settings-store";

export const runtime = "nodejs";

type CatalogModel = {
  id: string;
  name: string;
  contextLength?: number | null;
  promptPrice?: number | null;
};

type CacheEntry = { at: number; models: CatalogModel[] };
const ONE_HOUR = 60 * 60 * 1000;
let cache: CacheEntry | null = null;

function staticFallback(): CatalogModel[] {
  return OPENROUTER_MODELS.map((id) => ({ id, name: id }));
}

export async function GET() {
  if (cache && Date.now() - cache.at < ONE_HOUR) {
    return NextResponse.json({
      models: cache.models,
      default: OPENROUTER_DEFAULT_MODEL,
      source: "live",
    });
  }

  const key = loadSettings().openrouterApiKey?.trim();
  try {
    const r = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: key ? { authorization: `Bearer ${key}` } : undefined,
      signal: AbortSignal.timeout(4500),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string };
      }>;
    };
    const models: CatalogModel[] = (j.data ?? [])
      .filter((m): m is { id: string } & typeof m => typeof m.id === "string" && m.id.length > 0)
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length ?? null,
        promptPrice:
          m.pricing && m.pricing.prompt != null ? Number(m.pricing.prompt) : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) throw new Error("empty catalog");
    cache = { at: Date.now(), models };
    return NextResponse.json({ models, default: OPENROUTER_DEFAULT_MODEL, source: "live" });
  } catch {
    return NextResponse.json({
      models: staticFallback(),
      default: OPENROUTER_DEFAULT_MODEL,
      source: "static",
    });
  }
}
