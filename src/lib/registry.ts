import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { VegaStackError } from "./errors.js";
import { safeExtractTar, assertSafeRelativePath } from "./safe-extract.js";
import { fetchTextWithCap, streamDownloadVerified } from "./fetch-with-timeout.js";
import { projectConfigPath, registryCacheRoot } from "./paths.js";
import { PACKS, registryEntryCachePath, type PackDefinition } from "./project.js";
import { log } from "./log.js";
import { verifyRegistryCatalogSignature } from "./registry-signature.js";
import { acquireRegistryInstallLock } from "./registry-install-lock.js";
import {
  projectConfigExists,
  projectRegistryEntryNames,
  readProjectConfig,
} from "./project-config.js";

export interface RegistryEntryStatus {
  name: string;
  title: string;
  shape: string;
  installed: boolean;
  selected: boolean;
  version?: string;
  cache_path: string;
  source: string;
}

export interface RegistryCatalog {
  schema_version: number;
  entries: Record<string, RegistryCatalogEntry>;
}

export interface RegistryCatalogEntry {
  id: string;
  title: string;
  shape: string;
  artifact_root: string;
  manifest: string;
  artifacts: string;
  description?: string;
  detects?: string[];
  archive?: string;
  archive_sha256?: string;
  archive_bytes?: number;
  manifest_sha256?: string;
  artifacts_sha256?: string;
  version?: string;
  pack_version?: string;
  source_ref?: string;
  source?: unknown;
}

interface ArtifactIndex {
  schema_version: number;
  files: { path: string; bytes: number; sha256: string }[];
}

const DEFAULT_REGISTRY_BASE_URL = "https://cli-registry.vegastack.com/cli";

export function ensureProjectInitialized(cwd: string): void {
  if (!projectConfigExists(cwd)) {
    throw new VegaStackError(
      "ValidationError",
      "VegaStack project harness not initialized in this directory.",
      { context: { cwd, expected: ".vegastack/vegastack.yml" } },
    );
  }
}

export function readProjectRegistryEntryNames(cwd: string): string[] {
  ensureProjectInitialized(cwd);
  return projectRegistryEntryNames(readProjectConfig(cwd));
}

export function registryEntryDefinition(name: string): PackDefinition | undefined {
  return PACKS.find((p) => p.name === name);
}

export function assertRegistryEntriesInstalled(entries: readonly string[]): void {
  for (const entry of entries) {
    const root = registryEntryCachePath(entry);
    if (!isRegistryEntryInstalled(entry, root) || !fs.existsSync(path.join(root, "docs"))) {
      throw new VegaStackError(
        "ValidationError",
        `Registry pack '${entry}' is not installed or does not contain docs`,
        { context: { entry, path: root } },
      );
    }
  }
}

export async function listPublishedPackDefinitions(): Promise<PackDefinition[]> {
  const catalog = await fetchRegistryCatalog();
  if (catalog.schema_version !== 1) {
    throw new VegaStackError(
      "RegistryVersionMismatch",
      `registry catalog schema ${catalog.schema_version} is not supported`,
      {
        context: { expected: 1, actual: catalog.schema_version },
      },
    );
  }
  return Object.values(catalog.entries)
    .map((entry) => ({
      name: entry.id,
      title: entry.title,
      shape: entry.shape,
      status: "available" as const,
      description: entry.description ?? entry.title,
      detects: entry.detects ?? [],
      source:
        sourceLabel(entry.source) ?? registryEntryDefinition(entry.id)?.source ?? registryBaseUrl(),
      ...((entry.pack_version ?? entry.version)
        ? { version: entry.pack_version ?? entry.version }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sourceLabel(source: unknown): string | undefined {
  if (typeof source === "string" && source.length > 0) return source;
  if (!source || typeof source !== "object") return undefined;
  const value = source as {
    type?: unknown;
    repo?: unknown;
    branch?: unknown;
    path?: unknown;
    paths?: unknown;
    sitemap_url?: unknown;
  };
  if (value.type === "github-archive" && typeof value.repo === "string") {
    const branch = typeof value.branch === "string" ? value.branch : "main";
    const paths = Array.isArray(value.paths)
      ? value.paths.filter((p): p is string => typeof p === "string")
      : [];
    if (paths.length === 1) return `https://github.com/${value.repo}/tree/${branch}/${paths[0]}`;
    return `https://github.com/${value.repo}/tree/${branch}`;
  }
  if (value.type === "local" && typeof value.path === "string") return value.path;
  if (value.type === "web-docs" && typeof value.sitemap_url === "string") return value.sitemap_url;
  return JSON.stringify(source);
}

export function listRegistryEntryStatuses(cwd = process.cwd()): RegistryEntryStatus[] {
  return listRegistryEntryStatusesForDefinitions(PACKS, cwd);
}

export async function listPublishedRegistryEntryStatuses(
  cwd = process.cwd(),
): Promise<RegistryEntryStatus[]> {
  const packs = await listPublishedPackDefinitions().catch(() => PACKS.slice());
  return listRegistryEntryStatusesForDefinitions(packs, cwd);
}

function listRegistryEntryStatusesForDefinitions(
  packs: readonly PackDefinition[],
  cwd = process.cwd(),
): RegistryEntryStatus[] {
  const selected = new Set<string>();
  if (fs.existsSync(projectConfigPath(cwd))) {
    try {
      for (const name of projectRegistryEntryNames(readProjectConfig(cwd))) {
        selected.add(name);
      }
    } catch {
      // Status should still be useful if the project config is partially written.
    }
  }
  const statuses = packs.map((p) => {
    const cachePath = registryEntryCachePath(p.name);
    const version = readRegistryEntryVersion(p.name, cachePath);
    return {
      name: p.name,
      title: p.title,
      shape: p.shape,
      installed: isRegistryEntryInstalled(p.name, cachePath),
      selected: selected.has(p.name),
      ...((version ?? p.version) ? { version: version ?? p.version } : {}),
      cache_path: cachePath,
      source: p.source,
    };
  });
  const known = new Set(statuses.map((s) => s.name));
  for (const name of installedRegistryEntryDirs()) {
    if (known.has(name)) continue;
    const cachePath = registryEntryCachePath(name);
    const manifest = readRegistryManifestSummary(cachePath);
    statuses.push({
      name,
      title: manifest.title ?? name,
      shape: manifest.shape ?? "registry-entry",
      installed: true,
      selected: selected.has(name),
      ...(manifest.version ? { version: manifest.version } : {}),
      cache_path: cachePath,
      source: manifest.source ?? "local registry cache",
    });
  }
  return statuses.sort((a, b) => a.name.localeCompare(b.name));
}

export function isRegistryEntryInstalled(
  name: string,
  cachePath = registryEntryCachePath(name),
): boolean {
  return fs.existsSync(path.join(cachePath, "MANIFEST.json"));
}

export async function syncRegistryEntry(
  name: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const def = registryEntryDefinition(name);
  const catalog = await fetchRegistryCatalog();
  if (catalog.schema_version !== 1) {
    throw new VegaStackError(
      "RegistryVersionMismatch",
      `registry catalog schema ${catalog.schema_version} is not supported`,
      {
        context: { expected: 1, actual: catalog.schema_version },
      },
    );
  }
  const entry = catalog.entries[name];
  if (!entry) {
    throw new VegaStackError("ValidationError", `Registry pack '${name}' is not published yet`, {
      context: { entry: name, source: def?.source ?? registryBaseUrl() },
    });
  }
  await installPublishedRegistryEntry(name, entry, opts);
}

export async function fetchPublishedRegistryCatalog(): Promise<RegistryCatalog> {
  return fetchRegistryCatalog();
}

async function installPublishedRegistryEntry(
  name: string,
  entry: RegistryCatalogEntry,
  opts: { force?: boolean },
): Promise<void> {
  const dest = registryEntryCachePath(name);
  const manifestPath = path.join(dest, "MANIFEST.json");
  if (!opts.force && entry.manifest_sha256 && fs.existsSync(manifestPath)) {
    const current = fileSha256(manifestPath);
    if (current === entry.manifest_sha256) {
      log.info(`Registry pack ${name} already installed at ${dest}`);
      return;
    }
  }

  // Serialize concurrent installs of the same entry across processes — see
  // rollup #82 F-006. Two parallel `vegastack init` runs would otherwise
  // race the rename block below and clobber each other's cache.
  const release = await acquireRegistryInstallLock(registryCacheRoot(), name);
  try {
    await doInstall(name, entry, dest);
  } finally {
    release();
  }
}

async function doInstall(
  name: string,
  entry: RegistryCatalogEntry,
  dest: string,
): Promise<void> {
  log.step(`downloading Registry pack ${name}`);
  if (!entry.archive || !entry.archive_sha256 || typeof entry.archive_bytes !== "number") {
    throw new VegaStackError(
      "ArtifactCorrupt",
      `Registry pack '${name}' does not publish an install archive`,
      {
        context: { entry: name },
      },
    );
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `vegastack-registry-${name}-`));
  const nextRoot = path.join(tmp, "next");
  const archivePath = path.join(tmp, "pack.tar.gz");
  fs.mkdirSync(nextRoot, { recursive: true });
  try {
    await downloadVerifiedFile(
      urlFor(entry.archive),
      archivePath,
      entry.archive_sha256,
      entry.archive_bytes,
    );
    extractVerifiedArchive(archivePath, nextRoot);
    const artifacts = readAndVerifyArtifactIndex(nextRoot, name, entry);
    verifyExtractedArtifacts(nextRoot, artifacts);

    const aside = `${dest}.old-${Date.now()}`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.renameSync(dest, aside);
    try {
      fs.renameSync(nextRoot, dest);
    } catch (e) {
      if (fs.existsSync(aside) && !fs.existsSync(dest)) fs.renameSync(aside, dest);
      throw e;
    }
    if (fs.existsSync(aside)) fs.rmSync(aside, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    log.ok(`installed Registry pack ${name} at ${dest}`);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

export function allInstalledRegistryEntryNames(): string[] {
  return [
    ...new Set([
      ...PACKS.filter((p) => isRegistryEntryInstalled(p.name)).map((p) => p.name),
      ...installedRegistryEntryDirs(),
    ]),
  ].sort();
}

export function readRegistryEntryVersion(_name: string, cachePath: string): string | undefined {
  const manifestJson = path.join(cachePath, "MANIFEST.json");
  for (const file of [manifestJson]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        version?: string;
        pack_version?: string;
        source_ref?: string;
        generated_at?: string;
      };
      if (raw.pack_version) return raw.pack_version;
      if (raw.version) return raw.version;
      if (raw.source_ref) return raw.source_ref;
      if (raw.generated_at) return raw.generated_at;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function installedRegistryEntryDirs(): string[] {
  try {
    return fs
      .readdirSync(registryCacheRoot(), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(registryCacheRoot(), entry.name, "MANIFEST.json")),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readRegistryManifestSummary(cachePath: string): {
  title?: string;
  shape?: string;
  version?: string;
  source?: string;
} {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cachePath, "MANIFEST.json"), "utf8")) as {
      title?: string;
      shape?: string;
      version?: string;
      pack_version?: string;
      source_ref?: string;
      generated_at?: string;
      source?: unknown;
    };
    const summary: { title?: string; shape?: string; version?: string; source?: string } = {
      ...(raw.title ? { title: raw.title } : {}),
      ...(raw.shape ? { shape: raw.shape } : {}),
      ...((raw.pack_version ?? raw.version ?? raw.source_ref ?? raw.generated_at)
        ? { version: raw.pack_version ?? raw.version ?? raw.source_ref ?? raw.generated_at }
        : {}),
    };
    const source = sourceLabel(raw.source);
    if (source) summary.source = source;
    return summary;
  } catch {
    return {};
  }
}

export function ensureRegistryCacheRoot(): string {
  const root = registryCacheRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function urlFor(relativePath: string): string {
  const cleaned = relativePath
    .replace(/^\/+/, "")
    .replace(/^registry\//, "")
    .replace(/^cli\//, "");
  return `${registryBaseUrl()}/${cleaned.split("/").map(encodeURIComponent).join("/")}`;
}

// Hosts permitted for catalog fetches. The allowlist exists so a hostile
// VEGASTACK_REGISTRY_URL (leaked CI secret, malicious devcontainer, attacker
// rc-file write) cannot redirect catalog traffic before sigstore verification
// runs on the response — see #72.
const REGISTRY_HOST_ALLOWLIST: ReadonlySet<string> = new Set(["cli-registry.vegastack.com"]);

export function resolveRegistryBaseUrl(): string {
  const raw = process.env.VEGASTACK_REGISTRY_URL;
  if (raw === undefined || raw === "") return DEFAULT_REGISTRY_BASE_URL;
  const devTrust = process.env.VEGASTACK_REGISTRY_DEV_TRUST === "1";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (e) {
    if (devTrust) {
      log.warn(`VEGASTACK_REGISTRY_DEV_TRUST=1: trusting unparseable URL ${raw}`);
      return raw.replace(/\/+$/, "");
    }
    throw new VegaStackError(
      "ValidationError",
      `VEGASTACK_REGISTRY_URL is not a valid URL: ${raw}`,
      { cause: e, context: { value: raw } },
    );
  }
  if (devTrust) {
    log.warn(
      `VEGASTACK_REGISTRY_DEV_TRUST=1: bypassing scheme/host allowlist for ${parsed.toString()}`,
    );
    return raw.replace(/\/+$/, "");
  }
  if (parsed.protocol !== "https:") {
    throw new VegaStackError(
      "ValidationError",
      `VEGASTACK_REGISTRY_URL must use https:// (got ${parsed.protocol}). Set VEGASTACK_REGISTRY_DEV_TRUST=1 for local development.`,
      { context: { value: raw } },
    );
  }
  if (!REGISTRY_HOST_ALLOWLIST.has(parsed.hostname)) {
    throw new VegaStackError(
      "ValidationError",
      `VEGASTACK_REGISTRY_URL host ${parsed.hostname} is not in the allowlist. Set VEGASTACK_REGISTRY_DEV_TRUST=1 to override.`,
      { context: { value: raw, host: parsed.hostname } },
    );
  }
  return raw.replace(/\/+$/, "");
}

function registryBaseUrl(): string {
  return resolveRegistryBaseUrl();
}

async function fetchRegistryCatalog(): Promise<RegistryCatalog> {
  const url = urlFor("REGISTRY.json");
  const text = await fetchText(url);
  const signatureText = await fetchText(urlFor("REGISTRY.json.sigstore"));
  await verifyRegistryCatalogSignature({
    catalogBytes: Buffer.from(text),
    signatureText: signatureText,
    catalogUrl: url,
  });
  try {
    return JSON.parse(text) as RegistryCatalog;
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", `invalid JSON from ${url}`, {
      cause: e,
      context: { url },
    });
  }
}

// Hard byte ceiling for catalog/signature fetches. Defends against a hostile
// mirror streaming a multi-GB body before signature/JSON parsing happens.
// 16 MiB easily fits the real catalog (a few hundred KB) plus headroom; the
// signature blob is well under 1 MiB but we share the same cap for simplicity.
const REGISTRY_FETCH_TEXT_CAP_BYTES = 16 * 1024 * 1024;

async function fetchText(url: string): Promise<string> {
  return await fetchTextWithCap(url, { maxBytes: REGISTRY_FETCH_TEXT_CAP_BYTES });
}

async function downloadVerifiedFile(
  url: string,
  target: string,
  expectedSha: string,
  expectedBytes: number,
): Promise<void> {
  await streamDownloadVerified(url, target, {
    expectedSha,
    expectedBytes,
    maxBytes: expectedBytes,
  });
}

function extractVerifiedArchive(archivePath: string, targetDir: string): void {
  // Delegate to the centralized safe extractor which rejects any
  // non-regular tar entry (symlinks/hardlinks/devices) and unsafe paths.
  safeExtractTar(archivePath, targetDir);
}

function readAndVerifyArtifactIndex(
  root: string,
  name: string,
  entry: RegistryCatalogEntry,
): ArtifactIndex {
  const artifactPath = path.join(root, "ARTIFACTS.json");
  let artifactsRaw: string;
  try {
    artifactsRaw = fs.readFileSync(artifactPath, "utf8");
  } catch (e) {
    throw new VegaStackError(
      "ArtifactCorrupt",
      `registry archive for ${name} did not contain ARTIFACTS.json`,
      { cause: e },
    );
  }
  if (entry.artifacts_sha256) {
    const actual = sha256(Buffer.from(artifactsRaw));
    if (actual !== entry.artifacts_sha256) {
      throw new VegaStackError("ChecksumMismatch", `artifact index checksum mismatch for ${name}`, {
        context: { expected: entry.artifacts_sha256, actual },
      });
    }
  }
  let artifacts: ArtifactIndex;
  try {
    artifacts = JSON.parse(artifactsRaw) as ArtifactIndex;
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", `invalid artifact index for ${name}`, { cause: e });
  }
  if (artifacts.schema_version !== 1) {
    throw new VegaStackError(
      "RegistryVersionMismatch",
      `artifact index schema ${artifacts.schema_version} is not supported`,
      {
        context: { expected: 1, actual: artifacts.schema_version },
      },
    );
  }
  return artifacts;
}

function verifyExtractedArtifacts(root: string, artifacts: ArtifactIndex): void {
  for (const file of artifacts.files) {
    assertSafeRelativePath(file.path);
    const target = path.join(root, file.path);
    if (!fs.existsSync(target)) {
      throw new VegaStackError("ArtifactCorrupt", `registry archive missing ${file.path}`, {
        context: { path: file.path },
      });
    }
    const bytes = fs.statSync(target).size;
    const actualSha = fileSha256(target);
    if (bytes !== file.bytes || actualSha !== file.sha256) {
      throw new VegaStackError(
        "ChecksumMismatch",
        `registry artifact checksum mismatch for ${file.path}`,
        {
          context: {
            path: file.path,
            expected: file.sha256,
            actual: actualSha,
            expected_bytes: file.bytes,
            actual_bytes: bytes,
          },
        },
      );
    }
  }
}

function fileSha256(file: string): string {
  return sha256(fs.readFileSync(file));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
