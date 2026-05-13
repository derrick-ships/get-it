<div align="center">

# Get It.

### Read it. See it. Get it.

**The study companion that turns a PDF into a measurable mastery map — built around the document, not in place of it.**

[![GDG AI Hack 2026](https://img.shields.io/badge/GDG%20AI%20Hack-Milan%202026-1a1a2e?style=for-the-badge)](https://gdg.community.dev/)
[![Challenge: Braynr](https://img.shields.io/badge/Challenge-Braynr-6B5BFF?style=for-the-badge)](https://braynr.com)
[![Built with Codex CLI](https://img.shields.io/badge/Built%20with-Codex%20CLI-111113?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/openai/codex)

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Electron](https://img.shields.io/badge/Electron-33-2C2C2C?logo=electron&logoColor=9FEAF9)](https://www.electronjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4.x-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Three.js](https://img.shields.io/badge/Three.js-r184-000000?logo=threedotjs&logoColor=white)](https://threejs.org)
[![pdf.js](https://img.shields.io/badge/pdf.js-5.x-F40F02?logo=mozilla&logoColor=white)](https://mozilla.github.io/pdf.js/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

<br />

![Get It. — hero animation](hero.gif)

</div>

---

## Why Get It. exists

Students already have the PDF. They don't need another summary. They need to **see** the parts of the document that text alone refuses to explain, and they need to **prove to themselves** that they have understood — concept by concept, not page by page. Today that proof is missing: flashcard ratings measure recall in the moment, mindmaps measure how much you drew, summaries measure how patient the AI was. None of these answer the only question that matters on exam day: *would I survive a question I have not seen before?*

Get It. is the layer that answers it. Drop a PDF. Watch the document tag itself with the concepts that benefit from a picture; watch the right pane fill in with 3D models, animations, formulas with derivations, plotted graphs, and cited sources. Open the **Knowledge Graph**, see the document's own backbone laid out as a concept map, every node carrying four scores: **memory, comprehension, structure, application**. Talk to the document in **chat**. Run yourself through an **active-recall deck**, or a **forced-choice quiz** that pits the right answer against plausible distractors. Or — the showpiece — explain a topic to a curious eight-year-old in a **Feynman session** and watch your mastery scores rise as you teach. Every interaction feeds one journal; one evaluator agent reads that journal and back-reflects four numbers per concept onto the graph. The student becomes visible to themselves.

> *"Their knowledge is so fragile."* — Richard Feynman, 1985.<br />
> *"What I cannot create, I do not understand."* — Richard Feynman, last blackboard at Caltech, 1988.

We took both lines literally.

## What it does

| | |
|---|---|
| 🎨 **Visualizer** | The right pane fills in by itself. Up to 4 concept visualizations render in parallel as the document is being read — Three.js scenes for anatomy and molecules, Canvas animations for inclined planes and pendulums, KaTeX for equations and step-by-step derivations, a plot engine for functions and distributions, cited markdown for legal articles and named statutes. |
| 🧭 **Knowledge Graph** | A concept map of the document, built once at upload by a dedicated kg-build agent. Nodes are sized by mastery, colored by progress, clickable for the four-axis breakdown plus the evaluator's per-concept note. The macro learning path is right there on screen. |
| 💬 **Chat** | Multi-turn, multi-thread Q&A grounded in the document. Every assistant reply triggers a debounced re-evaluation of the knowledge graph. |
| 🎴 **Flashcards** | AI-generated active-recall decks per topic. Type your answer, reveal, self-grade 1–4 (Again / Hard / Good / Easy, FSRS convention). Closing a deck triggers an evaluator pass. |
| ✅ **Quizzes** | Forced-choice multiple-choice quizzes per topic. Four options per question — one right, three plausible distractors crafted to expose the confusion the student would actually trip on. Each pick reveals an explanation; ending the quiz triggers an evaluator pass. |
| 💡 **Feynman** | The agent plays a curious 8-year-old. *You* are the teacher. Three to four short, pointed prompts; you explain in plain words; the session ends with an honest summary of where the explanation held and where it broke down. The strongest signal we have for **comprehension**. |
| 📊 **Four-axis evaluator** | After every completed interaction, a dedicated agent reads the full work-context journal and updates per-node scores along four dimensions. Scores are **monotone non-decreasing** — the student can only progress, never regress. |
| 📚 **Library** | Every PDF you've ever opened is one click away. Tags, chats, flashcards, quizzes, Feynman sessions, knowledge graph — all picked up where you left them. Nothing leaves your machine. |
| 📥 **Your data, downloadable** | One click in the right-pane menu pulls the entire work-context JSON — every chat message, every card rating, every quiz answer, every Feynman turn, every timestamp. The same file the evaluator reads. |

## Install (no terminal)

Get It. is a desktop app. **Download the installer for your machine**, double-click, follow the one-time onboarding (sign in to ChatGPT or OpenAI), and you're done.

| Platform | Installer |
|---|---|
| macOS (Apple Silicon — M1/M2/M3/M4) | `Get It-<version>-arm64.dmg` |
| macOS (Intel) | `Get It-<version>.dmg` |
| Windows 10/11 (x64) | `Get It Setup <version>.exe` |
| Linux (x64) | `Get It-<version>.AppImage` |

Builds for every released version are on the **[Releases](https://github.com/beltromatti/get-it/releases)** page.

### First launch

Sign in to your **ChatGPT or OpenAI** account once — that's the only setup. Drop a PDF in, or pick one of the five bundled samples (anatomy, classical mechanics, Italian constitution, calculus, organic chemistry). Tags, chats, flashcard decks, quizzes, Feynman sessions, knowledge graph: all stay on your computer, never on a server. Come back tomorrow and **Library** has every PDF you've opened, picked up exactly where you left them.

Get It. checks for a newer release on every launch and offers a one-click update — nothing to subscribe to, nothing to babysit.

### Storage

Get It. stores everything on your machine — never on a server.

| OS | Where your data lives |
|---|---|
| macOS | `~/Library/Application Support/get-it/` |
| Windows | `%APPDATA%\get-it\` |
| Linux | `~/.local/share/get-it/` |

Layout: one folder per document under `docs/<docId>/` (source PDF + extracted text cache + tags + work context + knowledge graph), plus a `docs.json` index, a `codex-scratch/` working dir, and `logs/` for the embedded server. Deleting a doc from the Library wipes the whole folder.

### macOS Gatekeeper (first launch only)

The builds linked above are unsigned (we're a hackathon project — code-signing certs cost real money). The very first time you open the app, macOS will say it can't verify the developer. Two ways through:

- **Easy**: Right-click on `Get It.app` → **Open** → confirm. macOS remembers your choice for every subsequent launch.
- **CLI**: `xattr -dr com.apple.quarantine "/Applications/Get It.app"`

Windows shows a similar SmartScreen warning the first time. Click **More info → Run anyway**.

## Architecture in one breath

```
upload  ─┬──► visualizer pipeline ─► concept tags + 3D / anim / formula /
         │                            graph / cited-text spec, in parallel,
         │                            with auto-repair on runtime errors
         │
         └──► knowledge-graph pipeline ─► kg-build (once)  +
                                           kg-evaluate (debounced, after every
                                           tool interaction; per-doc queue;
                                           monotone clamp on every update)
```

Every agent — concept detection, visualization spec, kg-build, kg-evaluate, chat, flashcard generation, quiz generation, Feynman child, Feynman summary — is a single `codex exec` invocation through `@openai/codex-sdk`, constrained by a strict per-call JSON Schema. **Nine prompts behind one auth path. Nine schemas behind one shared SDK wrapper.** No god-prompt. No black box.

Detection and per-tag visualization generation aren't renderer loops — they're first-class **server-side jobs**, singleton-per-doc and idempotent. Open a PDF, navigate to Library, open another PDF, leave the window minimised: every doc you've touched keeps its agents running in the background, library badges update live, and you can come back hours later to find work finished without re-doing anything. Multiple PDFs progress in parallel.

The desktop app is a thin Electron shell over the same Next.js 16 application that we ran in the browser at the hackathon. The shell:

- ships the Codex CLI binary inside the bundle so users don't install anything by hand,
- on every launch, before anything else, checks GitHub Releases for a newer build and offers an in-app one-click update,
- runs a first-launch wizard that handles installation gaps and the OAuth login,
- spawns the Next.js standalone server on a free localhost port and points a single Chromium window at it,
- watches Codex for auth loss and rate-limit hits, and re-enters the setup wizard or shows a countdown banner without losing any work,
- persists everything to the OS-native user-data directory.

The full architecture is in [`technical-writeup.md`](technical-writeup.md) (also rendered as a [PDF](technical-writeup.pdf)).

## Hack on it (developer mode)

```bash
git clone https://github.com/beltromatti/get-it.git
cd get-it
npm install
npm run dev                   # builds + opens the packaged Electron app
```

`npm run dev` builds the Next.js standalone bundle and runs it inside Electron — that's the loop the end user gets, and the one that exercises the setup wizard, the embedded server, and the IPC bridge. Re-run it after edits.

If you prefer browser-side hot reload, run Next on its own and open it in Chrome / Safari:

```bash
npm run browser:dev           # http://localhost:3000
```

(Heads up: there's a known Next 16.2.6 + Turbopack + Chromium 130 hydration glitch that breaks `next dev` *inside* Electron — the WebSocket HMR handshake fails and React never hydrates. So we don't recommend `dev:hmr` for day-to-day work. Browser dev or rebuild-and-test is the cleaner loop.)

To make a desktop build locally for one or all targets:

```bash
npm run build                       # next build (creates .next/standalone)
npm run electron:prepare            # stages public/ + static/ + host codex binary

# Single target:
node scripts/build-electron.mjs --target=mac-arm64
node scripts/build-electron.mjs --target=mac-x64
node scripts/build-electron.mjs --target=win-x64

# All three sequentially:
node scripts/build-electron.mjs --all
```

The artefacts land in `dist-electron/`. The cross-arch builds will fetch the matching Codex platform package from npm on the fly — you don't need an Intel Mac or a Windows VM, the script downloads what it needs.

For releases, push a `vX.Y.Z` tag to `main` — the `.github/workflows/release.yml` workflow builds every target in parallel on its native runner and attaches the artefacts to a GitHub Release.

## The team

Built in 24 hours at **GDG AI Hack 2026, Milan**, for the **Braynr** challenge. The hackathon submission lived at commit `277ec43`; everything you see beyond that commit is post-hackathon polish — most notably the desktop packaging, the persistent library, and the first-launch setup wizard. The product is the same; only the way it gets onto a student's laptop has changed.

- **Mattia Beltrami** — Politecnico di Milano
- **Matteo Impieri** — Politecnico di Milano
- **Filippo Difronzo** — Politecnico di Milano
- **Luca Feggi** — Università di Padova

## Want the deeper read

[`technical-writeup.md`](technical-writeup.md) — the full design rationale: the four-axis rubric, the per-doc evaluator queue, the parallel visualizer agents, the LLM-code sandbox, the work-context journal, the 14 lessons from learning research that shaped the UX, and the desktop-packaging layer that wraps it all. Also rendered as [`technical-writeup.pdf`](technical-writeup.pdf).

## License

MIT — see source files. Built for an open hackathon; do as you like with it.
