/**
 * GET /api/providers/status
 *
 * One call that powers onboarding + the Settings provider panel: the active
 * provider, device specs, the recommended local model, what Ollama has
 * installed/running, and whether OpenRouter's key validates. Fully resilient.
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings-store";
import { deviceRecommendation } from "@/lib/device";
import { isOllamaRunning, listOllamaModels } from "@/lib/providers/ollama";
import { getOpenRouterKeyInfo } from "@/lib/providers/openrouter";

export const runtime = "nodejs";

export async function GET() {
  const s = loadSettings();
  const { device, recommended } = deviceRecommendation();

  const [running, models] = await Promise.all([
    isOllamaRunning(s.ollamaBaseUrl),
    listOllamaModels(s.ollamaBaseUrl),
  ]);

  const or = s.openrouterApiKey
    ? await getOpenRouterKeyInfo(s.openrouterApiKey)
    : { valid: false, label: null, remaining: null, usage: null };

  return NextResponse.json({
    provider: s.provider,
    device,
    recommended,
    ollama: {
      running,
      models,
      baseUrl: s.ollamaBaseUrl,
      selected: s.ollamaModel,
      recommendedInstalled: models.includes(recommended.model),
      ready:
        running &&
        (s.ollamaModel ? models.includes(s.ollamaModel) : models.length > 0),
    },
    openrouter: {
      hasKey: !!s.openrouterApiKey,
      valid: or.valid,
      label: or.label,
      remaining: or.remaining,
      model: s.openrouterModel,
      ready: or.valid,
    },
    codex: { model: s.codexModel },
  });
}
