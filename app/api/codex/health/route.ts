/**
 * GET /api/codex/health
 *
 * Lightweight status read for the in-app banner. Returns the current
 * Codex-health snapshot from lib/codex.ts. No Codex call is made; this
 * is safe to poll at a fast cadence.
 */

import { NextResponse } from "next/server";
import { getCodexHealth } from "@/lib/codex";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getCodexHealth());
}
