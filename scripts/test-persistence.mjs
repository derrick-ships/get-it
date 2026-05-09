/**
 * Verify viewer persistence:
 *   1. tags only         (after detection, before any viz generated)
 *   2. tags + 1 spec     (one viz manually triggered and ready)
 *   3. mid-flight resume (a viz still generating across reload)
 *
 * Uses BASE_URL (default http://localhost:3000) which must be running with
 * NEXT_PUBLIC_AUTO_GENERATE_VIZ=false (manual mode) — that gives us full
 * control over which viz fire.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text()); });

function snap(name) {
  return page.screenshot({ path: `scripts/smoke-out/persist-${name}.png`, fullPage: false });
}

async function tagCounts() {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("[data-page] button"));
    let ready = 0, generating = 0, idle = 0;
    for (const b of btns) {
      const html = b.innerHTML;
      const disabled = b.hasAttribute("disabled");
      if (html.includes("animate-spin")) generating++;
      else if (!disabled && b.className.includes("opacity-75")) idle++;
      else ready++;
    }
    return { total: btns.length, ready, generating, idle };
  });
}

console.log("\n=== SCENARIO 1: persist tags-only across reload ===");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('button:has-text("Classical Mechanics")').first().click();
await page.waitForURL(/\/viewer\//);
const docUrl = page.url();
console.log("doc url:", docUrl);

console.log("→ wait for at least 4 tags to appear (detection only)…");
await page.waitForFunction(() => document.querySelectorAll("[data-page] button").length >= 4, null, { timeout: 90_000 });
const beforeReload1 = await tagCounts();
console.log("  before reload:", beforeReload1);
await snap("1a-before-reload");

console.log("→ reload");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const restoredChip = await page.locator("text=restored").first().isVisible().catch(() => false);
console.log("  restored chip visible:", restoredChip);
const afterReload1 = await tagCounts();
console.log("  after  reload:", afterReload1);
await snap("1b-after-reload");
const ok1 = restoredChip && afterReload1.total === beforeReload1.total;
console.log(ok1 ? "  ✓ tags persisted" : "  ✗ tag count changed");

console.log("\n=== SCENARIO 2: persist tags + 1 generated spec ===");
console.log("→ click first idle tag, wait for ready");
const firstIdle = page.locator("[data-page] button:not([disabled])").first();
const tagText = (await firstIdle.textContent())?.trim();
console.log("  clicking:", tagText);
await firstIdle.click();
await page.waitForFunction(
  (label) => Array.from(document.querySelectorAll("[data-page] button")).some(
    (b) => !b.innerHTML.includes("animate-spin") && b.textContent?.includes(label) && !b.className.includes("opacity-75")
  ),
  tagText,
  { timeout: 4 * 60_000 },
);
const beforeReload2 = await tagCounts();
console.log("  before reload:", beforeReload2);
await snap("2a-before-reload");

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const afterReload2 = await tagCounts();
console.log("  after  reload:", afterReload2);
const visualizerHasContent = await page.evaluate(() => {
  const right = Array.from(document.querySelectorAll("div")).find((d) => d.className?.includes?.("44%"));
  if (!right) return null;
  const canvas = right.querySelector("canvas");
  const katex  = right.querySelector(".katex");
  const prose  = right.querySelector(".prose");
  return { canvas: !!canvas, katex: !!katex, prose: !!prose };
});
console.log("  viz panel after reload:", visualizerHasContent);
await snap("2b-after-reload");
const ok2 = afterReload2.ready >= beforeReload2.ready && (visualizerHasContent?.canvas || visualizerHasContent?.katex || visualizerHasContent?.prose);
console.log(ok2 ? "  ✓ spec persisted + viz still rendered" : "  ✗ spec or viz lost");

console.log("\n=== SCENARIO 3: resume mid-flight generation ===");
const idle3 = page.locator("[data-page] button:not([disabled])").filter({ has: page.locator("svg:not(.animate-spin)") }).first();
let foundIdle = false;
try {
  await idle3.waitFor({ timeout: 5000 });
  foundIdle = true;
} catch {}
if (foundIdle) {
  const idleText = (await idle3.textContent())?.trim();
  console.log("  clicking idle tag:", idleText);
  await idle3.click();
  // Wait a moment for the click to register and generation to start, then reload mid-flight.
  await page.waitForTimeout(2500);
  const midState = await tagCounts();
  console.log("  state mid-flight:", midState);
  if (midState.generating === 0) {
    console.log("  (generation already finished — picking another tag)");
  }
  await snap("3a-mid-flight");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const afterReload3 = await tagCounts();
  console.log("  state after reload:", afterReload3);
  await snap("3b-after-reload");
  // Wait for the resumed generation to complete.
  console.log("  waiting up to 3 min for resumed generation to finish…");
  try {
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll("[data-page] button"));
        return btns.every((b) => !b.innerHTML.includes("animate-spin"));
      },
      null,
      { timeout: 3 * 60_000 },
    );
    const finalState = await tagCounts();
    console.log("  state after resume:", finalState);
    await snap("3c-after-resume");
    console.log(finalState.generating === 0 ? "  ✓ resumed generation finished" : "  ✗ still generating");
  } catch (e) {
    console.log("  ✗ timed out waiting for resume:", e.message);
  }
}

console.log("\n=== Errors:", errs.length);
errs.forEach((e) => console.log("  ", e.slice(0, 200)));
await browser.close();
