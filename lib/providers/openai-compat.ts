/**
 * Minimal OpenAI-compatible chat client used by BOTH OpenRouter and local
 * Ollama. Both expose `POST {baseUrl}/chat/completions` with the OpenAI
 * request/response shape and support structured output via `response_format`.
 *
 * Design choices for "works with every connection":
 *  - The agent's JSON Schema is sent as `response_format: json_schema`
 *    (strict) AND appended to the prompt, because smaller local models obey
 *    in-prompt instructions more reliably than the param alone.
 *  - If a provider/model rejects `json_schema` (some do), we fall back to
 *    `json_object`, then to no format at all — the lenient parser + one retry
 *    in the dispatcher recover the JSON.
 *  - HTTP/transport failures are mapped to CodexError kinds so the existing
 *    health banner and inline error UI keep working unchanged.
 */

import { CodexError } from "../codex-errors";
import { parseJsonLoose } from "../llm/parse";

export type OpenAiCompatConfig = {
  /** Base URL INCLUDING the version segment, e.g. https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Human label for error messages, e.g. "OpenRouter" or "Ollama". */
  label: string;
  /** Message to surface when the endpoint is unreachable (provider down). */
  providerDownMessage: string;
  extraHeaders?: Record<string, string>;
};

type Format =
  | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: object } }
  | { type: "json_object" }
  | null;

function headersFor(cfg: OpenAiCompatConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    ...(cfg.extraHeaders ?? {}),
  };
}

/** Map an HTTP error response to a classified CodexError. */
async function errorFor(
  cfg: OpenAiCompatConfig,
  res: Response,
): Promise<CodexError> {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    /* ignore */
  }
  const detail = bodyText.slice(0, 500);
  const status = res.status;
  if (status === 401 || status === 403) {
    return new CodexError(
      "auth_lost",
      `${cfg.label}: API key rejected (${status}). ${detail}`,
    );
  }
  if (status === 402) {
    return new CodexError(
      "generic",
      `${cfg.label}: out of credits or payment required (402). Add credits and try again.`,
    );
  }
  if (status === 404 && /model/i.test(detail)) {
    return new CodexError(
      "model_unsupported",
      `${cfg.label}: model "${cfg.model}" not found. ${cfg.label === "Ollama" ? "Pull it first, or pick an installed model." : "Pick a different model."}`,
    );
  }
  if (status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryAt = Number.isFinite(retryAfter) && retryAfter > 0
      ? Date.now() + retryAfter * 1000
      : Date.now() + 60_000;
    return new CodexError("rate_limit", `${cfg.label}: rate limit (429). ${detail}`, {
      retryAt,
      window: "unknown",
    });
  }
  return new CodexError("generic", `${cfg.label}: HTTP ${status}. ${detail}`);
}

/** True when an error indicates the request body / response_format was rejected. */
function isFormatRejection(err: CodexError): boolean {
  return (
    err.kind === "generic" &&
    /response_format|json_schema|schema|unsupported|invalid|400/i.test(err.message)
  );
}

export async function openaiCompatRunJson<T>(
  cfg: OpenAiCompatConfig,
  prompt: string,
  schema: object,
  opts: { schemaName?: string; signal?: AbortSignal } = {},
): Promise<{ data: T; usage: unknown }> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const name = (opts.schemaName ?? "result").replace(/[^a-zA-Z0-9_]/g, "_");

  const content =
    `${prompt}\n\nRespond with ONLY a single JSON object that conforms to this JSON Schema — no prose, no markdown fences:\n` +
    JSON.stringify(schema);

  const ladder: Format[] = [
    { type: "json_schema", json_schema: { name, strict: true, schema } },
    { type: "json_object" },
    null,
  ];

  let lastErr: CodexError | null = null;

  for (const format of ladder) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [{ role: "user", content }],
      stream: false,
      temperature: 0.2,
    };
    if (format) body.response_format = format;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: headersFor(cfg),
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch {
      // Transport failure: endpoint unreachable (Ollama not running, no net).
      throw new CodexError("binary_missing", cfg.providerDownMessage);
    }

    if (!res.ok) {
      const err = await errorFor(cfg, res);
      lastErr = err;
      // Only the format ladder is worth retrying; real auth/rate/model errors
      // bubble immediately.
      if (isFormatRejection(err) && format !== null) continue;
      throw err;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    const text = json.choices?.[0]?.message?.content;
    const data = parseJsonLoose<T>(text);
    return { data, usage: json.usage ?? null };
  }

  throw lastErr ?? new CodexError("generic", `${cfg.label}: request failed`);
}
