/**
 * Verifies the Reader's pure helpers (slugify / clamp / line-height rounding /
 * reading-time) and the summary cache store round-trip.
 *
 *   npx tsx scripts/test-reader-prefs.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { slugify, clamp, roundStep, readingTimeMinutes } from "../lib/reader-prefs";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

// slugify
check("slugify strips punctuation", slugify("The Heart & Systemic Circulation!") === "the-heart-systemic-circulation");
check("slugify handles section numbers", slugify("4.1 Introduction") === "4-1-introduction");
check("slugify strips diacritics", slugify("Café Niño") === "cafe-nino");
check("slugify falls back to 'section'", slugify("***") === "section");

// clamp + line-height rounding (float drift guard)
check("clamp upper", clamp(30, 14, 24) === 24);
check("clamp lower", clamp(10, 14, 24) === 14);
check("roundStep kills float drift", roundStep(1.7 + 0.1) === 1.8);
check("roundStep 1.85 → 1.9", roundStep(1.85) === 1.9);

// reading time
check("reading time 400 words ≈ 2 min", readingTimeMinutes("word ".repeat(400)) === 2);
check("reading time min is 1", readingTimeMinutes("just a few words") === 1);
check("reading time empty is 1", readingTimeMinutes("") === 1);

// summary store round-trip (needs DATA_DIR set before the module loads)
async function summaryStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getit-sum-"));
  process.env.GETIT_DATA_DIR = dir;
  const { loadSummary, saveSummary } = await import("../lib/summary-store");
  const docId = "doc-abc";
  check("loadSummary null before save", loadSummary(docId) === null);
  const text = "A short neutral abstract of the document for the reader.";
  const saved = saveSummary(docId, text);
  check("saveSummary returns v1 + text", saved.v === 1 && saved.summary === text && saved.docId === docId);
  const loaded = loadSummary(docId);
  check("loadSummary round-trips", !!loaded && loaded.summary === text);
  check("loadSummary null for other doc", loadSummary("nope") === null);
  fs.rmSync(dir, { recursive: true, force: true });
}

summaryStore()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll reader-prefs + summary-store checks passed.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
