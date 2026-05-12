/**
 * Preload — exposes a small, typed bridge so the renderer can ask the
 * main process whether Codex is healthy and ask it to re-run the setup
 * wizard. Nothing else crosses the boundary.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("getit", {
  getCodexStatus: () => ipcRenderer.invoke("codex:status"),
  runCodexSetup: () => ipcRenderer.invoke("codex:setup"),
  onCodexStatus: (cb) => {
    const wrapped = (_e, status) => {
      try {
        cb(status);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("codex-status", wrapped);
    return () => ipcRenderer.removeListener("codex-status", wrapped);
  },
});
