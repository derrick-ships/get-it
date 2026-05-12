"use strict";

const els = {
  stepInstall: document.getElementById("step-install"),
  stepLogin: document.getElementById("step-login"),
  installDesc: document.getElementById("install-desc"),
  installStatus: document.getElementById("install-status"),
  btnInstall: document.getElementById("btn-install"),
  loginDesc: document.getElementById("login-desc"),
  loginStatus: document.getElementById("login-status"),
  btnLogin: document.getElementById("btn-login"),
  btnFinish: document.getElementById("btn-finish"),
  btnCancel: document.getElementById("btn-cancel"),
  platformInfo: document.getElementById("platform-info"),
  authUrlBox: document.getElementById("auth-url-box"),
  authUrl: document.getElementById("auth-url"),
  btnOpenUrl: document.getElementById("btn-open-url"),
};

let lastAuthUrl = null;
let lastPhase = "idle";

function render(s) {
  if (!s) return;
  els.platformInfo.textContent = s.targetTriple
    ? `Platform: ${s.targetTriple}  ·  Required: ≥ ${s.requiredVersion}`
    : "";

  // ── Step 1: install / version
  const installOk = s.binaryFound && s.versionOk;
  els.stepInstall.classList.toggle("done", installOk);
  els.stepInstall.classList.toggle("active", !installOk && (s.phase ?? "idle") !== "logging-in");
  els.stepInstall.classList.toggle("error", s.phase === "error" && !installOk);
  if (!s.binaryFound) {
    els.installDesc.textContent = `Codex CLI ${s.requiredVersion} is not installed. Install it now — it's a one-time download (~30 MB).`;
    els.btnInstall.disabled = false;
    els.btnInstall.textContent = "Install Codex CLI";
  } else if (!s.versionOk) {
    els.installDesc.textContent = `Codex CLI ${s.version ?? "?"} is installed but Get It needs ≥ ${s.requiredVersion}. Update?`;
    els.btnInstall.disabled = false;
    els.btnInstall.textContent = "Update Codex CLI";
  } else {
    els.installDesc.textContent = `Codex CLI ${s.version} is ready.`;
    els.btnInstall.disabled = true;
    els.btnInstall.textContent = "Installed";
  }
  if (s.phase === "installing") {
    els.installStatus.innerHTML = `<span class="spinner"></span>${escapeHtml(s.message || "Installing…")}`;
    els.btnInstall.disabled = true;
  } else if (s.phase === "error" && !installOk) {
    els.installStatus.innerHTML = `<span class="err">${escapeHtml(s.message || "Failed.")}</span>`;
  } else if (installOk) {
    els.installStatus.innerHTML = `<span class="ok">✓ Ready</span>`;
  } else {
    els.installStatus.innerHTML = "";
  }

  // ── Step 2: login (only enabled once install is OK)
  els.stepLogin.classList.toggle("done", s.loggedIn);
  els.stepLogin.classList.toggle("active", installOk && !s.loggedIn);
  els.stepLogin.classList.toggle("error", s.phase === "error" && installOk && !s.loggedIn);
  if (!installOk) {
    els.loginDesc.textContent = "Install Codex CLI first.";
    els.btnLogin.disabled = true;
    els.loginStatus.innerHTML = "";
  } else if (s.loggedIn) {
    els.loginDesc.textContent = "You're signed in to Codex.";
    els.btnLogin.disabled = true;
    els.btnLogin.textContent = "Signed in";
    els.loginStatus.innerHTML = `<span class="ok">✓ Connected</span>`;
  } else {
    els.loginDesc.textContent = "A browser window will open. After you finish signing in there, this dialog continues automatically.";
    els.btnLogin.disabled = s.phase === "logging-in";
    els.btnLogin.textContent = "Sign in with ChatGPT";
    if (s.phase === "logging-in") {
      els.loginStatus.innerHTML = `<span class="spinner"></span>${escapeHtml(s.message || "Waiting for browser…")}`;
    } else if (s.phase === "error") {
      els.loginStatus.innerHTML = `<span class="err">${escapeHtml(s.message || "Login failed.")}</span>`;
    } else {
      els.loginStatus.innerHTML = "";
    }
  }

  // Auth-url fallback
  if (s.authUrl && s.phase === "logging-in") {
    lastAuthUrl = s.authUrl;
    els.authUrlBox.hidden = false;
    els.authUrl.textContent = s.authUrl;
  } else if (s.phase !== "logging-in") {
    els.authUrlBox.hidden = true;
    lastAuthUrl = null;
  }

  // ── Finish button — only enabled when everything green
  els.btnFinish.disabled = !(installOk && s.loggedIn);

  lastPhase = s.phase ?? "idle";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ── Wire buttons ────────────────────────────────────────────────────────
els.btnInstall.addEventListener("click", async () => {
  els.btnInstall.disabled = true;
  await window.wizard.install();
});
els.btnLogin.addEventListener("click", async () => {
  els.btnLogin.disabled = true;
  await window.wizard.login();
});
els.btnFinish.addEventListener("click", async () => {
  await window.wizard.finish();
});
els.btnCancel.addEventListener("click", async () => {
  await window.wizard.cancel();
});
els.btnOpenUrl.addEventListener("click", async () => {
  if (lastAuthUrl) await window.wizard.openUrl(lastAuthUrl);
});

// ── Live status pushes from main ────────────────────────────────────────
window.wizard.onStatus(render);
window.wizard.status().then(render);
