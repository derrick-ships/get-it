"use client";

/**
 * Provider configuration block for the Settings popover (and reused by the
 * first-run onboarding card). Lets the user pick ChatGPT / OpenRouter /
 * Ollama, enter the relevant credentials, choose a model, and — for Ollama —
 * see the device-recommended model and download it in one click with a live
 * progress bar. Persists to /api/settings and broadcasts SETTINGS_EVENT.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Cpu,
  Download,
  FolderSearch,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { CODEX_MODELS, OPENROUTER_MODELS } from "@/lib/codex-models";
import { SETTINGS_EVENT } from "@/lib/settings-event";

type Provider = "codex" | "openrouter" | "ollama";

type Settings = {
  provider: Provider;
  codexModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
};

type Status = {
  provider: Provider;
  device: { ramGB: number; cores: number; arch: string; platform: string };
  recommended: { model: string; approxSizeGB: number; note: string };
  ollama: {
    running: boolean;
    models: string[];
    baseUrl: string;
    selected: string;
    recommendedInstalled: boolean;
    ready: boolean;
  };
  openrouter: {
    hasKey: boolean;
    valid: boolean;
    label: string | null;
    remaining: number | null;
    model: string;
    ready: boolean;
  };
  codex: { model: string };
};

type LocalModel = {
  kind: "ollama" | "lmstudio" | "gguf" | "huggingface";
  id: string;
  path: string;
  sizeGB: number | null;
  usable: boolean;
  hint?: string;
};

type LocalScan = {
  models: LocalModel[];
  scannedDirs: string[];
  ollamaRoot: string | null;
  ollamaInstalled: boolean;
};

const PROVIDERS: { id: Provider; label: string; Icon: typeof Cloud }[] = [
  { id: "codex", label: "ChatGPT", Icon: Cloud },
  { id: "openrouter", label: "OpenRouter", Icon: KeyRound },
  { id: "ollama", label: "Ollama", Icon: HardDrive },
];

export default function ProviderSettings({ onProviderReady }: { onProviderReady?: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [scan, setScan] = useState<LocalScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const hydrated = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/providers/status", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/settings", { cache: "no-store" });
        const s = (await r.json()) as Settings;
        if (cancelled) return;
        setSettings(s);
        setKeyDraft(s.openrouterApiKey || "");
        setUrlDraft(s.ollamaBaseUrl || "");
        hydrated.current = true;
      } catch {
        hydrated.current = true;
      }
      await loadStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  const persist = useCallback(
    async (delta: Partial<Settings>) => {
      if (!hydrated.current) return;
      setSettings((cur) => (cur ? { ...cur, ...delta } : cur));
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(delta),
        });
        const next = await r.json();
        try {
          window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: next }));
        } catch {
          /* ignore */
        }
        await loadStatus();
        onProviderReady?.();
      } catch {
        /* ignore */
      }
    },
    [loadStatus, onProviderReady],
  );

  const downloadModel = useCallback(
    async (model: string) => {
      setPullPct(0);
      setPullMsg(`Starting download of ${model}…`);
      try {
        const r = await fetch("/api/providers/ollama/pull", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
        });
        if (!r.ok || !r.body) {
          const j = await r.json().catch(() => ({}));
          setPullMsg(j.error || "Download failed.");
          setPullPct(null);
          return;
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const ev = JSON.parse(line) as {
                status?: string;
                total?: number;
                completed?: number;
                error?: string;
              };
              if (ev.error) {
                setPullMsg(ev.error);
                setPullPct(null);
                return;
              }
              if (ev.total && ev.completed) {
                setPullPct(Math.round((ev.completed / ev.total) * 100));
              }
              if (ev.status) setPullMsg(ev.status);
            } catch {
              /* partial line */
            }
          }
        }
        setPullPct(100);
        setPullMsg("Installed.");
        await loadStatus();
        // Auto-select the freshly pulled model.
        await persist({ ollamaModel: model });
        setTimeout(() => {
          setPullPct(null);
          setPullMsg(null);
        }, 1500);
      } catch {
        setPullMsg("Download interrupted.");
        setPullPct(null);
      }
    },
    [loadStatus, persist],
  );

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/providers/local-scan", { cache: "no-store" });
      if (r.ok) setScan(await r.json());
    } catch {
      /* ignore — leave previous results */
    } finally {
      setScanning(false);
    }
  }, []);

  if (!settings) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-[var(--ink-500)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading providers…
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12.5px] font-medium text-[var(--ink-900)]">AI provider</p>
        <button
          type="button"
          onClick={loadStatus}
          className="rounded p-1 text-[var(--ink-400)] hover:text-[var(--ink-700)]"
          aria-label="Refresh provider status"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Provider segmented control */}
      <div className="mb-2.5 grid grid-cols-3 gap-1">
        {PROVIDERS.map(({ id, label, Icon }) => {
          const active = settings.provider === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => persist({ provider: id })}
              className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] font-medium transition ${
                active
                  ? "border-[var(--accent-500)] bg-[var(--accent-50)] text-[var(--accent-700)]"
                  : "border-[var(--border-subtle)] bg-white text-[var(--ink-600)] hover:border-[var(--border-strong)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── ChatGPT / Codex ── */}
      {settings.provider === "codex" && (
        <div className="space-y-1.5">
          <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">
            Uses your ChatGPT plan via the bundled Codex engine. Sign in from the
            account button if prompted.
          </p>
          <LabeledSelect
            label="Model"
            value={settings.codexModel}
            options={[...CODEX_MODELS]}
            onChange={(v) => persist({ codexModel: v })}
          />
        </div>
      )}

      {/* ── OpenRouter ── */}
      {settings.provider === "openrouter" && (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-[var(--ink-500)]">
            Bring your own key. Get one at openrouter.ai/keys.{" "}
            {status?.openrouter.valid ? (
              <span className="text-emerald-600">
                Key valid
                {status.openrouter.remaining != null
                  ? ` · $${status.openrouter.remaining.toFixed(2)} left`
                  : ""}
                .
              </span>
            ) : status?.openrouter.hasKey ? (
              <span className="text-rose-600">Key invalid.</span>
            ) : null}
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={keyDraft}
              placeholder="sk-or-v1-…"
              onChange={(e) => setKeyDraft(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => persist({ openrouterApiKey: keyDraft.trim() })}
              className="shrink-0 rounded-md bg-[var(--accent-600)] px-2.5 text-[12px] font-medium text-white hover:bg-[var(--accent-700)]"
            >
              Save
            </button>
          </div>
          <LabeledCombo
            label="Model"
            value={settings.openrouterModel}
            options={[...OPENROUTER_MODELS]}
            placeholder="any model id…"
            onCommit={(v) => persist({ openrouterModel: v })}
          />
          <p className="text-[10.5px] leading-snug text-[var(--ink-400)]">
            Type any model id from openrouter.ai/models — e.g.{" "}
            <code className="text-[var(--ink-600)]">moonshotai/kimi-k2</code>,{" "}
            <code className="text-[var(--ink-600)]">x-ai/grok-2-1212</code>. Suggestions are
            just shortcuts.
          </p>
        </div>
      )}

      {/* ── Ollama ── */}
      {settings.provider === "ollama" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className={`inline-flex h-1.5 w-1.5 rounded-full ${
                status?.ollama.running ? "bg-emerald-500" : "bg-rose-500"
              }`}
            />
            <span className="text-[var(--ink-500)]">
              {status?.ollama.running
                ? `Local server running · ${status.ollama.models.length} model${
                    status.ollama.models.length === 1 ? "" : "s"
                  }`
                : "No local server detected at this URL"}
            </span>
          </div>

          <p className="text-[10.5px] leading-snug text-[var(--ink-400)]">
            Works with any local OpenAI-compatible server — Ollama
            (localhost:11434), LM Studio (localhost:1234), or llama.cpp. Point
            the URL below at yours.
          </p>

          {/* Local server URL */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={urlDraft}
              placeholder="http://localhost:11434"
              onChange={(e) => setUrlDraft(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => persist({ ollamaBaseUrl: urlDraft.trim() })}
              className="shrink-0 rounded-md bg-[var(--accent-600)] px-2.5 text-[12px] font-medium text-white hover:bg-[var(--accent-700)]"
            >
              Save
            </button>
          </div>

          {/* Model — free text so LM Studio / llama.cpp model ids work too */}
          <LabeledCombo
            label="Model"
            value={settings.ollamaModel || ""}
            options={status?.ollama.models ?? []}
            placeholder="model name…"
            onCommit={(v) => persist({ ollamaModel: v })}
          />

          {/* Recommendation + one-click download */}
          {status && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 p-2">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--ink-600)]">
                <Cpu className="h-3 w-3" />
                {status.device.ramGB} GB RAM · recommended:{" "}
                <span className="font-medium text-[var(--ink-900)]">
                  {status.recommended.model}
                </span>{" "}
                (~{status.recommended.approxSizeGB} GB)
              </div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--ink-400)]">
                {status.recommended.note}
              </p>
              {pullPct != null ? (
                <div className="mt-1.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                    <div
                      className="h-full bg-[var(--accent-600)] transition-all"
                      style={{ width: `${pullPct}%` }}
                    />
                  </div>
                  <p className="mt-1 truncate text-[10.5px] text-[var(--ink-500)]">
                    {pullMsg} {pullPct}%
                  </p>
                </div>
              ) : status.ollama.recommendedInstalled ? (
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-600">
                  <Check className="h-3 w-3" /> Installed
                </p>
              ) : (
                <button
                  type="button"
                  disabled={!status.ollama.running}
                  onClick={() => downloadModel(status.recommended.model)}
                  className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-600)] px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-[var(--accent-700)] disabled:opacity-50"
                >
                  <Download className="h-3 w-3" />
                  Download {status.recommended.model}
                </button>
              )}
            </div>
          )}

          {/* Deep local-model finder — locates models already on this machine
              (Ollama, LM Studio, llama.cpp, Hugging Face / Gemma weights),
              even when no server is running. */}
          <div className="rounded-md border border-[var(--border-subtle)] p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11.5px] font-medium text-[var(--ink-700)]">
                Already have models on this computer?
              </p>
              <button
                type="button"
                onClick={runScan}
                disabled={scanning}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-2 py-1 text-[11px] font-medium text-[var(--ink-700)] hover:border-[var(--border-strong)] disabled:opacity-50"
              >
                {scanning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FolderSearch className="h-3 w-3" />
                )}
                {scanning ? "Scanning…" : "Scan this computer"}
              </button>
            </div>
            <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--ink-400)]">
              Finds Gemma, Llama, Qwen and other models in Ollama, LM Studio,
              llama.cpp and the Hugging Face cache — and shows where they live.
            </p>

            {scan && (
              <div className="mt-2 space-y-1.5">
                {scan.models.length === 0 ? (
                  <p className="text-[11px] text-[var(--ink-500)]">
                    No local models found in the usual places. If yours lives
                    somewhere unusual, add that folder to{" "}
                    <code className="text-[var(--ink-600)]">localModelDirs</code>{" "}
                    and scan again.
                  </p>
                ) : (
                  scan.models.map((m) => (
                    <LocalModelRow
                      key={m.path}
                      model={m}
                      selected={settings.ollamaModel === m.id}
                      onUse={() => persist({ ollamaModel: m.id })}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<LocalModel["kind"], string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  gguf: "GGUF file",
  huggingface: "Hugging Face",
};

/** One discovered local model. Ollama models get a one-click "Use"; everything
 *  else shows where it is and how to serve it. */
function LocalModelRow({
  model,
  selected,
  onUse,
}: {
  model: LocalModel;
  selected: boolean;
  onUse: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11.5px] font-medium text-[var(--ink-900)]">
            {model.id}
          </p>
          <p className="text-[10px] text-[var(--ink-400)]">
            {KIND_LABEL[model.kind]}
            {model.sizeGB ? ` · ~${model.sizeGB} GB` : ""}
          </p>
        </div>
        {model.usable ? (
          selected ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-600">
              <Check className="h-3 w-3" /> In use
            </span>
          ) : (
            <button
              type="button"
              onClick={onUse}
              className="shrink-0 rounded-md bg-[var(--accent-600)] px-2 py-1 text-[11px] font-medium text-white hover:bg-[var(--accent-700)]"
            >
              Use
            </button>
          )
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-[10px] text-[var(--ink-400)]" title={model.path}>
        {model.path}
      </p>
      {!model.usable && model.hint && (
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--ink-500)]">
          {model.hint}
        </p>
      )}
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11.5px] text-[var(--ink-600)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 max-w-[60%] rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] font-medium text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Free-text field with a datalist of suggestions — lets the user type ANY
 *  model id while still offering the curated shortcuts. Commits on blur/Enter. */
function LabeledCombo({
  label,
  value,
  options,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  options: string[];
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const listId = useId();
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
  };
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[11.5px] text-[var(--ink-600)]">{label}</span>
      <input
        list={listId}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] font-medium text-[var(--ink-900)] focus:border-[var(--accent-500)] focus:outline-none"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </label>
  );
}
