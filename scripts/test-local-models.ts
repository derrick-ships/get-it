/**
 * Verifies the deep local-model finder against a synthetic home directory:
 * a fake Ollama manifest store, an LM Studio .gguf, a Hugging Face Gemma
 * snapshot, and a loose .gguf in a user-added dir. Asserts each is found
 * with the right kind, id, and usability.
 *
 *   npx tsx scripts/test-local-models.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanLocalModels } from "../lib/local-models";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

function write(p: string, contents: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
}

async function main() {
// ── Build a fake machine ────────────────────────────────────────────────
const home = fs.mkdtempSync(path.join(os.tmpdir(), "getit-home-"));
const extra = fs.mkdtempSync(path.join(os.tmpdir(), "getit-models-"));

// 1) Ollama: gemma3:4b in the library namespace, with a sized model layer.
write(
  path.join(
    home,
    ".ollama/models/manifests/registry.ollama.ai/library/gemma3/4b",
  ),
  JSON.stringify({
    schemaVersion: 2,
    config: { size: 1000 },
    layers: [
      { mediaType: "application/vnd.ollama.image.model", size: 3_000_000_000 },
      { mediaType: "application/vnd.ollama.image.params", size: 500 },
    ],
  }),
);
// A second Ollama model under a non-library namespace to test id building.
write(
  path.join(
    home,
    ".ollama/models/manifests/registry.ollama.ai/hf.co/qwen/qwen2.5/7b",
  ),
  JSON.stringify({ schemaVersion: 2, layers: [{ size: 4_700_000_000 }] }),
);

// 2) LM Studio: a gguf under ~/.lmstudio/models/<publisher>/<repo>/
write(
  path.join(
    home,
    ".lmstudio/models/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/model.gguf",
  ),
  "x".repeat(2048),
);

// 3) Hugging Face cache: a Gemma snapshot with a safetensors weight.
write(
  path.join(
    home,
    ".cache/huggingface/hub/models--google--gemma-2-9b-it/snapshots/abc123/model-00001.safetensors",
  ),
  "y".repeat(4096),
);

// 4) Loose gguf in a user-added directory.
write(path.join(extra, "my-finetune.gguf"), "z".repeat(1024));

// ── Run the scan ────────────────────────────────────────────────────────
const res = await scanLocalModels({ homeDir: home, extraDirs: [extra] });
console.log(`\nScanned ${res.scannedDirs.length} dirs, found ${res.models.length} models:`);
for (const m of res.models) {
  console.log(
    `  · [${m.kind}] ${m.id}  ${m.sizeGB != null ? m.sizeGB + "GB" : "?"}  usable=${m.usable}`,
  );
}
console.log();

const byKind = (k: string) => res.models.filter((m) => m.kind === k);

check("ollama store detected", res.ollamaInstalled === true);
check("found gemma3:4b (library → bare id)", byKind("ollama").some((m) => m.id === "gemma3:4b"));
// 3e9 bytes + tiny layers ≈ 2.8 GiB (binary GB).
check("gemma3:4b size summed from layers (~2.8GB)", byKind("ollama").some((m) => m.id === "gemma3:4b" && m.sizeGB === 2.8));
check(
  "found hf.co-namespaced ollama model",
  byKind("ollama").some((m) => m.id === "hf.co/qwen/qwen2.5:7b"),
);
check("ollama models are usable", byKind("ollama").every((m) => m.usable === true));
check("found LM Studio gguf", byKind("lmstudio").some((m) => m.id === "model"));
check("LM Studio model is NOT directly usable", byKind("lmstudio").every((m) => m.usable === false));
check("LM Studio hint mentions the server", byKind("lmstudio").every((m) => /server/i.test(m.hint || "")));
check(
  "found HF Gemma snapshot as google/gemma-2-9b-it",
  byKind("huggingface").some((m) => m.id === "google/gemma-2-9b-it"),
);
check("found loose gguf in extra dir", byKind("gguf").some((m) => m.id === "my-finetune"));
check("usable models sort first", res.models.length === 0 || res.models[0].usable === true);

// ── Empty-machine case: nothing should be found, no throw ─────────────────
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "getit-empty-"));
const empty = await scanLocalModels({ homeDir: emptyHome });
check("empty machine → no models, no crash", empty.models.length === 0 && empty.ollamaInstalled === false);

// ── Cleanup ───────────────────────────────────────────────────────────────
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(extra, { recursive: true, force: true });
fs.rmSync(emptyHome, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll local-model finder checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
