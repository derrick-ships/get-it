/**
 * GET /api/providers/openrouter/models
 *
 * Returns the curated OpenRouter model shortlist for the Settings dropdown.
 * (The user can also type any model id; OpenRouter has thousands, so we don't
 * proxy the full list.)
 */

import { NextResponse } from "next/server";
import { OPENROUTER_MODELS, OPENROUTER_DEFAULT_MODEL } from "@/lib/codex-models";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    models: OPENROUTER_MODELS,
    default: OPENROUTER_DEFAULT_MODEL,
  });
}
