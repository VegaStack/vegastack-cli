import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface TargetSpec {
  platform: string;
  arch: string;
  asset: (version: string) => string;
  archive: "binary" | "tar.gz" | "tgz" | "zip";
  binName: string;
}

interface ToolSpec {
  name: "cloudflared" | "gitleaks" | "ripgrep";
  repo: string;
  targets: TargetSpec[];
  checksumFile?: (version: string) => string;
  versionForAsset?: (tag: string) => string;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  created_at?: string;
  assets?: {
    name?: string;
    browser_download_url?: string;
    digest?: string;
  }[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "lib", "managed-tools-manifest.ts");

const SPECS: ToolSpec[] = [
  {
    name: "cloudflared",
    repo: "cloudflare/cloudflared",
    targets: [
      target("darwin", "arm64", "cloudflared-darwin-arm64.tgz", "tgz", "cloudflared"),
      target("darwin", "x64", "cloudflared-darwin-amd64.tgz", "tgz", "cloudflared"),
      target("linux", "x64", "cloudflared-linux-amd64", "binary", "cloudflared"),
      target("linux", "arm64", "cloudflared-linux-arm64", "binary", "cloudflared"),
      target("linux", "ia32", "cloudflared-linux-386", "binary", "cloudflared"),
      target("linux", "arm", "cloudflared-linux-arm", "binary", "cloudflared"),
      target("win32", "x64", "cloudflared-windows-amd64.exe", "binary", "cloudflared.exe"),
      target("win32", "ia32", "cloudflared-windows-386.exe", "binary", "cloudflared.exe"),
    ],
  },
  {
    name: "gitleaks",
    repo: "gitleaks/gitleaks",
    versionForAsset: (tag) => tag.replace(/^v/, ""),
    checksumFile: (version) => `gitleaks_${version}_checksums.txt`,
    targets: [
      target("darwin", "arm64", "gitleaks_{version}_darwin_arm64.tar.gz", "tar.gz", "gitleaks"),
      target("darwin", "x64", "gitleaks_{version}_darwin_x64.tar.gz", "tar.gz", "gitleaks"),
      target("linux", "arm64", "gitleaks_{version}_linux_arm64.tar.gz", "tar.gz", "gitleaks"),
      target("linux", "x64", "gitleaks_{version}_linux_x64.tar.gz", "tar.gz", "gitleaks"),
      target("linux", "ia32", "gitleaks_{version}_linux_x32.tar.gz", "tar.gz", "gitleaks"),
      target("linux", "arm", "gitleaks_{version}_linux_armv7.tar.gz", "tar.gz", "gitleaks"),
      target("win32", "arm64", "gitleaks_{version}_windows_arm64.zip", "zip", "gitleaks.exe"),
      target("win32", "x64", "gitleaks_{version}_windows_x64.zip", "zip", "gitleaks.exe"),
      target("win32", "ia32", "gitleaks_{version}_windows_x32.zip", "zip", "gitleaks.exe"),
    ],
  },
  {
    name: "ripgrep",
    repo: "BurntSushi/ripgrep",
    checksumFile: (_version) => "{asset}.sha256",
    targets: [
      target("darwin", "arm64", "ripgrep-{version}-aarch64-apple-darwin.tar.gz", "tar.gz", "rg"),
      target("darwin", "x64", "ripgrep-{version}-x86_64-apple-darwin.tar.gz", "tar.gz", "rg"),
      target(
        "linux",
        "arm64",
        "ripgrep-{version}-aarch64-unknown-linux-gnu.tar.gz",
        "tar.gz",
        "rg",
      ),
      target("linux", "x64", "ripgrep-{version}-x86_64-unknown-linux-musl.tar.gz", "tar.gz", "rg"),
      target("linux", "ia32", "ripgrep-{version}-i686-unknown-linux-gnu.tar.gz", "tar.gz", "rg"),
      target(
        "linux",
        "arm",
        "ripgrep-{version}-armv7-unknown-linux-gnueabihf.tar.gz",
        "tar.gz",
        "rg",
      ),
      target("linux", "s390x", "ripgrep-{version}-s390x-unknown-linux-gnu.tar.gz", "tar.gz", "rg"),
      target("win32", "arm64", "ripgrep-{version}-aarch64-pc-windows-msvc.zip", "zip", "rg.exe"),
      target("win32", "x64", "ripgrep-{version}-x86_64-pc-windows-msvc.zip", "zip", "rg.exe"),
      target("win32", "ia32", "ripgrep-{version}-i686-pc-windows-msvc.zip", "zip", "rg.exe"),
    ],
  },
];

function target(
  platform: string,
  arch: string,
  assetTemplate: string,
  archive: TargetSpec["archive"],
  binName: string,
): TargetSpec {
  return {
    platform,
    arch,
    archive,
    binName,
    asset: (version) => assetTemplate.replaceAll("{version}", version),
  };
}

async function main(): Promise<void> {
  const tools: Record<string, unknown> = {};
  for (const spec of SPECS) {
    tools[spec.name] = await buildTool(spec);
  }
  const manifest = {
    schema_version: 1,
    generated_at: Object.values(tools)
      .map((tool) => (tool as { generated_at: string }).generated_at)
      .sort()
      .at(-1),
    tools,
  };
  fs.writeFileSync(OUT, render(manifest), "utf8");
  process.stdout.write(`updated ${path.relative(ROOT, OUT)}\n`);
}

async function buildTool(spec: ToolSpec): Promise<Record<string, unknown>> {
  const release = await fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${spec.repo}/releases/latest`,
  );
  const tag = release.tag_name;
  if (!tag) throw new Error(`${spec.repo} latest release has no tag_name`);
  const version = spec.versionForAsset ? spec.versionForAsset(tag) : tag;
  const generatedAt = release.published_at ?? release.created_at ?? tag;
  const assets = release.assets ?? [];
  const checksumText =
    spec.checksumFile && !spec.checksumFile(version).includes("{asset}")
      ? await fetchAssetText(assets, spec.checksumFile(version))
      : null;

  return {
    name: spec.name,
    repo: spec.repo,
    version: tag,
    source: release.html_url ?? `https://github.com/${spec.repo}/releases/tag/${tag}`,
    generated_at: generatedAt,
    targets: await Promise.all(
      spec.targets.map(async (target) => {
        const asset = target.asset(version);
        const sha256 = await resolveSha(spec, assets, asset, checksumText, version);
        return {
          platform: target.platform,
          arch: target.arch,
          asset,
          archive: target.archive,
          binName: target.binName,
          sha256,
        };
      }),
    ),
  };
}

async function resolveSha(
  spec: ToolSpec,
  assets: NonNullable<GitHubRelease["assets"]>,
  asset: string,
  checksumText: string | null,
  version: string,
): Promise<string> {
  const ghAsset = assets.find((candidate) => candidate.name === asset);
  if (!ghAsset) throw new Error(`${spec.repo} release ${version} missing ${asset}`);
  if (ghAsset.digest?.startsWith("sha256:")) return ghAsset.digest.slice("sha256:".length);
  if (checksumText) return parseChecksum(checksumText, asset);
  if (spec.checksumFile) {
    return parseChecksum(
      await fetchAssetText(assets, spec.checksumFile(version).replace("{asset}", asset)),
      asset,
    );
  }
  throw new Error(`${spec.repo} ${asset} has no digest/checksum source`);
}

function parseChecksum(text: string, asset: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(asset)) continue;
    const match = line.match(/[a-f0-9]{64}/i);
    if (match) return match[0].toLowerCase();
  }
  throw new Error(`checksum not found for ${asset}`);
}

async function fetchAssetText(
  assets: NonNullable<GitHubRelease["assets"]>,
  name: string,
): Promise<string> {
  const asset = assets.find((candidate) => candidate.name === name);
  if (!asset?.browser_download_url) throw new Error(`release asset not found: ${name}`);
  return await fetchText(asset.browser_download_url);
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "vegastack-cli-managed-tools-updater" },
  });
  if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  return await response.text();
}

function render(manifest: unknown): string {
  const json = JSON.stringify(manifest, null, 2);
  return `// Generated by scripts/update-managed-tools-manifest.ts.
// Do not edit checksums by hand.

export interface ManagedToolTarget {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  asset: string;
  archive: "binary" | "tar.gz" | "tgz" | "zip";
  binName: string;
  sha256: string;
}

export interface ManagedToolManifestEntry {
  name: "cloudflared" | "gitleaks" | "ripgrep";
  repo: string;
  version: string;
  source: string;
  generated_at: string;
  targets: ManagedToolTarget[];
}

export interface ManagedToolsManifest {
  schema_version: 1;
  generated_at: string;
  tools: {
    cloudflared: ManagedToolManifestEntry;
    gitleaks: ManagedToolManifestEntry;
    ripgrep: ManagedToolManifestEntry;
  };
}

export const MANAGED_TOOLS_MANIFEST: ManagedToolsManifest = ${json};

export function managedToolTarget(
  tool: keyof ManagedToolsManifest["tools"],
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): ManagedToolTarget | null {
  return (
    MANAGED_TOOLS_MANIFEST.tools[tool].targets.find(
      (target) => target.platform === platform && target.arch === arch,
    ) ?? null
  );
}
`;
}

await main();
