// Thin wrapper around the shared managed-tool installer for cloudflared.
// Historical exports are preserved for compatibility with `init`, `preview`,
// `doctor`, and the smoke script.

import {
  installManagedTool,
  managedToolVersion,
  readManagedToolMetadata,
  resolveManagedToolBin,
  type ManagedToolInstall,
} from "./managed-tool-installer.js";

/** @deprecated retained for compatibility — prefer `ManagedToolInstall`. */
export type CloudflaredInstall = ManagedToolInstall;

export function installCloudflared(opts: { force?: boolean } = {}): Promise<CloudflaredInstall> {
  return installManagedTool("cloudflared", opts);
}

export function resolveCloudflaredBin(): string | null {
  return resolveManagedToolBin(
    "cloudflared",
    "VEGASTACK_CLOUDFLARED_BIN",
    process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
}

export function readCloudflaredMetadata(): CloudflaredInstall | null {
  return readManagedToolMetadata("cloudflared");
}

export function cloudflaredVersion(bin: string): string | null {
  return managedToolVersion(bin);
}

export function quickTunnelNotice(): string {
  return "Cloudflare Quick Tunnels are temporary development previews, not production hosting. They use trycloudflare.com, have no SLA, and may have traffic/protocol limits.";
}
