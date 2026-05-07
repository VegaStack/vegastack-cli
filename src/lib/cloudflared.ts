import { spawnSync } from "node:child_process";
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
import { cloudflaredMetadataPath, cloudflaredToolDir } from "./paths.js";

const CLOUDFLARED = MANAGED_TOOLS_MANIFEST.tools.cloudflared;
const CLOUDFLARED_VERSION = CLOUDFLARED.version;
const CLOUDFLARED_REPO = CLOUDFLARED.repo;
const RELEASE_BASE = `https://github.com/${CLOUDFLARED_REPO}/releases/download/${CLOUDFLARED_VERSION}`;
type Target = ManagedToolTarget;

export interface CloudflaredInstall {
  version: string;
  bin: string;
  asset: string;
  asset_sha256: string;
  bin_sha256: string;
  /** @deprecated use asset_sha256 or bin_sha256 */
  sha256: string;
  installed_at: string;
  source: string;
}

export async function installCloudflared(
  opts: { force?: boolean } = {},
): Promise<CloudflaredInstall> {
  const target = currentTarget();
  const destDir = cloudflaredToolDir(CLOUDFLARED_VERSION);
  const binPath = path.join(destDir, target.binName);
  if (!opts.force && fs.existsSync(binPath)) {
    const existing = readCloudflaredMetadata();
    if (
      existing?.version === CLOUDFLARED_VERSION &&
      existing.asset === target.asset &&
      existing.bin === binPath &&
      existing.asset_sha256 === target.sha256 &&
      existing.bin_sha256 === fileSha256(binPath)
    ) {
      return existing;
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-cloudflared-"));
  const assetPath = path.join(tmp, target.asset);
  try {
    await downloadVerified(`${RELEASE_BASE}/${target.asset}`, assetPath, target.sha256);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    if (target.archive === "tgz") {
      const extractDir = path.join(tmp, "extract");
      fs.mkdirSync(extractDir, { recursive: true });
      extractTar(assetPath, extractDir);
      fs.copyFileSync(findExtractedBinary(extractDir, "cloudflared"), binPath);
    } else {
      fs.copyFileSync(assetPath, binPath);
    }
    if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
    return writeMetadata(metadataFor(target, binPath));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function metadataFor(target: Target, binPath: string): CloudflaredInstall {
  return {
    version: CLOUDFLARED_VERSION,
    bin: binPath,
    asset: target.asset,
    asset_sha256: target.sha256,
    bin_sha256: fileSha256(binPath),
    sha256: target.sha256,
    installed_at: new Date().toISOString(),
    source: `${RELEASE_BASE}/${target.asset}`,
  };
}

export function resolveCloudflaredBin(): string | null {
  const override = process.env.VEGASTACK_CLOUDFLARED_BIN;
  if (override && fs.existsSync(override)) return override;
  const metadata = readCloudflaredMetadata();
  const target = managedToolTarget("cloudflared");
  if (
    metadata &&
    target &&
    fs.existsSync(metadata.bin) &&
    metadata.version === CLOUDFLARED_VERSION &&
    metadata.asset === target.asset &&
    metadata.asset_sha256 === target.sha256 &&
    metadata.bin_sha256 === fileSha256(metadata.bin)
  )
    return metadata.bin;
  return findOnPath(process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
}

export function readCloudflaredMetadata(): CloudflaredInstall | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(cloudflaredMetadataPath(), "utf8"),
    ) as CloudflaredInstall;
    if (typeof raw.bin === "string" && typeof raw.version === "string") return raw;
    return null;
  } catch {
    return null;
  }
}

export function cloudflaredVersion(bin: string): string | null {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return `${r.stdout}${r.stderr}`.split(/\r?\n/)[0]?.trim() ?? null;
}

export function quickTunnelNotice(): string {
  return "Cloudflare Quick Tunnels are temporary development previews, not production hosting. They use trycloudflare.com, have no SLA, and may have traffic/protocol limits.";
}

function currentTarget(): Target {
  const target = managedToolTarget("cloudflared");
  if (!target) {
    throw new VegaStackError(
      "Unsupported",
      `unsupported platform for managed cloudflared: ${process.platform}/${process.arch}`,
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

function extractTar(archivePath: string, targetDir: string): void {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", targetDir], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error ?? (result.status ?? 0) !== 0) {
    throw new VegaStackError("ArtifactCorrupt", "failed to extract cloudflared archive", {
      cause: result.error,
      context: {
        stderr: result.stderr,
        stdout: result.stdout,
      },
    });
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
  throw new VegaStackError("ArtifactCorrupt", `cloudflared archive did not contain ${binName}`);
}

function writeMetadata(value: CloudflaredInstall): CloudflaredInstall {
  fs.mkdirSync(path.dirname(cloudflaredMetadataPath()), { recursive: true });
  fs.writeFileSync(cloudflaredMetadataPath(), `${JSON.stringify(value, null, 2)}\n`);
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
