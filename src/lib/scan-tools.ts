import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import {
  installManagedTool,
  managedToolVersion,
  readManagedToolMetadata,
  resolveManagedToolBin,
  type ManagedToolInstall,
} from "./managed-tool-installer.js";

export type ScanToolName = "actionlint" | "gitleaks" | "osv-scanner" | "trivy" | "zizmor";

const BIN_NAMES: Record<ScanToolName, string> = {
  actionlint: process.platform === "win32" ? "actionlint.exe" : "actionlint",
  gitleaks: process.platform === "win32" ? "gitleaks.exe" : "gitleaks",
  "osv-scanner": process.platform === "win32" ? "osv-scanner.exe" : "osv-scanner",
  trivy: process.platform === "win32" ? "trivy.exe" : "trivy",
  zizmor: process.platform === "win32" ? "zizmor.exe" : "zizmor",
};

const ENV_NAMES: Record<ScanToolName, string> = {
  actionlint: "VEGASTACK_ACTIONLINT_BIN",
  gitleaks: "VEGASTACK_GITLEAKS_BIN",
  "osv-scanner": "VEGASTACK_OSV_SCANNER_BIN",
  trivy: "VEGASTACK_TRIVY_BIN",
  zizmor: "VEGASTACK_ZIZMOR_BIN",
};

const VERSION_ARGS: Record<ScanToolName, string[]> = {
  actionlint: ["--version"],
  gitleaks: ["version"],
  "osv-scanner": ["--version"],
  trivy: ["--version"],
  zizmor: ["--version"],
};

export async function installScanTool(
  name: ScanToolName,
  opts: { force?: boolean } = {},
): Promise<ManagedToolInstall> {
  return installManagedTool(name, opts);
}

export function resolveScanToolBin(name: ScanToolName): string | null {
  return resolveManagedToolBin(name, ENV_NAMES[name], BIN_NAMES[name]);
}

export function readScanToolMetadata(name: ScanToolName): ManagedToolInstall | null {
  return readManagedToolMetadata(name);
}

export function scanToolVersion(name: ScanToolName, bin: string): string | null {
  return managedToolVersion(bin, VERSION_ARGS[name]);
}

export async function ensureScanTool(
  name: ScanToolName,
  opts: { installTools: boolean },
): Promise<string> {
  const existing = resolveScanToolBin(name);
  if (existing) return existing;
  if (!opts.installTools) throw new Error(`${name} is not installed`);
  return (await installScanTool(name)).bin;
}

export function runTool(
  bin: string,
  args: string[],
  opts: { cwd: string; input?: string; env?: typeof process.env } = { cwd: process.cwd() },
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(bin, args, {
    cwd: opts.cwd,
    input: opts.input,
    env: opts.env,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  // Distinguish "binary not found" (ENOENT after the resolution step
  // disappeared, e.g. metadata cache pointed at a deleted path) from a real
  // tool-internal failure. Returning status 127 (the conventional shell
  // exit code for "command not found") lets the caller route via the
  // tool-failure path rather than masquerading as a finding.
  const err = result.error as (Error & { code?: string }) | undefined;
  if (err && err.code === "ENOENT") {
    return {
      status: 127,
      stdout: "",
      stderr: `${bin}: not found (ENOENT). The tool was resolved at scan start but is no longer available.`,
    };
  }
  return {
    status: result.status ?? (err ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (err ? String(err) : ""),
  };
}

export function executableExists(bin: string | null): boolean {
  return Boolean(bin && fs.existsSync(bin));
}
