# Braynr Visualizer

> Read with a brain on your shoulder.

Drop in any text-tagged PDF. Braynr's agent reads it page by page, picks the
concepts that benefit from a visual aid, and renders them right next to
the text — 3D anatomy / molecules, animated 2D simulations, formula
walkthroughs with KaTeX, plotted graphs, or live source citations.

The agent is the locally-installed [Codex CLI](https://github.com/openai/codex)
(`codex exec`), invoked through the official `@openai/codex-sdk` with a
strict `outputSchema` per call so every response is typed JSON.

---

## Run it

Pre-requisites:
- Node 20+
- An authenticated `codex` CLI (`codex login`) — the demo uses your local
  ChatGPT or API account.

```bash
npm install
cp .env.example .env    # tweak NEXT_PUBLIC_AUTO_GENERATE_VIZ if needed
npm run generate-pdfs   # one-time: build the 5 sample PDFs into public/pdfs
npm run dev             # http://localhost:3000
```

### Auto vs manual generation

`NEXT_PUBLIC_AUTO_GENERATE_VIZ` controls whether the visualizer eagerly
generates a spec for every detected tag, or waits for a click:

- **unset / `true`** — production behavior: every tag fires its viz
  generation in parallel (capped at 4 concurrent), the user sees the
  right pane fill in by itself.
- **`false`** — dev behavior: tags appear but no codex token is spent
  until the user clicks a tag. A small "manual mode" chip shows up in
  the viewer header. Use this when iterating on the UI.

### Tab-scoped persistence

Viewer state is mirrored to `sessionStorage` so it survives F5 / Next.js
Fast-Refresh / browser back-forward, and dies cleanly when the tab
closes. Specifically:

- detected tags + their positions
- generated viz specs (instantly re-rendered after reload)
- which pages have already been analyzed (no re-detection)
- the active tag selection (right pane stays on the same viz)

Tags whose generation was *in flight* when the page reloaded are
re-enqueued on mount, so the work just keeps going. A "restored" chip
in the header confirms a cache hit; a "reset" button next to the
progress chips wipes the cache and re-detects from scratch.

Implementation: [`lib/persistence.ts`](lib/persistence.ts) wraps the
`sessionStorage` calls, [`app/viewer/[docId]/viewer-client.tsx`]
hydrates on mount via `useState` lazy initializers, debounce-saves on
every state change, and force-flushes synchronously on `pagehide` /
`visibilitychange:hidden` so nothing is lost to the debounce window.

---

Open the home page, drop a PDF (or click any of the 5 sample documents),
and watch tags appear inline as the agent reads each page. Tags pulse
while the visualization is being prepared, then become clickable.

## How it works

```
┌──────────────┐   POST /api/upload     ┌─────────────────────────────┐
│  Browser     │ ─────────────────────► │  Server                     │
│              │                        │   • saves PDF to /tmp       │
│              │                        │   • pdfjs-dist extracts     │
│              │ ◄─ {docId, pages…} ─── │     text + per-glyph bboxes │
└──────────────┘                        └─────────────────────────────┘
                                                  │
   page renders, then                  per-page   ▼  per-tag
   POST /api/analyze-pdf  ◄──── codex (low effort, JSON schema)
   POST /api/generate-viz ◄──── codex (low effort, +web_search for legal)
```

Detection is parallel (3 pages at a time). Visualization generation is
parallel (4 tags at a time). The first ready tag is auto-selected so the
right pane is never empty.

## The five render modes

| type        | renderer                          | example pick                        |
|-------------|-----------------------------------|-------------------------------------|
| `3d`        | Three.js scene with auto-orbit    | heart, methane, brain               |
| `2d-anim`   | Canvas2D, frame-by-frame draw     | inclined plane, blood flow, valves  |
| `formula`   | KaTeX, headline + step derivation | F=ma, projectile equations          |
| `graph`     | Custom Canvas chart               | range vs angle, bell curve          |
| `2d-text`   | Markdown + cited sources          | Articolo 11, court rulings          |

## Layout

```
app/
  page.tsx                    landing + UploadCard
  viewer/[docId]/page.tsx     main reader
  api/
    upload/                   POST PDF → docId + page metadata
    pdf/[docId]/              GET raw PDF bytes
    doc/[docId]/              GET parsed metadata
    analyze-pdf/              POST page text → DetectedConcept[]
    generate-viz/             POST concept → VizSpec
    sample-pdfs/              GET available samples

components/
  PdfViewer.tsx               pdf.js render + tag-pill overlay
  UploadCard.tsx              landing dropzone + sample grid
  Visualizer/
    index.tsx                 type → renderer routing
    ThreeDView.tsx            sandboxed Three.js executor
    TwoDAnimView.tsx          sandboxed Canvas executor
    FormulaView.tsx           KaTeX
    GraphView.tsx             Canvas chart engine
    TwoDTextView.tsx          Markdown + citations

lib/
  codex.ts                    SDK wrapper, runJson<T>(prompt, schema)
  schemas.ts                  per-type JSON Schemas + TS types
  pdf-extract.ts              pdfjs-dist server-side parsing
  viz-runtime.ts              IIFE-scoped sandbox for LLM-emitted JS
  store.ts                    in-memory + /tmp doc storage
```

## Generating new sample PDFs

`scripts/generate-sample-pdfs.ts` is a single-file pdfkit generator. Add a
new entry to the `docs` array and run `npm run generate-pdfs`.

## Smoke testing

```bash
npm run smoke         # one PDF, one tag click, screenshot
npm run smoke-all     # all 5 PDFs, multiple tag types, screenshots → scripts/smoke-out/
```

Both rely on a running dev server at the URL in `BASE_URL` (default
`http://localhost:3457`).

## Notes & limits

- The PDF must already have a text layer. We do not OCR.
- Visualization code from the LLM runs client-side in a `new Function(...)`
  body wrapped by an IIFE that shadows `THREE`, `ctx`, etc. We block the
  obvious globals (`document`, `window`, `fetch`, `eval`, …) but this is a
  demo sandbox, not a hard security boundary.
- Generation latency: detection ~10–20s/page (low effort), code generation
  ~30–60s for 3D / 2D-anim, ~10–15s for formula / graph / text. Plan
  accordingly when picking PDFs.
