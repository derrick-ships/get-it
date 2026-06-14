/**
 * POST /api/providers/ollama/pull   { model: string }
 *
 * Streams Ollama's model download. Ollama returns newline-delimited JSON
 * progress objects ({ status, total?, completed? }); we forward that stream
 * straight to the browser so the Settings UI can render a progress bar. The
 * download is multi-GB and long-running — we pipe, never buffer.
 */

import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings-store";
import { pullOllamaModelStream } from "@/lib/providers/ollama";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let model: string | undefined;
  try {
    model = (await req.json())?.model;
  } catch {
    /* ignore */
  }
  if (!model || typeof model !== "string") {
    return NextResponse.json({ error: "model required" }, { status: 400 });
  }

  const s = loadSettings();
  let upstream: Response;
  try {
    upstream = await pullOllamaModelStream(s.ollamaBaseUrl, model, req.signal);
  } catch {
    return NextResponse.json(
      { error: "Ollama isn't reachable. Make sure it's installed and running." },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Ollama pull failed (HTTP ${upstream.status}).` },
      { status: 502 },
    );
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
