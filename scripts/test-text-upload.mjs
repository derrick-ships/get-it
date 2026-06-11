/**
 * Automated upload acceptance tests for .txt and .md file support.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/test-text-upload.mjs
 *
 * Requires the Next.js dev or standalone server to be running at BASE_URL.
 * Mirrors smoke-test.mjs's approach: native fetch + FormData, no test runner.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = path.join(fileURLToPath(import.meta.url), "..", "..");
const FIXTURES = path.join(ROOT, "scripts", "fixtures");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function uploadFile(filename, mimeType, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const r = await fetch(`${BASE_URL}/api/upload`, { method: "POST", body: form });
  const json = await r.json();
  return { status: r.status, json };
}

// ── Positive: .txt fixture ───────────────────────────────────────────────
console.log("\n[1] .txt upload");
{
  const bytes = readFileSync(path.join(FIXTURES, "sample.txt"));
  const { status, json } = await uploadFile("sample.txt", "text/plain", bytes);
  assert(status === 200, `status 200 (got ${status})`);
  assert(typeof json.docId === "string", `docId present (${json.docId})`);
  assert((json.numPages ?? 0) >= 1, `numPages >= 1 (got ${json.numPages})`);
  const allText = (json.pages ?? []).map((p) => p.text).join(" ");
  assert(allText.includes("Newton"), "body text contains 'Newton'");
  assert(allText.includes("momentum"), "body text contains 'momentum'");

  if (json.docId) {
    const pdfR = await fetch(`${BASE_URL}/api/pdf/${json.docId}`);
    assert(pdfR.status === 200, `GET /api/pdf/${json.docId} returns 200`);
    const ct = pdfR.headers.get("content-type") ?? "";
    assert(ct.startsWith("application/pdf"), `Content-Type is application/pdf (got ${ct})`);
    const buf = Buffer.from(await pdfR.arrayBuffer());
    assert(buf.subarray(0, 5).toString("ascii") === "%PDF-", "PDF bytes start with %PDF-");
  }
}

// ── Positive: .md fixture ────────────────────────────────────────────────
console.log("\n[2] .md upload");
{
  const bytes = readFileSync(path.join(FIXTURES, "sample.md"));
  const { status, json } = await uploadFile("sample.md", "text/markdown", bytes);
  assert(status === 200, `status 200 (got ${status})`);
  assert((json.numPages ?? 0) >= 1, `numPages >= 1 (got ${json.numPages})`);
  const allText = (json.pages ?? []).map((p) => p.text).join(" ");
  assert(allText.includes("Markdown"), "extracted text contains 'Markdown'");
  assert(allText.includes("pdfkit"), "extracted text contains 'pdfkit'");
}

// ── Positive: .txt with .markdown extension ──────────────────────────────
console.log("\n[3] .markdown extension");
{
  const content = "# Test\n\nThis file has a .markdown extension.\n\nIt should be accepted just like .md files.\n\nMore prose here to satisfy the minimum text threshold for Get It upload validation.\n\nThe system checks for at least six hundred alphanumeric characters so we need a fair amount of content in this fixture to pass the quality gates that run after PDF conversion.\n\n";
  const bytes = Buffer.from(content);
  const { status } = await uploadFile("notes.markdown", "text/markdown", bytes);
  assert(status === 200, `status 200 (got ${status})`);
}

// ── Negative: near-empty .txt → no_text ─────────────────────────────────
console.log("\n[4] empty .txt rejected with no_text");
{
  const bytes = Buffer.from("hi\n");
  const { status, json } = await uploadFile("tiny.txt", "text/plain", bytes);
  assert(status === 422, `status 422 (got ${status})`);
  assert(json.code === "no_text", `code is no_text (got ${json.code})`);
  assert(
    !(json.error ?? "").toLowerCase().includes("pdf"),
    `error message doesn't say 'PDF' (got: "${json.error}")`,
  );
}

// ── Negative: NUL bytes rejected ────────────────────────────────────────
console.log("\n[5] binary file with .txt extension rejected");
{
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // PK\x03\x04 (zip)
  const { status } = await uploadFile("archive.txt", "text/plain", bytes);
  assert(status >= 400 && status < 500, `4xx status (got ${status})`);
}

// ── Negative: .docx rejected ────────────────────────────────────────────
console.log("\n[6] .docx unsupported type");
{
  const bytes = Buffer.from("fake docx content");
  const { status, json } = await uploadFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes);
  assert(status === 400, `status 400 (got ${status})`);
  assert(
    (json.error ?? "").toLowerCase().includes("unsupported"),
    `error mentions 'unsupported' (got: "${json.error}")`,
  );
}

// ── Negative: real PDF still works (regression) ──────────────────────────
console.log("\n[7] regression: sample PDF still accepted");
{
  const form = new FormData();
  form.append("sample", "physics");
  const r = await fetch(`${BASE_URL}/api/upload`, { method: "POST", body: form });
  assert(r.status === 200, `sample physics status 200 (got ${r.status})`);
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
