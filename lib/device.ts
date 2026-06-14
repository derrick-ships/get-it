/**
 * Device introspection used to recommend a local model the machine can
 * actually run. Pure Node (os/process) so it works from any API route in
 * the Electron child server. GPU detail, when available, is passed down
 * from the Electron main process via the GETIT_GPU_INFO env var.
 */

import os from "node:os";
import { recommendOllamaModel } from "./codex-models";

export type DeviceInfo = {
  ramGB: number;
  cores: number;
  cpuModel: string;
  platform: NodeJS.Platform;
  arch: string;
  gpu: string | null;
};

export function getDeviceInfo(): DeviceInfo {
  const cpus = os.cpus();
  return {
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    cores: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    platform: process.platform,
    arch: process.arch,
    gpu: process.env.GETIT_GPU_INFO?.trim() || null,
  };
}

export function deviceRecommendation() {
  const device = getDeviceInfo();
  return { device, recommended: recommendOllamaModel(device.ramGB) };
}
