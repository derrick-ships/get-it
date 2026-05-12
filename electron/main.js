/**
 * Get It — Electron main process.
 *
 * Responsibilities:
 *  1. Resolve the per-user data directory (Electron's userData) and expose
 *     it to the Next.js child via the BRAYNR_DATA_DIR env var. The Next
 *     server reads that env var to anchor every on-disk path — same
 *     resolution rules as in pure-Next dev, so the layout is identical
 *     whether you run `npm run dev` or open the packaged app.
 *
 *  2. Run the Codex setup wizard (electron/setup.js) before launching the
 *     main window: detect the Codex CLI binary, prompt to install it if
 *     missing, prompt for `codex login` if the user is not authenticated,
 *     and re-enter this wizard mid-session if Codex ever stops working.
 *
 *  3. Spawn `.next/standalone/server.js` as a child Node process on a
 *     free localhost port, wait for it to respond, then open a
 *     BrowserWindow pointing at that URL. The UI is the exact same Next.js
 *     app you see in the browser — no DOM rewiring.
 *
 *  4. Forward graceful shutdown to the child so we never leave a zombie
 *     server on a port (a real problem on Windows that breaks the next
 *     launch).
 */

"use strict";

// Guard: if ELECTRON_RUN_AS_NODE leaks into the env, Electron loads as
// plain Node and `app` is undefined — manifesting as a confusing
// "Cannot read properties of undefined (reading 'requestSingleInstanceLock')"
// crash. Detect and bail out cleanly with a useful message.
if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  // eslint-disable-next-line no-console
  console.error(
    "[get-it] ELECTRON_RUN_AS_NODE=1 is set — unsetting it so Electron starts in main-process mode.\n" +
      "  If you're seeing this in a real packaged install, please report it.",
  );
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const electronModule = require("electron");
if (typeof electronModule === "string") {
  // We were loaded as a node script, not as the Electron entry point.
  // This is almost always the same env-var problem above; just exit
  // before the API-undefined crash.
  // eslint-disable-next-line no-console
  console.error(
    "[get-it] The Electron API is not available. Did you launch with `npx electron .`?",
  );
  process.exit(1);
}

const { app, BrowserWindow, dialog, shell, ipcMain } = electronModule;
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const http = require("node:http");
const {
  ensureCodexReady,
  showSetupWindow,
  resolveCodexBinary,
  refreshCodexStatus,
  onCodexStatusChange,
} = require("./setup");

// ── Single-instance lock ────────────────────────────────────────────────
// If the user double-clicks the app icon a second time, focus the existing
// window rather than spawning a second Next server (port conflict + KG
// races on the same data dir).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

// ── Data dir resolution ─────────────────────────────────────────────────
// `app.getPath('userData')` defaults to:
//   macOS:  ~/Library/Application Support/<productName>
//   Windows: %APPDATA%/<productName>
//   Linux:  ~/.config/<productName>
// We set productName explicitly so this matches the AGENTS dir used in
// pure-Next dev (lib/paths.ts → defaultUserDataDir).
// We want the on-disk folder to be `get-it` (no space) so it matches the
// pure-Next dev default (lib/paths.ts → defaultUserDataDir). Electron's
// default would be `Application Support/Get It` because productName has
// a space; force the override here BEFORE anyone calls app.getPath().
app.setName("get-it");
const ELECTRON_USER_DATA_PARENT = path.dirname(app.getPath("userData"));
const DATA_DIR = path.join(ELECTRON_USER_DATA_PARENT, "get-it");
app.setPath("userData", DATA_DIR);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "logs"), { recursive: true });

// ── Resolve the Next.js standalone server entry ─────────────────────────
// In `electron .` dev mode the user runs `npm run electron:dev` which
// boots `next dev` separately and points us at it via the env var.
// In production the standalone server lives next to this file inside the
// app's resources directory.
const DEV_URL = process.env.ELECTRON_DEV_URL || null;

function resolveStandalonePath() {
  // Possible locations, in priority order:
  //   1. <app root>/.next/standalone (running unpacked / inside the source tree)
  //   2. process.resourcesPath/app.asar.unpacked/.next/standalone (packaged)
  //   3. process.resourcesPath/standalone (when we copied .next/standalone
  //      out via electron-builder extraResources)
  const candidates = [
    path.join(app.getAppPath(), ".next", "standalone"),
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked", ".next", "standalone")
      : null,
    process.resourcesPath ? path.join(process.resourcesPath, "standalone") : null,
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "server.js"))) return c;
  }
  return null;
}

// ── Pick a free localhost port ──────────────────────────────────────────
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// ── Wait until the server answers HTTP /200 ─────────────────────────────
function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http
        .get(url, { timeout: 1500 }, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        })
        .on("error", retry)
        .on("timeout", () => {
          req.destroy();
          retry();
        });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("Server never became ready"));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

// ── Spawn the embedded Next server ──────────────────────────────────────
let serverChild = null;
let serverUrl = null;

async function startEmbeddedServer() {
  if (DEV_URL) {
    serverUrl = DEV_URL;
    return;
  }
  const standalone = resolveStandalonePath();
  if (!standalone) {
    dialog.showErrorBox(
      "Get It — internal error",
      "Could not find the embedded server. The packaged app is incomplete.",
    );
    app.quit();
    return;
  }
  const port = await pickFreePort();
  const env = {
    ...process.env,
    BRAYNR_DATA_DIR: DATA_DIR,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };
  // Tell the SDK where the codex binary actually is — when we bundle the
  // platform-specific package outside the standalone trace, this lets it
  // skip module resolution entirely.
  const codexBin = resolveCodexBinary();
  if (codexBin) env.CODEX_BINARY_PATH = codexBin;

  const nodeBin = process.execPath; // Electron's own node — works for ES modules
  const serverJs = path.join(standalone, "server.js");

  serverChild = spawn(nodeBin, [serverJs], {
    cwd: standalone,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logPath = path.join(DATA_DIR, "logs", "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  serverChild.stdout?.pipe(logStream);
  serverChild.stderr?.pipe(logStream);
  serverChild.once("exit", (code, signal) => {
    logStream.write(`\n[server exited code=${code} signal=${signal} ts=${new Date().toISOString()}]\n`);
  });

  serverUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(serverUrl, 45000);
}

function stopEmbeddedServer() {
  if (!serverChild || serverChild.killed) return;
  try {
    serverChild.kill();
  } catch {
    /* ignore */
  }
  serverChild = null;
}

// ── Main window ─────────────────────────────────────────────────────────
let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "Get It",
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Force any new-window request (e.g. shell.openExternal) into the OS
  // browser. The packaged app never opens secondary windows itself.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!serverUrl) {
    dialog.showErrorBox(
      "Get It — internal error",
      "The embedded server did not start.",
    );
    app.quit();
    return;
  }
  mainWindow.loadURL(serverUrl);
}

// ── IPC: expose Codex status / refresh to the renderer ──────────────────
// The setup module is the source of truth for codex state. The renderer
// queries it through these IPC channels; updates push as `codex-status`
// events.
ipcMain.handle("codex:status", () => refreshCodexStatus());
ipcMain.handle("codex:setup", async () => {
  await showSetupWindow({ reason: "manual" });
  return refreshCodexStatus();
});

onCodexStatusChange((status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("codex-status", status);
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    // Run the wizard FIRST. We can't start the Next server without codex
    // — the agents would crash on the first request.
    const ok = await ensureCodexReady();
    if (!ok) {
      app.quit();
      return;
    }
    await startEmbeddedServer();
    createMainWindow();
  } catch (err) {
    dialog.showErrorBox(
      "Get It — failed to start",
      String(err && err.message ? err.message : err),
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  // macOS dock click — recreate the window if everything was closed.
  if (mainWindow == null && serverUrl) createMainWindow();
});

app.on("before-quit", () => {
  stopEmbeddedServer();
});
