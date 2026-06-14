/**
 * GET  /api/settings    → current persisted AppSettings (or env defaults)
 * POST /api/settings    → merge body into persisted settings
 *
 * The viewer reads this once at mount and writes on every toggle. Settings
 * survive app restarts because they live at <DATA_DIR>/settings.json.
 */

import { NextResponse } from "next/server";
import {
  loadSettings,
  saveSettings,
  normalizeModel,
  normalizeProvider,
  type AppSettings,
} from "@/lib/settings-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(loadSettings());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Partial<AppSettings>;
  const current = loadSettings();
  const next: AppSettings = {
    autoGenerate:
      typeof b.autoGenerate === "boolean" ? b.autoGenerate : current.autoGenerate,
    maxRetries:
      typeof b.maxRetries === "number" && b.maxRetries >= 0
        ? b.maxRetries
        : current.maxRetries,
    provider: b.provider !== undefined ? normalizeProvider(b.provider) : current.provider,
    model: b.model !== undefined ? normalizeModel(b.model) : current.model,
    codexModel:
      b.codexModel !== undefined
        ? normalizeModel(b.codexModel)
        : b.model !== undefined
          ? normalizeModel(b.model)
          : current.codexModel,
    openrouterApiKey:
      typeof b.openrouterApiKey === "string"
        ? b.openrouterApiKey.trim()
        : current.openrouterApiKey,
    openrouterModel:
      typeof b.openrouterModel === "string" && b.openrouterModel.trim()
        ? b.openrouterModel.trim()
        : current.openrouterModel,
    ollamaBaseUrl:
      typeof b.ollamaBaseUrl === "string" && b.ollamaBaseUrl.trim()
        ? b.ollamaBaseUrl.trim()
        : current.ollamaBaseUrl,
    ollamaModel:
      typeof b.ollamaModel === "string" ? b.ollamaModel.trim() : current.ollamaModel,
  };
  saveSettings(next);
  return NextResponse.json(next);
}
