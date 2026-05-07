import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VegaStackError } from "./errors.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";
import {
  MANAGED_TOOLS_MANIFEST,
  managedToolTarget,
  type ManagedToolTarget,
} from "./managed-tools-manifest.js";
import { ripgrepMetadataPath, ripgrepToolDir } from "./paths.js";

const RIPGREP = MANAGED_TOOLS_MANIFEST.tools.ripgrep;
const RIPGREP_VERSION = RIPGREP.version;
const RIPGREP_REPO = RIPGREP.repo;
const RELEASE_BASE = `https://github.com/${RIPGREP_REPO}/releases/download/${RIPGREP_VERSION}`;

type Target = ManagedToolTarget;

export interface RipgrepInstall {
  version: string;
  bin: string;
  asset: string;
  asset_sha256: string;
  bin_sha256: string;
  /** @deprecated use asset_sha256 or bin_sha256 */
  sha256: string;
  installed_at: string;
}

export async function installRipgrep(opts: { force?: boolean } = {}): Promise<RipgrepInstall> {
  const target = currentTarget();
  const asset = target.asset;
  const destDir = ripgrepToolDir(RIPGREP_VERSION);
  const binPath = path.join(destDir, target.binName);
  if (!opts.force && fs.existsSync(binPath)) {
    const existing = readRipgrepMetadata();
    if (
      existing?.version === RIPGREP_VERSION &&
      existing.asset === asset &&
      existing.bin === binPath &&
      existing.asset_sha256 === target.sha256 &&
      existing.bin_sha256 === fileSha256(binPath)
    ) {
      return existing;
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-ripgrep-"));
  const archivePath = path.join(tmp, asset);
  const extractDir = path.join(tmp, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    await downloadVerified(`${RELEASE_BASE}/${asset}`, archivePath, target.sha256);
    if (target.archive !== "tar.gz" && target.archive !== "zip") {
      throw new VegaStackError("ArtifactCorrupt", `unsupported ripgrep archive ${target.archive}`);
    }
    extractArchive(archivePath, extractDir, target.archive);
    const extracted = findExtractedBinary(extractDir, target.binName);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(extracted, binPath);
    if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
    return writeMetadata(metadataFor(target, binPath));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function metadataFor(target: Target, binPath: string): RipgrepInstall {
  return {
    version: RIPGREP_VERSION,
    bin: binPath,
    asset: target.asset,
    asset_sha256: target.sha256,
    bin_sha256: fileSha256(binPath),
    sha256: target.sha256,
    installed_at: new Date().toISOString(),
  };
}

export function resolveRipgrepBin(): string | null {
  const override = process.env.VEGASTACK_RG_BIN;
  if (override && fs.existsSync(override)) return override;
  const metadata = readRipgrepMetadata();
  const target = managedToolTarget("ripgrep");
  if (
    metadata &&
    target &&
    fs.existsSync(metadata.bin) &&
    metadata.version === RIPGREP_VERSION &&
    metadata.asset === target.asset &&
    metadata.asset_sha256 === target.sha256 &&
    metadata.bin_sha256 === fileSha256(metadata.bin)
  )
    return metadata.bin;
  if (process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS === "1") {
    return findOnPath(process.platform === "win32" ? "rg.exe" : "rg");
  }
  return null;
}

export function readRipgrepMetadata(): RipgrepInstall | null {
  try {
    const raw = JSON.parse(fs.readFileSync(ripgrepMetadataPath(), "utf8")) as RipgrepInstall;
    if (typeof raw.bin === "string" && typeof raw.version === "string") return raw;
    return null;
  } catch {
    return null;
  }
}

export function ripgrepVersion(bin: string): string | null {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/)[0]?.trim() ?? null;
}

export function supportedRipgrepTarget(): string {
  return `${process.platform}/${process.arch}`;
}

function currentTarget(): Target {
  const target = managedToolTarget("ripgrep");
  if (!target) {
    throw new VegaStackError(
      "Unsupported",
      `unsupported platform for managed ripgrep: ${process.platform}/${process.arch}`,
    );
  }
  return target;
}

async function downloadVerified(url: string, target: string, expectedSha: string): Promise<void> {
  const response = await fetchWithTimeout(url, {
    redirect: "follow",
    headers: { "User-Agent": "vegastack-cli" },
  });
  if (!response.ok) {
    throw new VegaStackError("NetworkError", `failed to fetch ${url}: HTTP ${response.status}`, {
      context: { url, status: response.status },
    });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expectedSha) {
    throw new VegaStackError("ChecksumMismatch", `checksum mismatch for ${url}`, {
      context: { expected: expectedSha, actual },
    });
  }
  fs.writeFileSync(target, bytes);
}

function extractArchive(archivePath: string, targetDir: string, kind: "tar.gz" | "zip"): void {
  try {
    if (kind === "tar.gz") {
      execFileSync("tar", ["-xzf", archivePath, "-C", targetDir], { stdio: "pipe" });
      return;
    }
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(targetDir)} -Force`,
        ],
        { stdio: "pipe" },
      );
      return;
    }
    execFileSync("unzip", ["-q", archivePath, "-d", targetDir], { stdio: "pipe" });
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", "failed to extract ripgrep archive", { cause: e });
  }
}

function findExtractedBinary(root: string, binName: string): string {
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name === binName) return full;
    }
  }
  throw new VegaStackError("ArtifactCorrupt", `ripgrep archive did not contain ${binName}`);
}

function writeMetadata(value: RipgrepInstall): RipgrepInstall {
  fs.mkdirSync(path.dirname(ripgrepMetadataPath()), { recursive: true });
  fs.writeFileSync(ripgrepMetadataPath(), `${JSON.stringify(value, null, 2)}\n`);
  return value;
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

function fileSha256(file: string): string {
  return sha256(fs.readFileSync(file));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
