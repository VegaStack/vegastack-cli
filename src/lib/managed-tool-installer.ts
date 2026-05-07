import { spawnSync } from "node:child_process";
import { safeExtractTar, safeExtractZip } from "./safe-extract.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VegaStackError } from "./errors.js";
import { streamDownloadVerified } from "./fetch-with-timeout.js";
import {
  MANAGED_TOOLS_MANIFEST,
  managedToolTarget,
  type ManagedToolTarget,
} from "./managed-tools-manifest.js";
import { managedToolDir, managedToolMetadataPath } from "./paths.js";

export type ManagedToolName = keyof typeof MANAGED_TOOLS_MANIFEST.tools;

export interface ManagedToolInstall {
  name: ManagedToolName;
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

export async function installManagedTool(
  name: ManagedToolName,
  opts: { force?: boolean } = {},
): Promise<ManagedToolInstall> {
  const tool = MANAGED_TOOLS_MANIFEST.tools[name];
  const target = currentTarget(name);
  const destDir = managedToolDir(name, tool.version);
  const binPath = path.join(destDir, target.binName);

  if (!opts.force && fs.existsSync(binPath)) {
    const existing = readManagedToolMetadata(name);
    if (
      existing?.version === tool.version &&
      existing.asset === target.asset &&
      existing.bin === binPath &&
      existing.asset_sha256 === target.sha256 &&
      existing.bin_sha256 === fileSha256(binPath)
    ) {
      return existing;
    }
    if (target.archive === "binary" && fileSha256(binPath) === target.sha256) {
      return writeManagedToolMetadata(name, metadataFor(name, target, binPath));
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `vegastack-${name}-`));
  const assetPath = path.join(tmp, target.asset);
  const extractDir = path.join(tmp, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    await downloadVerified(releaseAssetUrl(name, target), assetPath, target.sha256);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    if (target.archive === "binary") {
      fs.copyFileSync(assetPath, binPath);
    } else {
      await extractArchive(assetPath, extractDir, target.archive);
      fs.copyFileSync(findExtractedBinary(extractDir, target.binName), binPath);
    }
    if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
    return writeManagedToolMetadata(name, metadataFor(name, target, binPath));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function metadataFor(
  name: ManagedToolName,
  target: ManagedToolTarget,
  binPath: string,
): ManagedToolInstall {
  const tool = MANAGED_TOOLS_MANIFEST.tools[name];
  return {
    name,
    version: tool.version,
    bin: binPath,
    asset: target.asset,
    asset_sha256: target.sha256,
    bin_sha256: fileSha256(binPath),
    sha256: target.sha256,
    installed_at: new Date().toISOString(),
    source: releaseAssetUrl(name, target),
  };
}

export function resolveManagedToolBin(
  name: ManagedToolName,
  envVar: string,
  fallbackBin: string,
): string | null {
  const override = process.env[envVar];
  if (override && fs.existsSync(override)) return override;
  const metadata = readManagedToolMetadata(name);
  const target = managedToolTarget(name);
  if (
    metadata &&
    target &&
    fs.existsSync(metadata.bin) &&
    metadata.version === MANAGED_TOOLS_MANIFEST.tools[name].version &&
    metadata.asset === target.asset &&
    metadata.asset_sha256 === target.sha256 &&
    metadata.bin_sha256 === fileSha256(metadata.bin)
  )
    return metadata.bin;
  return findOnPath(fallbackBin);
}

export function readManagedToolMetadata(name: ManagedToolName): ManagedToolInstall | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(managedToolMetadataPath(name), "utf8"),
    ) as ManagedToolInstall;
    if (raw.name === name && typeof raw.bin === "string" && typeof raw.version === "string")
      return raw;
    return null;
  } catch {
    return null;
  }
}

export function managedToolVersion(bin: string, args: string[] = ["--version"]): string | null {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return `${r.stdout}${r.stderr}`.split(/\r?\n/)[0]?.trim() ?? null;
}

function currentTarget(name: ManagedToolName): ManagedToolTarget {
  const target = managedToolTarget(name);
  if (!target) {
    throw new VegaStackError(
      "Unsupported",
      `unsupported platform for managed ${name}: ${process.platform}/${process.arch}`,
    );
  }
  return target;
}

function releaseAssetUrl(name: ManagedToolName, target: ManagedToolTarget): string {
  const tool = MANAGED_TOOLS_MANIFEST.tools[name];
  return `https://github.com/${tool.repo}/releases/download/${tool.version}/${target.asset}`;
}

/** Hard ceiling on a managed-tool archive (200 MiB) — bounds memory if a
 *  mirror serves an unbounded body before sha verification. */
const MAX_MANAGED_TOOL_BYTES = 200 * 1024 * 1024;

async function downloadVerified(url: string, target: string, expectedSha: string): Promise<void> {
  await streamDownloadVerified(url, target, {
    expectedSha,
    maxBytes: MAX_MANAGED_TOOL_BYTES,
    headers: { "User-Agent": "vegastack-cli" },
  });
}

async function extractArchive(
  archivePath: string,
  targetDir: string,
  kind: "tar.gz" | "tgz" | "zip",
): Promise<void> {
  if (kind === "tar.gz" || kind === "tgz") {
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
  throw new VegaStackError("ArtifactCorrupt", `archive did not contain ${binName}`);
}

function writeManagedToolMetadata(
  name: ManagedToolName,
  value: ManagedToolInstall,
): ManagedToolInstall {
  fs.mkdirSync(path.dirname(managedToolMetadataPath(name)), { recursive: true });
  fs.writeFileSync(managedToolMetadataPath(name), `${JSON.stringify(value, null, 2)}\n`);
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
