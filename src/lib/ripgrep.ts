// Thin wrapper around the shared managed-tool installer for ripgrep.
// Historical exports are preserved for compatibility with `init`,
// `registry-search`, `doctor`, and the smoke script.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  installManagedTool,
  managedToolVersion,
  readManagedToolMetadata,
  type ManagedToolInstall,
} from "./managed-tool-installer.js";
import { MANAGED_TOOLS_MANIFEST, managedToolTarget } from "./managed-tools-manifest.js";

const RIPGREP_VERSION = MANAGED_TOOLS_MANIFEST.tools.ripgrep.version;

/** @deprecated retained for compatibility — prefer `ManagedToolInstall`. */
export type RipgrepInstall = ManagedToolInstall;

export function installRipgrep(opts: { force?: boolean } = {}): Promise<RipgrepInstall> {
  return installManagedTool("ripgrep", opts);
}

/**
 * Resolve a ripgrep binary. Unlike the generic resolver, ripgrep falls back to
 * a system-PATH binary only when `VEGASTACK_ALLOW_SYSTEM_TOOLS=1` is set.
 */
export function resolveRipgrepBin(): string | null {
  const override = process.env.VEGASTACK_RG_BIN;
  if (override && fs.existsSync(override)) return override;

  const metadata = readManagedToolMetadata("ripgrep");
  const target = managedToolTarget("ripgrep");
  if (
    metadata &&
    target &&
    fs.existsSync(metadata.bin) &&
    metadata.version === RIPGREP_VERSION &&
    metadata.asset === target.asset &&
    metadata.asset_sha256 === target.sha256 &&
    metadata.bin_sha256 === fileSha256Safe(metadata.bin)
  ) {
    return metadata.bin;
  }

  if (process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS === "1") {
    return findOnPath(process.platform === "win32" ? "rg.exe" : "rg");
  }
  return null;
}

export function readRipgrepMetadata(): RipgrepInstall | null {
  return readManagedToolMetadata("ripgrep");
}

export function ripgrepVersion(bin: string): string | null {
  return managedToolVersion(bin);
}

export function supportedRipgrepTarget(): string {
  return `${process.platform}/${process.arch}`;
}

function findOnPath(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // keep searching
    }
  }
  return null;
}

function fileSha256Safe(file: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}
