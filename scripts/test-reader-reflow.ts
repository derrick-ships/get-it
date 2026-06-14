/**
 * Verifies the Reader's PDF reflow: line→paragraph grouping, heading detection
 * by font size, and figure-band detection from no-text vertical gaps.
 *
 *   npx tsx scripts/test-reader-reflow.ts
 */

import { reflowPage, type ReflowItem } from "../lib/reader-reflow";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

// Build a line of runs at baseline y with a given glyph height.
function line(y: number, height: number, words: string[]): ReflowItem[] {
  let x = 72;
  return words.map((w) => {
    const width = w.length * (height * 0.5);
    const it: ReflowItem = { str: w, x, y, width, height, eol: false };
    x += width + height * 0.5;
    return it;
  });
}

const H = 792; // US-letter height in PDF units

// A page with: a big title, a paragraph (two lines), a tall figure gap, then a
// closing paragraph near the bottom.
const items: ReflowItem[] = [
  ...line(740, 22, ["Photosynthesis"]), // heading (big)
  ...line(710, 11, ["Plants", "turn", "sunlight", "into", "sugar."]), // body
  ...line(696, 11, ["It", "happens", "in", "the", "chloroplast."]), // body (same para)
  // ~big empty band between y≈696 and y≈300 → figure
  ...line(290, 11, ["The", "diagram", "above", "shows", "the", "cycle."]), // body
];

const { blocks, bands } = reflowPage({
  pageIndex: 0,
  width: 612,
  height: H,
  text: "Photosynthesis Plants turn sunlight into sugar. It happens in the chloroplast. The diagram above shows the cycle.",
  items,
});

console.log("\nBlocks:");
for (const b of blocks) console.log(`  [${b.kind}${b.level ? " h" + b.level : ""}] ${b.text}`);
console.log("Bands:", JSON.stringify(bands));
console.log();

const headings = blocks.filter((b) => b.kind === "heading");
const paras = blocks.filter((b) => b.kind === "para");

check("title detected as a heading", headings.some((b) => b.text === "Photosynthesis"));
check("body lines merged into paragraphs (not headings)", paras.length >= 2);
check(
  "two adjacent body lines became ONE paragraph",
  paras.some((b) => /Plants turn sunlight into sugar\. It happens in the chloroplast\./.test(b.text)),
);
check("a figure band was detected in the big gap", bands.length >= 1);
check(
  "figure band sits between the body and the closing line",
  bands.some((b) => b.y0 < 696 && b.y1 > 290),
);

// Full-height text page (text top-to-bottom, no large gaps) → no figure bands.
// (Blank edge margins on half-empty pages are over-proposed by the detector on
// purpose and dropped at render time by the blank-crop check in ReaderView.)
const dense: ReflowItem[] = [];
for (let i = 0; i < 50; i++) dense.push(...line(745 - i * 14, 11, ["line", String(i), "of", "text"]));
const denseRes = reflowPage({ pageIndex: 1, width: 612, height: H, text: "…", items: dense });
check("full-height dense text page yields no figure bands", denseRes.bands.length === 0);

// Empty page → no crash, nothing.
const empty = reflowPage({ pageIndex: 2, width: 612, height: H, text: "", items: [] });
check("empty page → no blocks, no bands, no crash", empty.blocks.length === 0 && empty.bands.length === 0);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll reader-reflow checks passed.");
