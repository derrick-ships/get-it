/**
 * GET /api/providers/ollama/models
 *
 * Lists locally-installed Ollama models, whether the server is running, and
 * the device-appropriate recommendation. Drives the model dropdown +
 * "Download recommended" button in Settings.
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings-store";
import { deviceRecommendation } from "@/lib/device";
import { isOllamaRunning, listOllamaModels } from "@/lib/providers/ollama";

export const runtime = "nodejs";

export async function GET() {
  const s = loadSettings();
  const [running, models] = await Promise.all([
    isOllamaRunning(s.ollamaBaseUrl),
    listOllamaModels(s.ollamaBaseUrl),
  ]);
  const { device, recommended } = deviceRecommendation();
  return NextResponse.json({
    running,
    models,
    selected: s.ollamaModel,
    baseUrl: s.ollamaBaseUrl,
    device,
    recommended,
    recommendedInstalled: models.includes(recommended.model),
  });
}
