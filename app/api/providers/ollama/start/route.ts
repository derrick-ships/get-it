/**
 * POST /api/providers/ollama/start
 *
 * Best-effort "turn Ollama on" for the Settings UI. If Ollama is installed but
 * the server isn't running, the scan finds models yet downloads fail — so we
 * try to spawn `ollama serve` (detached, so it outlives this request) and poll
 * until it answers. If Ollama isn't installed (or isn't on PATH), we return 409
 * with the install URL so the UI can guide the user instead of silently failing.
 *
 * Runs in the Node runtime inside the Electron app, the same place the bundled
 * server and `codex login` are already spawned — no IPC bridge needed.
 */

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { loadSettings } from "@/lib/settings-store";
import { isOllamaRunning } from "@/lib/providers/ollama";
import { isOllamaInstalled } from "@/lib/local-models";

export const runtime = "nodejs";

const INSTALL_URL = "https://ollama.com/download";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST() {
  const s = loadSettings();

  if (await isOllamaRunning(s.ollamaBaseUrl)) {
    return NextResponse.json({ ok: true, running: true });
  }

  if (!(await isOllamaInstalled())) {
    return NextResponse.json(
      { error: "Ollama isn't installed.", installUrl: INSTALL_URL },
      { status: 409 },
    );
  }

  // Try to start the daemon. A GUI-launched, signed app may have a minimal
  // PATH and not find `ollama` — treat that exactly like "not installed".
  try {
    const child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
    child.unref();
    child.on("error", () => {
      /* ENOENT etc. — handled by the poll-timeout fallback below */
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't launch Ollama from here.", installUrl: INSTALL_URL },
      { status: 409 },
    );
  }

  // Poll up to ~6s for the server to come up.
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    if (await isOllamaRunning(s.ollamaBaseUrl)) {
      return NextResponse.json({ ok: true, running: true });
    }
  }

  return NextResponse.json(
    {
      error:
        "Started Ollama but it didn't answer in time. Open the Ollama app, then try again.",
      installUrl: INSTALL_URL,
    },
    { status: 409 },
  );
}
