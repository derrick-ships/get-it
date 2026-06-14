/**
 * GET /api/providers/local-scan
 *
 * Deep local-model finder. Walks the machine's well-known model stores
 * (Ollama, LM Studio, llama.cpp, the Hugging Face cache) plus any
 * user-configured directories, and reports what it finds — even when no
 * server is running. This is what lets the app answer "where is my Gemma?".
 *
 * Read-only and resilient: bounded walk, never throws.
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings-store";
import { scanLocalModels } from "@/lib/local-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = loadSettings();
  const result = await scanLocalModels({ extraDirs: s.localModelDirs });
  return NextResponse.json(result);
}
