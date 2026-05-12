/**
 * Get It — Codex CLI setup module.
 *
 * Detects, installs/updates, and authenticates the Codex CLI before the
 * Next.js server starts — and again any time the renderer reports that a
 * Codex call has failed with auth_lost / binary_missing.
 *
 * Design notes:
 *
 *  • The Codex binary ships *inside* node_modules via the @openai/codex
 *    npm package (a thin wrapper) + a platform-specific optionalDep that
 *    contains the actual Rust binary. So "installing Codex" in our case
 *    really means "make sure @openai/codex-<platform>-<arch> is present
 *    on disk". We never touch system PATH.
 *
 *  • We resolve the binary by walking node_modules ourselves (we don't
 *    rely on the SDK's lookup because we want to know whether the file
 *    exists *before* we spawn the server). The vendor layout is exactly
 *    what codex-sdk uses: vendor/<target-triple>/codex/codex(.exe).
 *
 *  • For OAuth login we spawn `codex login` and parse its stdout. The
 *    binary itself opens the browser via the `webbrowser` crate; if that
 *    fails we also surface the URL in the wizard window. Success is the
 *    literal line "Successfully logged in", failure is a non-zero exit.
 *
 *  • The wizard is its own BrowserWindow loading electron/wizard/*.html
 *    — file:// works fine here, it's a stand-alone static page. The
 *    main app window only opens after the wizard resolves successfully.
 */

"use strict";

const { BrowserWindow, ipcMain, shell, app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const https = require("node:https");
const os = require("node:os");
const zlib = require("node:zlib");

const REQUIRED_CODEX_VERSION = "0.130.0";

// ── Platform target triple (same table as @openai/codex-sdk) ────────────
const PLATFORM_PACKAGE_BY_TARGET = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

function targetTriple() {
  const { platform, arch } = process;
  if (platform === "linux" || platform === "android") {
    if (arch === "x64") return "x86_64-unknown-linux-musl";
    if (arch === "arm64") return "aarch64-unknown-linux-musl";
  } else if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin";
    if (arch === "arm64") return "aarch64-apple-darwin";
  } else if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
  }
  return null;
}

function platformPackage() {
  const t = targetTriple();
  return t ? PLATFORM_PACKAGE_BY_TARGET[t] : null;
}

// ── Search roots: bundled (production) first, then host node_modules ────
function candidateNodeModulesRoots() {
  const roots = new Set();
  const add = (p) => p && roots.add(p);
  if (process.resourcesPath) {
    // electron-builder asarUnpack target
    add(path.join(process.resourcesPath, "app.asar.unpacked", "node_modules"));
    // electron-builder extraResources fallback
    add(path.join(process.resourcesPath, "node_modules"));
  }
  add(path.join(app.getAppPath(), "node_modules"));
  add(path.join(app.getAppPath(), ".next", "standalone", "node_modules"));
  return [...roots];
}

/**
 * The packaged app stages exactly one platform binary at
 * `electron/codex-bin/<triple>/codex/codex(.exe)` — this is the path that
 * extraResources lands at runtime. We try it first; then fall back to
 * the node_modules layout (useful in dev and as a recovery path).
 */
function bundledStagedBinaryPaths() {
  const triple = targetTriple();
  if (!triple) return [];
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const out = [];
  if (process.resourcesPath) {
    out.push(
      path.join(process.resourcesPath, "app.asar.unpacked", "electron", "codex-bin", triple, "codex", exe),
      path.join(process.resourcesPath, "electron", "codex-bin", triple, "codex", exe),
    );
  }
  out.push(path.join(app.getAppPath(), "electron", "codex-bin", triple, "codex", exe));
  return out;
}

function resolveCodexBinary() {
  const triple = targetTriple();
  const pkg = platformPackage();
  if (!triple || !pkg) return null;
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  // 1. Staged binary inside the packaged app
  for (const candidate of bundledStagedBinaryPaths()) {
    if (fs.existsSync(candidate)) {
      try {
        if (process.platform !== "win32") fs.chmodSync(candidate, 0o755);
      } catch {
        /* ignore */
      }
      return candidate;
    }
  }
  // 2. node_modules lookup (dev mode + recovery)
  for (const root of candidateNodeModulesRoots()) {
    const candidate = path.join(root, pkg, "vendor", triple, "codex", exe);
    if (fs.existsSync(candidate)) {
      try {
        if (process.platform !== "win32") fs.chmodSync(candidate, 0o755);
      } catch {
        /* ignore */
      }
      return candidate;
    }
  }
  // 3. User-data fallback (downloaded into ~/Library/Application Support/get-it/codex-bundle)
  const userDataBin = bundledCodexPath();
  if (userDataBin && fs.existsSync(userDataBin)) return userDataBin;
  return null;
}

function getCodexVersion(binPath) {
  if (!binPath) return null;
  try {
    const r = spawnSync(binPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return null;
    const out = (r.stdout || "").trim();
    const m = /(\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?)/i.exec(out);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function semverGte(a, b) {
  if (!a || !b) return false;
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

function isCodexAuthenticated(binPath) {
  if (!binPath) return false;
  try {
    const r = spawnSync(binPath, ["login", "status"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0) return false;
    const out = (r.stdout || "") + (r.stderr || "");
    return /Logged in/i.test(out);
  } catch {
    return false;
  }
}

// ── Bundled binary fetch (when missing) ─────────────────────────────────
// In the packaged app the codex binary should always be present, but if
// it isn't (corrupted install, antivirus quarantine, etc.) we offer to
// download it from npm and drop it into a writable spot under userData.
const NPM_REGISTRY = "https://registry.npmjs.org";

function userDataBundleRoot() {
  const root = path.join(app.getPath("userData"), "codex-bundle");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function bundledCodexPath() {
  const triple = targetTriple();
  if (!triple) return null;
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  return path.join(userDataBundleRoot(), "vendor", triple, "codex", exe);
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          downloadToBuffer(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchCodexBinaryToUserData(version, onProgress) {
  const triple = targetTriple();
  if (!triple) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  // The platform package on npm has a versioned aliased name:
  //   "@openai/codex" with versions "0.130.0-darwin-arm64" etc.
  // We download its tarball directly.
  const suffix = (() => {
    if (triple === "x86_64-unknown-linux-musl") return "linux-x64";
    if (triple === "aarch64-unknown-linux-musl") return "linux-arm64";
    if (triple === "x86_64-apple-darwin") return "darwin-x64";
    if (triple === "aarch64-apple-darwin") return "darwin-arm64";
    if (triple === "x86_64-pc-windows-msvc") return "win32-x64";
    if (triple === "aarch64-pc-windows-msvc") return "win32-arm64";
    throw new Error("Unsupported target");
  })();
  const tarballUrl = `${NPM_REGISTRY}/@openai/codex/-/codex-${version}-${suffix}.tgz`;
  onProgress?.({ phase: "download", note: tarballUrl });
  const gzBuf = await downloadToBuffer(tarballUrl);
  const tarBuf = zlib.gunzipSync(gzBuf);
  onProgress?.({ phase: "extract" });
  // Parse the tar buffer manually (POSIX USTAR format). We only need the
  // vendor/<triple>/codex/codex(.exe) and any sibling files. Streaming
  // tar parsers exist but adding a dep just for one tarball isn't worth it.
  await extractTarBuffer(tarBuf, userDataBundleRoot());
  const out = bundledCodexPath();
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(out, 0o755);
    } catch {
      /* ignore */
    }
  }
  if (!fs.existsSync(out)) {
    throw new Error(`Codex binary not found at ${out} after extraction`);
  }
  return out;
}

function extractTarBuffer(buf, destRoot) {
  // POSIX ustar tar: 512-byte header + content padded to 512.
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      offset += 512;
      continue;
    }
    let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeStr = header.subarray(124, 124 + 12).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr || "0", 8);
    const typeFlag = String.fromCharCode(header[156] || 0);
    const prefix = header.subarray(345, 345 + 155).toString("utf8").replace(/\0.*$/, "");
    if (prefix) name = `${prefix}/${name}`;
    // npm tarballs nest contents under "package/". Strip it.
    name = name.replace(/^package\//, "");
    const start = offset + 512;
    const end = start + size;
    if (typeFlag === "0" || typeFlag === "" || typeFlag === "\0") {
      const fileBuf = buf.subarray(start, end);
      const outPath = path.join(destRoot, name);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, fileBuf);
    } else if (typeFlag === "5") {
      fs.mkdirSync(path.join(destRoot, name), { recursive: true });
    }
    offset = end + (512 - (size % 512)) % 512;
  }
  return Promise.resolve();
}

// ── Wizard window ───────────────────────────────────────────────────────
// We talk to it over IPC. Loading wizard.html via file:// is the simplest
// path; nothing in the wizard needs a server.
let wizardWindow = null;
let wizardResolvers = []; // queue of {resolve, reject} for current showSetupWindow calls

function ensureIpcHandlers() {
  if (ensureIpcHandlers._wired) return;
  ensureIpcHandlers._wired = true;

  ipcMain.handle("wizard:status", () => refreshCodexStatus());
  ipcMain.handle("wizard:install", async () => {
    const status = refreshCodexStatus();
    if (status.binaryFound && semverGte(status.version, REQUIRED_CODEX_VERSION)) {
      sendStatus();
      return refreshCodexStatus();
    }
    try {
      sendStatus({ phase: "installing", message: "Downloading Codex CLI…" });
      await fetchCodexBinaryToUserData(REQUIRED_CODEX_VERSION, (p) => {
        sendStatus({ phase: "installing", message: p.phase === "download" ? "Downloading Codex CLI…" : "Unpacking Codex CLI…" });
      });
      sendStatus({ phase: "idle" });
    } catch (err) {
      sendStatus({ phase: "error", message: String(err && err.message ? err.message : err) });
      return refreshCodexStatus();
    }
    return refreshCodexStatus();
  });
  ipcMain.handle("wizard:login", async () => {
    sendStatus({ phase: "logging-in", message: "Waiting for browser login…" });
    try {
      const ok = await runCodexLogin((line) => {
        // expose the auth URL if the binary prints one
        const m = /(https?:\/\/[^\s]+auth[^\s]*)/i.exec(line);
        if (m) {
          sendStatus({ phase: "logging-in", message: "Waiting for browser login…", authUrl: m[1] });
        }
      });
      sendStatus({ phase: ok ? "idle" : "error", message: ok ? undefined : "Login did not complete." });
    } catch (err) {
      sendStatus({ phase: "error", message: String(err && err.message ? err.message : err) });
    }
    return refreshCodexStatus();
  });
  ipcMain.handle("wizard:open-url", async (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      await shell.openExternal(url).catch(() => {});
    }
  });
  ipcMain.handle("wizard:finish", () => {
    const status = refreshCodexStatus();
    if (status.binaryFound && status.versionOk && status.loggedIn) {
      closeWizardWindow(true);
    }
    return status;
  });
  ipcMain.handle("wizard:cancel", () => {
    closeWizardWindow(false);
  });
}

function closeWizardWindow(resolved) {
  const w = wizardWindow;
  wizardWindow = null;
  for (const r of wizardResolvers) {
    if (resolved) r.resolve(true);
    else r.resolve(false);
  }
  wizardResolvers = [];
  if (w && !w.isDestroyed()) w.close();
}

function sendStatus(extra) {
  if (!wizardWindow || wizardWindow.isDestroyed()) return;
  const base = refreshCodexStatus();
  const merged = { ...base, ...(extra || {}) };
  wizardWindow.webContents.send("wizard-status", merged);
}

async function showSetupWindow(opts = {}) {
  ensureIpcHandlers();
  if (wizardWindow) {
    wizardWindow.focus();
    return new Promise((resolve, reject) => {
      wizardResolvers.push({ resolve, reject });
    });
  }
  wizardWindow = new BrowserWindow({
    width: 560,
    height: 600,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Get It — Setup",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload-wizard.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  wizardWindow.removeMenu?.();
  wizardWindow.loadFile(path.join(__dirname, "wizard", "index.html"), {
    query: { reason: opts.reason || "first-run" },
  });
  wizardWindow.once("ready-to-show", () => {
    wizardWindow?.show();
    sendStatus();
  });
  wizardWindow.on("closed", () => {
    const w = wizardWindow;
    wizardWindow = null;
    // If the user x-ed out without finishing, treat as cancel.
    for (const r of wizardResolvers) r.resolve(false);
    wizardResolvers = [];
    void w; // silence lint
  });
  return new Promise((resolve, reject) => {
    wizardResolvers.push({ resolve, reject });
  });
}

// ── codex login subprocess driver ───────────────────────────────────────
function runCodexLogin(onLine) {
  return new Promise((resolve, reject) => {
    const bin = resolveCodexBinary();
    if (!bin) {
      reject(new Error("Codex binary not available"));
      return;
    }
    const child = spawn(bin, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdoutBuf = "";
    let succeeded = false;
    const onChunk = (data) => {
      const text = data.toString("utf8");
      stdoutBuf += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        onLine?.(line);
        if (/Successfully logged in/i.test(line)) {
          succeeded = true;
        }
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.once("exit", (code) => {
      if (succeeded || code === 0) {
        resolve(true);
      } else {
        // Useful detail when something went wrong
        const tail = stdoutBuf.split(/\r?\n/).slice(-3).join("\n").trim();
        reject(new Error(tail || `codex login exited with code ${code}`));
      }
    });
    child.once("error", reject);
  });
}

// ── Status snapshot + subscribers ───────────────────────────────────────
const statusSubscribers = new Set();

function refreshCodexStatus() {
  const bin = resolveCodexBinary();
  const version = bin ? getCodexVersion(bin) : null;
  const versionOk = version ? semverGte(version, REQUIRED_CODEX_VERSION) : false;
  const loggedIn = bin && versionOk ? isCodexAuthenticated(bin) : false;
  const status = {
    binaryFound: !!bin,
    binaryPath: bin,
    version,
    requiredVersion: REQUIRED_CODEX_VERSION,
    versionOk,
    loggedIn,
    targetTriple: targetTriple(),
  };
  for (const cb of statusSubscribers) {
    try {
      cb(status);
    } catch {
      /* ignore */
    }
  }
  return status;
}

function onCodexStatusChange(cb) {
  statusSubscribers.add(cb);
  return () => statusSubscribers.delete(cb);
}

// ── Public: run before main window opens ────────────────────────────────
async function ensureCodexReady() {
  ensureIpcHandlers();
  let status = refreshCodexStatus();
  if (status.binaryFound && status.versionOk && status.loggedIn) {
    return true;
  }
  const ok = await showSetupWindow({ reason: "first-run" });
  status = refreshCodexStatus();
  // Even if the wizard returned, only proceed if every gate is green.
  return ok && status.binaryFound && status.versionOk && status.loggedIn;
}

module.exports = {
  ensureCodexReady,
  showSetupWindow,
  resolveCodexBinary,
  refreshCodexStatus,
  onCodexStatusChange,
};
