/**
 * Deep local-model finder.
 *
 * Scans the user's machine for locally-installed LLMs so the app can point
 * the user at models they already have — even when no server is running.
 * This is the answer to "I have Gemma installed but don't know where": we
 * walk the well-known stores (Ollama, LM Studio, llama.cpp, the Hugging Face
 * cache) and report each model with its on-disk path, approximate size, and a
 * one-line hint on how to actually use it.
 *
 * Pure Node (fs/os/path) so it runs from any API route in the Electron child
 * server. Bounded by design: we only descend a curated set of candidate
 * roots, cap depth + total entries visited, and never throw — a finder that
 * hangs or crashes is worse than one that misses an exotic location.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type LocalModelKind = "ollama" | "lmstudio" | "gguf" | "huggingface";

export type LocalModel = {
  kind: LocalModelKind;
  /** Identifier. For Ollama this is the tag usable directly (e.g. "gemma3:4b");
   *  for files it's the filename or HF repo (e.g. "google/gemma-2-9b"). */
  id: string;
  /** Absolute path to the model file, manifest, or snapshot dir. */
  path: string;
  /** Approximate size on disk in GB, when knowable. */
  sizeGB: number | null;
  /** Can this be selected as the active model right now without extra steps?
   *  True only for Ollama models (the app speaks Ollama natively). */
  usable: boolean;
  /** How to actually run it, shown when usable === false. */
  hint?: string;
};

export type LocalScanResult = {
  models: LocalModel[];
  /** Roots we actually looked inside (existed on disk). */
  scannedDirs: string[];
  /** The resolved Ollama models root, if present. */
  ollamaRoot: string | null;
  /** Did we find an Ollama store at all? */
  ollamaInstalled: boolean;
};

export type ScanOptions = {
  /** Override the home directory — used by tests. Defaults to os.homedir(). */
  homeDir?: string;
  /** Extra directories to scan for .gguf files (from settings). */
  extraDirs?: string[];
  /** Hard cap on directory entries visited across the whole scan. */
  maxEntries?: number;
  /** Wall-clock budget in ms. */
  budgetMs?: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const bytesToGB = (b: number) => round1(b / 1024 ** 3);

/** A small mutable budget shared across the walk so one giant tree can't
 *  starve the rest of the scan or hang the request. */
type Budget = { entries: number; deadline: number };
function spent(b: Budget): boolean {
  return b.entries <= 0 || Date.now() > b.deadline;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect files matching `match` under `root`, depth-bounded. Returns absolute
 * paths. Skips obviously-irrelevant heavy directories so a stray scan of
 * ~/Downloads doesn't wander into node_modules or a git checkout.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".Trash",
  "Caches",
  "tmp",
  "temp",
]);

async function collectFiles(
  root: string,
  match: (name: string) => boolean,
  maxDepth: number,
  budget: Budget,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || spent(budget)) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (spent(budget)) return;
      budget.entries -= 1;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") && depth > 0) continue;
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full, depth + 1);
      } else if (e.isFile() && match(e.name)) {
        out.push(full);
      }
    }
  }
  await walk(root, 0);
  return out;
}

async function sizeOf(p: string): Promise<number | null> {
  try {
    const st = await fs.stat(p);
    return st.size;
  } catch {
    return null;
  }
}

// ── Ollama ────────────────────────────────────────────────────────────────

/** Ollama keeps its blobs+manifests under OLLAMA_MODELS, else ~/.ollama/models
 *  on every platform (incl. Windows: %USERPROFILE%\.ollama\models). */
function ollamaModelsRoot(home: string): string {
  const env = process.env.OLLAMA_MODELS?.trim();
  if (env) return path.resolve(env);
  return path.join(home, ".ollama", "models");
}

/** Turn a manifests-relative path into the id `ollama run` expects.
 *  e.g. registry.ollama.ai/library/gemma3/4b → "gemma3:4b"
 *       registry.ollama.ai/library/llama3.2/latest → "llama3.2:latest" */
function ollamaIdFromManifestParts(parts: string[]): string {
  // parts = [registry, namespace, ...repo, tag]
  const registry = parts[0];
  const namespace = parts[1];
  const tag = parts[parts.length - 1];
  const repo = parts.slice(2, -1).join("/");
  const regPart = registry === "registry.ollama.ai" ? "" : `${registry}/`;
  const nsPart = namespace === "library" ? "" : `${namespace}/`;
  return `${regPart}${nsPart}${repo}:${tag}`;
}

async function scanOllama(
  root: string,
  budget: Budget,
): Promise<LocalModel[]> {
  const manifests = path.join(root, "manifests");
  if (!(await exists(manifests))) return [];
  // Manifest leaves live at manifests/<registry>/<namespace>/<repo>/<tag>.
  // We collect every plain file under there and reconstruct the id.
  const files = await collectFiles(manifests, () => true, 6, budget);
  const models: LocalModel[] = [];
  for (const file of files) {
    const rel = path.relative(manifests, file);
    const parts = rel.split(path.sep);
    if (parts.length < 4) continue; // not a tag leaf
    const id = ollamaIdFromManifestParts(parts);
    // Sum the layer sizes from the manifest JSON for an accurate footprint.
    let bytes = 0;
    try {
      const raw = await fs.readFile(file, "utf-8");
      const m = JSON.parse(raw) as {
        layers?: Array<{ size?: number }>;
        config?: { size?: number };
      };
      for (const l of m.layers ?? []) bytes += l.size ?? 0;
      bytes += m.config?.size ?? 0;
    } catch {
      /* not a manifest we understand — still report it, size unknown */
    }
    models.push({
      kind: "ollama",
      id,
      path: file,
      sizeGB: bytes > 0 ? bytesToGB(bytes) : null,
      usable: true,
      hint: undefined,
    });
  }
  return models;
}

// ── GGUF stores (LM Studio, llama.cpp, loose downloads) ─────────────────────

function isGguf(name: string): boolean {
  return name.toLowerCase().endsWith(".gguf");
}

/** Friendly id for a gguf path: the filename without the .gguf extension. */
function ggufId(file: string): string {
  return path.basename(file).replace(/\.gguf$/i, "");
}

const LMSTUDIO_HINT =
  'Open LM Studio, load this model, and start its local server (Developer → Start Server). Then set the local-server URL above to http://localhost:1234.';
const GGUF_HINT =
  'Serve it with a local OpenAI-compatible server (LM Studio, llama.cpp\'s `llama-server`, or `ollama create`), then point the URL above at it.';

// ── Hugging Face cache ──────────────────────────────────────────────────────

/** HF cache dirs are named models--<org>--<name>; turn that into "org/name". */
function hfRepoFromDir(dirName: string): string | null {
  if (!dirName.startsWith("models--")) return null;
  return dirName.slice("models--".length).split("--").join("/");
}

async function scanHuggingFace(
  hubRoot: string,
  budget: Budget,
): Promise<LocalModel[]> {
  if (!(await exists(hubRoot))) return [];
  const out: LocalModel[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(hubRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (spent(budget)) break;
    if (!e.isDirectory()) continue;
    const repo = hfRepoFromDir(e.name);
    if (!repo) continue;
    budget.entries -= 1;
    // Look for any weight files in the snapshot to confirm it's a real model.
    const dir = path.join(hubRoot, e.name);
    const weights = await collectFiles(
      dir,
      (n) => isGguf(n) || n.toLowerCase().endsWith(".safetensors"),
      4,
      budget,
    );
    if (weights.length === 0) continue;
    let bytes = 0;
    for (const w of weights) bytes += (await sizeOf(w)) ?? 0;
    const gguf = weights.find((w) => isGguf(w));
    out.push({
      kind: "huggingface",
      id: repo,
      path: dir,
      sizeGB: bytes > 0 ? bytesToGB(bytes) : null,
      usable: false,
      hint: gguf ? GGUF_HINT : `Convert/serve these weights locally to use them. ${GGUF_HINT}`,
    });
  }
  return out;
}

// ── Top-level scan ──────────────────────────────────────────────────────────

export async function scanLocalModels(
  opts: ScanOptions = {},
): Promise<LocalScanResult> {
  const home = opts.homeDir ?? os.homedir();
  const budget: Budget = {
    entries: opts.maxEntries ?? 40000,
    deadline: Date.now() + (opts.budgetMs ?? 9000),
  };

  const scannedDirs: string[] = [];
  const models: LocalModel[] = [];

  // 1) Ollama (works offline — reads the manifest store directly).
  const oRoot = ollamaModelsRoot(home);
  const ollamaInstalled = await exists(oRoot);
  if (ollamaInstalled) {
    scannedDirs.push(oRoot);
    models.push(...(await scanOllama(oRoot, budget)));
  }

  // 2) LM Studio model stores → .gguf files.
  const lmStudioRoots = [
    path.join(home, ".lmstudio", "models"),
    path.join(home, ".cache", "lm-studio", "models"),
  ];
  for (const root of lmStudioRoots) {
    if (spent(budget)) break;
    if (!(await exists(root))) continue;
    scannedDirs.push(root);
    const files = await collectFiles(root, isGguf, 5, budget);
    for (const file of files) {
      models.push({
        kind: "lmstudio",
        id: ggufId(file),
        path: file,
        sizeGB: await sizeOf(file).then((b) => (b ? bytesToGB(b) : null)),
        usable: false,
        hint: LMSTUDIO_HINT,
      });
    }
  }

  // 3) Loose .gguf in common llama.cpp / download locations + user dirs.
  const ggufRoots = [
    path.join(home, "models"),
    path.join(home, "llama.cpp", "models"),
    path.join(home, "Downloads"),
    ...(opts.extraDirs ?? []).map((d) => path.resolve(d)),
  ];
  for (const root of ggufRoots) {
    if (spent(budget)) break;
    if (!(await exists(root))) continue;
    scannedDirs.push(root);
    // ~/Downloads is shallow on purpose (people drop a gguf at the top level);
    // explicit model dirs and user-added dirs get a deeper walk.
    const depth = root.endsWith("Downloads") ? 2 : 4;
    const files = await collectFiles(root, isGguf, depth, budget);
    for (const file of files) {
      models.push({
        kind: "gguf",
        id: ggufId(file),
        path: file,
        sizeGB: await sizeOf(file).then((b) => (b ? bytesToGB(b) : null)),
        usable: false,
        hint: GGUF_HINT,
      });
    }
  }

  // 4) Hugging Face cache (where `huggingface-cli download google/gemma-*`
  //    and many tools land their weights).
  const hfRoots = [
    process.env.HF_HOME ? path.join(path.resolve(process.env.HF_HOME), "hub") : null,
    path.join(home, ".cache", "huggingface", "hub"),
    path.join(home, "Library", "Caches", "huggingface", "hub"),
  ].filter((d): d is string => typeof d === "string");
  for (const root of hfRoots) {
    if (spent(budget)) break;
    if (!(await exists(root))) continue;
    scannedDirs.push(root);
    models.push(...(await scanHuggingFace(root, budget)));
  }

  // De-dupe by path (a dir can appear in two candidate lists) and sort:
  // directly-usable first, then biggest, then by id.
  const seen = new Set<string>();
  const deduped = models.filter((m) => {
    if (seen.has(m.path)) return false;
    seen.add(m.path);
    return true;
  });
  deduped.sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if ((b.sizeGB ?? 0) !== (a.sizeGB ?? 0)) return (b.sizeGB ?? 0) - (a.sizeGB ?? 0);
    return a.id.localeCompare(b.id);
  });

  return {
    models: deduped,
    scannedDirs: [...new Set(scannedDirs)],
    ollamaRoot: ollamaInstalled ? oRoot : null,
    ollamaInstalled,
  };
}
