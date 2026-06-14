/**
 * Persistent app settings.
 *
 * Source-of-truth for runtime knobs the user can toggle from the
 * Settings popover. Reads:
 *   1. Saved JSON at <DATA_DIR>/settings.json (if it exists — i.e. the
 *      user has touched the controls at some point).
 *   2. Otherwise, the build-time defaults from `.env` (NEXT_PUBLIC_*).
 *   3. Otherwise, hardcoded fallbacks.
 *
 * Saved settings survive app restarts, OS reboots, and (in the packaged
 * Electron app) the dynamic localhost port that changes between launches
 * — that's why we don't lean on localStorage here.
 *
 * Schema stays at v1: every field added for multi-provider support is
 * optional with a default, so pre-existing v1 files load unchanged and just
 * gain the new defaults.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "./config";
import {
  CODEX_MODEL,
  CODEX_MODELS,
  OLLAMA_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  isProvider,
  type Provider,
} from "./codex-models";

export type AppSettings = {
  autoGenerate: boolean;
  maxRetries: number;
  /** Active model backend. */
  provider: Provider;
  /** Legacy alias for codexModel, kept in sync for back-compat readers. */
  model: string;
  /** Codex (ChatGPT) model — one of CODEX_MODELS. */
  codexModel: string;
  /** OpenRouter BYOK key (stored locally). */
  openrouterApiKey: string;
  /** OpenRouter model id (free-form). */
  openrouterModel: string;
  /** Local Ollama base URL. */
  ollamaBaseUrl: string;
  /** Selected local Ollama model (empty until chosen/installed). */
  ollamaModel: string;
};

const VERSION = 1 as const;
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

function defaultsFromEnv(): AppSettings {
  return {
    autoGenerate: AUTO_GENERATE_VIZ,
    maxRetries: MAX_VIZ_GEN_RETRIES,
    provider: "codex",
    model: CODEX_MODEL,
    codexModel: CODEX_MODEL,
    openrouterApiKey: "",
    openrouterModel: OPENROUTER_DEFAULT_MODEL,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    ollamaModel: "",
  };
}

/** Coerce an arbitrary value to a supported Codex model id, else the default. */
export function normalizeModel(v: unknown): string {
  return typeof v === "string" && (CODEX_MODELS as readonly string[]).includes(v)
    ? v
    : CODEX_MODEL;
}

export function normalizeProvider(v: unknown): Provider {
  return isProvider(v) ? v : "codex";
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

export function loadSettings(): AppSettings {
  const env = defaultsFromEnv();
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { v: number } & Partial<AppSettings>;
    if (parsed && parsed.v === VERSION) {
      const codexModel = normalizeModel(parsed.codexModel ?? parsed.model);
      return {
        autoGenerate:
          typeof parsed.autoGenerate === "boolean"
            ? parsed.autoGenerate
            : env.autoGenerate,
        maxRetries:
          typeof parsed.maxRetries === "number" && parsed.maxRetries >= 0
            ? Math.min(10, Math.floor(parsed.maxRetries))
            : env.maxRetries,
        provider: normalizeProvider(parsed.provider),
        model: codexModel,
        codexModel,
        openrouterApiKey: str(parsed.openrouterApiKey, env.openrouterApiKey).trim(),
        openrouterModel:
          str(parsed.openrouterModel, env.openrouterModel).trim() || env.openrouterModel,
        ollamaBaseUrl:
          str(parsed.ollamaBaseUrl, env.ollamaBaseUrl).trim() || env.ollamaBaseUrl,
        ollamaModel: str(parsed.ollamaModel, env.ollamaModel).trim(),
      };
    }
  } catch {
    /* file missing or malformed — fall through to env defaults */
  }
  return env;
}

export function saveSettings(s: AppSettings): void {
  const codexModel = normalizeModel(s.codexModel ?? s.model);
  const file = {
    v: VERSION,
    savedAt: Date.now(),
    autoGenerate: !!s.autoGenerate,
    maxRetries: Math.min(10, Math.max(0, Math.floor(s.maxRetries))),
    provider: normalizeProvider(s.provider),
    model: codexModel,
    codexModel,
    openrouterApiKey: (s.openrouterApiKey ?? "").trim(),
    openrouterModel: (s.openrouterModel ?? "").trim() || OPENROUTER_DEFAULT_MODEL,
    ollamaBaseUrl: (s.ollamaBaseUrl ?? "").trim() || OLLAMA_BASE_URL,
    ollamaModel: (s.ollamaModel ?? "").trim(),
  };
  const tmp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, SETTINGS_PATH);
}
