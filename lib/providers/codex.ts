/**
 * Codex (ChatGPT-account) provider. Wraps @openai/codex-sdk. Extracted from
 * the original lib/codex.ts so the dispatcher in lib/llm can treat it as one
 * backend among several. These functions throw raw errors; the dispatcher
 * classifies them and updates the health mailbox.
 *
 * The SDK is ESM-only and platform-heavy, so it's loaded lazily via dynamic
 * import: a user on Ollama/OpenRouter never pulls it in, and the standalone
 * server only resolves it when the Codex provider is actually used.
 */

import type { Codex, ThreadOptions } from "@openai/codex-sdk";
import { CODEX_SCRATCH_DIR } from "../paths";
import { loadSettings } from "../settings-store";
import { CODEX_MODEL, CODEX_MODELS } from "../codex-models";
import { parseJsonLoose } from "../llm/parse";
import type { RunOptions } from "../llm/types";

/**
 * Service tier for every Codex request.
 *
 * History: gpt-5.x carry a catalog default tier of "flex", which
 * ChatGPT-account auth rejects (400 "Unsupported service_tier: flex").
 * Pinning a tier the binary AND the API accept fixes it. The accepted set
 * changed across Codex binary versions (0.130: only `fast`/`flex`; 0.139+:
 * `default`/`priority`/`flex`), so we make it tunable via env without a
 * rebuild. Default "default" matches the bundled (bumped) 0.139 binary; set
 * GETIT_CODEX_SERVICE_TIER="" to omit it entirely.
 */
function serviceTier(): string | undefined {
  const v = process.env.GETIT_CODEX_SERVICE_TIER;
  if (v === undefined) return "default";
  return v.trim() === "" ? undefined : v.trim();
}

let _codex: Codex | null = null;

async function getCodex(): Promise<Codex> {
  if (_codex) return _codex;
  const { Codex } = await import("@openai/codex-sdk");
  const codexPathOverride = process.env.CODEX_BINARY_PATH;
  const tier = serviceTier();
  _codex = new Codex({
    ...(codexPathOverride ? { codexPathOverride } : {}),
    config: {
      tools: { image_gen: false },
      ...(tier ? { service_tier: tier } : {}),
    },
  });
  return _codex;
}

/** Codex model from settings, else the pinned default. */
function resolveCodexModel(): string {
  try {
    const s = loadSettings();
    const picked = s.codexModel ?? s.model;
    if (picked && (CODEX_MODELS as readonly string[]).includes(picked)) return picked;
  } catch {
    /* fall through */
  }
  return CODEX_MODEL;
}

function threadOptions(opts: RunOptions = {}): ThreadOptions {
  return {
    model: resolveCodexModel(),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    workingDirectory: CODEX_SCRATCH_DIR,
    modelReasoningEffort: opts.reasoning ?? "low",
    webSearchEnabled: opts.webSearch ?? false,
    ...(opts.threadOverrides ?? {}),
  };
}

export async function codexRunJson<T>(
  prompt: string,
  outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown }> {
  const thread = (await getCodex()).startThread(threadOptions(opts));
  const turn = await thread.run(prompt, { outputSchema, signal: opts.signal });
  return { data: parseJsonLoose<T>(turn.finalResponse), usage: turn.usage };
}

export async function codexRunResume<T>(
  threadId: string,
  input: string,
  outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown; threadId: string | null }> {
  const thread = (await getCodex()).resumeThread(threadId, threadOptions(opts));
  const turn = await thread.run(input, { outputSchema, signal: opts.signal });
  return {
    data: parseJsonLoose<T>(turn.finalResponse),
    usage: turn.usage,
    threadId: thread.id ?? threadId,
  };
}

export async function codexRunStart<T>(
  input: string,
  outputSchema: object,
  opts: RunOptions = {},
): Promise<{ data: T; usage: unknown; threadId: string | null }> {
  const thread = (await getCodex()).startThread(threadOptions(opts));
  const turn = await thread.run(input, { outputSchema, signal: opts.signal });
  return {
    data: parseJsonLoose<T>(turn.finalResponse),
    usage: turn.usage,
    threadId: thread.id,
  };
}
