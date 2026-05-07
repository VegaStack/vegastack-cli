import { spawnSync } from "node:child_process";
import { safeExtractTar, safeExtractZip } from "./safe-extract.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VegaStackError } from "./errors.js";
import {
  MANAGED_TOOLS_MANIFEST,
  managedToolTarget,
  type ManagedToolTarget,
} from "./managed-tools-manifest.js";
import { gitleaksMetadataPath, gitleaksToolDir } from "./paths.js";

const GITLEAKS = MANAGED_TOOLS_MANIFEST.tools.gitleaks;
const GITLEAKS_REPO = GITLEAKS.repo;
const GITLEAKS_VERSION = GITLEAKS.version;
const RELEASE_BASE = `https://github.com/${GITLEAKS_REPO}/releases/download/${GITLEAKS_VERSION}`;

export interface GitleaksInstall {
  version: string;
  bin: string;
  asset: string;
  asset_sha256: string;
  bin_sha256: string;
  /** @deprecated use asset_sha256 or bin_sha256 */
  sha256: string;
  installed_at: string;
}

type Target = ManagedToolTarget;

export async function installGitleaks(opts: { force?: boolean } = {}): Promise<GitleaksInstall> {
  const target = currentTarget();
  const assetName = target.asset;

  const destDir = gitleaksToolDir(GITLEAKS_VERSION);
  const binPath = path.join(destDir, target.binName);
  if (!opts.force && fs.existsSync(binPath)) {
    const existing = readGitleaksMetadata();
    if (
      existing?.version === GITLEAKS_VERSION &&
      existing.asset === assetName &&
      existing.bin === binPath &&
      existing.asset_sha256 === target.sha256 &&
      existing.bin_sha256 === fileSha256(binPath)
    ) {
      return existing;
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-gitleaks-"));
  const archivePath = path.join(tmp, assetName);
  const extractDir = path.join(tmp, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    await downloadVerified(`${RELEASE_BASE}/${assetName}`, archivePath, target.sha256);
    if (target.archive !== "tar.gz" && target.archive !== "zip") {
      throw new VegaStackError("ArtifactCorrupt", `unsupported Gitleaks archive ${target.archive}`);
    }
    await extractArchive(archivePath, extractDir, target.archive);
    const extracted = findExtractedBinary(extractDir, target.binName);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(extracted, binPath);
    if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
    const installed = writeAndReturnMetadata(metadataFor(target, binPath));
    return installed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function metadataFor(target: Target, binPath: string): GitleaksInstall {
  return {
    version: GITLEAKS_VERSION,
    bin: binPath,
    asset: target.asset,
    asset_sha256: target.sha256,
    bin_sha256: fileSha256(binPath),
    sha256: target.sha256,
    installed_at: new Date().toISOString(),
  };
}

export function resolveGitleaksBin(): string | null {
  const override = process.env.VEGASTACK_GITLEAKS_BIN;
  if (override && fs.existsSync(override)) return override;
  const metadata = readGitleaksMetadata();
  const target = managedToolTarget("gitleaks");
  if (
    metadata &&
    target &&
    fs.existsSync(metadata.bin) &&
    metadata.version === GITLEAKS_VERSION &&
    metadata.asset === target.asset &&
    metadata.asset_sha256 === target.sha256 &&
    metadata.bin_sha256 === fileSha256(metadata.bin)
  )
    return metadata.bin;
  // Managed install absent / stale / corrupted. Refuse silent PATH fallback
  // unless the operator has explicitly opted in — an attacker who can drop
  // a same-named binary onto PATH would otherwise execute arbitrary code.
  if (process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS === "1") {
    return findOnPath(process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  }
  return null;
}

export function readGitleaksMetadata(): GitleaksInstall | null {
  try {
    const raw = JSON.parse(fs.readFileSync(gitleaksMetadataPath(), "utf8")) as GitleaksInstall;
    if (typeof raw.bin === "string" && typeof raw.version === "string") return raw;
    return null;
  } catch {
    return null;
  }
}

export function gitleaksVersion(bin: string): string | null {
  const r = spawnSync(bin, ["version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return `${r.stdout}${r.stderr}`.trim() || null;
}

function currentTarget(): Target {
  const target = managedToolTarget("gitleaks");
  if (!target) {
    throw new VegaStackError(
      "Unsupported",
      `unsupported platform for Gitleaks: ${process.platform}/${process.arch}`,
    );
  }
  return target;
}

async function downloadVerified(url: string, target: string, expectedSha: string): Promise<void> {
  const response = await fetch(url, {
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

async function extractArchive(
  archivePath: string,
  targetDir: string,
  kind: "tar.gz" | "zip",
): Promise<void> {
  if (kind === "tar.gz") {
    safeExtractTar(archivePath, targetDir);
    return;
  }
  await safeExtractZip(archivePath, targetDir);
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
  throw new VegaStackError("ArtifactCorrupt", `Gitleaks archive did not contain ${binName}`);
}

function writeAndReturnMetadata(metadata: GitleaksInstall): GitleaksInstall {
  fs.mkdirSync(path.dirname(gitleaksMetadataPath()), { recursive: true });
  fs.writeFileSync(gitleaksMetadataPath(), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

function findOnPath(bin: string): string | null {
  const parts = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const part of parts) {
    const candidate = path.join(part, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function fileSha256(file: string): string {
  return sha256(fs.readFileSync(file));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
