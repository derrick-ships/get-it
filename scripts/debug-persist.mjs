import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (m) => { if (m.type() !== "log") console.log("[" + m.type() + "]", m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('button:has-text("Classical Mechanics")').first().click();
await page.waitForURL(/\/viewer\//);
await page.waitForFunction(() => document.querySelectorAll("[data-page] button").length >= 2, null, { timeout: 90_000 });

console.log("→ click first idle, wait for ready");
const idle = page.locator("[data-page] button:not([disabled])").first();
const tagText = (await idle.textContent())?.trim();
await idle.click();
await page.waitForFunction(
  (label) => {
    const btns = Array.from(document.querySelectorAll("[data-page] button"));
    return btns.some((b) => b.textContent?.includes(label) && !b.innerHTML.includes("animate-spin") && !b.className.includes("opacity-75"));
  },
  tagText,
  { timeout: 4 * 60_000 },
);
console.log("ready");
// Give the debounced save 500ms to fire.
await page.waitForTimeout(800);

const stored = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
  return keys.map((k) => {
    const raw = sessionStorage.getItem(k);
    let parsed = null; try { parsed = JSON.parse(raw); } catch {}
    return { k, len: raw?.length || 0, parsed };
  });
});
console.log("storage entries:", stored.length);
for (const s of stored) {
  console.log(`  ${s.k} (${s.len} chars)`);
  if (s.parsed) {
    console.log(`    activeTagId: ${s.parsed.activeTagId}`);
    console.log(`    pagesAnalyzed: ${JSON.stringify(s.parsed.pagesAnalyzed)}`);
    console.log(`    tags (${s.parsed.tags?.length}):`);
    for (const t of (s.parsed.tags || [])) {
      console.log(`      [${t.id}] type=${t.type} ready=${t.ready} generating=${t.generating} hasSpec=${!!t.spec} hasError=${!!t.error}  label="${t.label}"`);
    }
  }
}

console.log("\n→ reload");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const afterReloadCounts = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("[data-page] button"));
  return btns.map((b) => {
    const txt = b.textContent?.trim() ?? "";
    const spinning = b.innerHTML.includes("animate-spin");
    const idle = b.className.includes("opacity-75");
    const disabled = b.hasAttribute("disabled");
    return { txt, spinning, idle, disabled };
  });
});
console.log("after-reload tag DOM state:");
afterReloadCounts.forEach((b) => console.log(`  ${b.disabled ? "disabled" : "enabled "} ${b.spinning ? "SPIN" : "    "} ${b.idle ? "IDLE" : "    "}  "${b.txt}"`));

const storedAfter = await page.evaluate(() => {
  const k = sessionStorage.key(0);
  const raw = sessionStorage.getItem(k);
  return raw?.length || 0;
});
console.log("storage size after reload:", storedAfter);

await browser.close();
