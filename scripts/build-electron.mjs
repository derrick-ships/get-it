#!/usr/bin/env node
/**
 * scripts/build-electron.mjs
 *
 * One entry point for local desktop builds.
 *
 *   node scripts/build-electron.mjs --target=mac-arm64
 *   node scripts/build-electron.mjs --target=mac-x64
 *   node scripts/build-electron.mjs --target=win-x64
 *   node scripts/build-electron.mjs --all      # sequential: mac-arm64, mac-x64, win-x64
 *
 * Internally each target invokes electron-builder with the right flags
 * AFTER running `npm run electron:prepare -- --target=<target-triple>` so
 * the matching Codex CLI binary is in place. Builds run sequentially —
 * artefacts land in dist-electron/.
 *
 * CI runners use this same script via the GitHub Actions matrix in
 * .github/workflows/release.yml.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

const args = process.argv.slice(2);
const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? null;
const all = args.includes("--all");

const TARGETS = {
  "mac-arm64": {
    builderFlag: ["--mac", "--arm64"],
    prepareTriple: "darwin-arm64",
  },
  "mac-x64": {
    builderFlag: ["--mac", "--x64"],
    prepareTriple: "darwin-x64",
  },
  "win-x64": {
    builderFlag: ["--win", "--x64"],
    prepareTriple: "win32-x64",
  },
  "linux-x64": {
    builderFlag: ["--linux", "--x64"],
    prepareTriple: "linux-x64",
  },
};

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${cmdArgs.join(" ")} exited with code ${code}`));
    });
  });
}

async function buildOne(targetKey) {
  const t = TARGETS[targetKey];
  if (!t) throw new Error(`Unknown target ${targetKey}. Known: ${Object.keys(TARGETS).join(", ")}`);
  console.log(`\n=== Building ${targetKey} ===`);
  await run("node", [
    path.join("scripts", "electron-prepare.mjs"),
    `--target=${t.prepareTriple}`,
  ]);
  await run("npx", ["--no-install", "electron-builder", ...t.builderFlag, "--publish", "never"]);
  console.log(`=== ${targetKey} done ===`);
}

async function main() {
  if (all) {
    for (const k of ["mac-arm64", "mac-x64", "win-x64"]) {
      await buildOne(k);
    }
    return;
  }
  if (!targetArg) {
    console.error("Provide --target=<key> or --all. Known targets:", Object.keys(TARGETS).join(", "));
    process.exit(1);
  }
  await buildOne(targetArg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
