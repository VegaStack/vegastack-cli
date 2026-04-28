// Per-provider MANIFEST.json reader with mtime-based caching. Also loads
// the bundle root MANIFEST.json (for the canonical provider list and the
// CalVer bundle_version). Closes F20.

import * as fs from "node:fs";
import * as path from "node:path";
import { VegastackError } from "../errors.js";
import type { BundleRootManifest, ProviderManifest } from "./types.js";

interface CacheEntry {
  mtimeMs: number;
  manifest: ProviderManifest;
}

const CACHE = new Map<string, CacheEntry>();
const ROOT_CACHE = new Map<string, { mtimeMs: number; manifest: BundleRootManifest }>();

/** Load and parse a provider's MANIFEST.json (cached by mtime). */
export function loadManifest(providerDir: string): ProviderManifest {
  const manifestPath = path.join(providerDir, "MANIFEST.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(manifestPath);
  } catch {
    throw new VegastackError("BundleCorrupt", `provider manifest missing: ${manifestPath}`, {
      context: { providerDir, manifestPath },
    });
  }

  const cached = CACHE.get(manifestPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.manifest;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new VegastackError(
      "BundleCorrupt",
      `provider manifest is not valid JSON: ${manifestPath}`,
      {
        cause: e,
        context: { providerDir, manifestPath },
      },
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new VegastackError(
      "BundleCorrupt",
      `provider manifest is not a JSON object: ${manifestPath}`,
    );
  }

  const manifest = raw as ProviderManifest;
  CACHE.set(manifestPath, { mtimeMs: stat.mtimeMs, manifest });
  return manifest;
}

/** Load the bundle root MANIFEST.json (cached by mtime). Returns an empty
 *  shell when the file is absent so callers can degrade gracefully. */
export function loadBundleRootManifest(bundleRoot: string): BundleRootManifest {
  const manifestPath = path.join(bundleRoot, "MANIFEST.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(manifestPath);
  } catch {
    return {};
  }
  const cached = ROOT_CACHE.get(manifestPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.manifest;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const manifest = raw as BundleRootManifest;
  ROOT_CACHE.set(manifestPath, { mtimeMs: stat.mtimeMs, manifest });
  return manifest;
}

/** Resolve the canonical provider list from the bundle root MANIFEST.json.
 *  Closes F20 — the CLI no longer hard-codes 31 providers. */
export function resolveCanonicalProviders(bundleRoot: string): string[] {
  const root = loadBundleRootManifest(bundleRoot);
  if (Array.isArray(root.providers)) return [...root.providers];
  if (root.providers !== undefined && typeof root.providers === "object") {
    return Object.keys(root.providers).sort();
  }
  return [];
}

/** Reset all module-level caches. Used in tests. */
export function clearManifestCache(): void {
  CACHE.clear();
  ROOT_CACHE.clear();
}

/** Resolve the on-disk directory for a provider inside a bundle root. */
export function providerDir(bundleRoot: string, provider: string): string {
  return path.join(bundleRoot, provider);
}

/** Distinctive-token vocabulary for one provider. Prefers the explicit
 *  `distinctive_tokens` field on the manifest when present; otherwise
 *  derives a sensible fallback from primary_resources + service_aliases +
 *  the post-prefix tail of resource names. Used by the provider classifier
 *  tiebreaker (see provider.ts). */
export function distinctiveTokensFor(manifest: ProviderManifest, provider: string): Set<string> {
  const out = new Set<string>();

  // Explicit field wins when shipped by E1 / a future bundle build.
  if (Array.isArray(manifest.distinctive_tokens)) {
    for (const t of manifest.distinctive_tokens) {
      if (typeof t === "string" && t.length >= 2) out.add(t.toLowerCase());
    }
    if (out.size > 0) return out;
  }

  // Fallback: keys of primary_resources (e.g. "atlas", "warehouse"),
  // keys of service_aliases (e.g. "elasticache", "bigquery"), and the
  // post-prefix tail of resource names (e.g. "atlas_cluster" → "atlas",
  // "snowflake_warehouse" → "warehouse").
  for (const k of Object.keys(manifest.primary_resources ?? {})) {
    if (k.length >= 2) out.add(k.toLowerCase());
  }
  for (const k of Object.keys(manifest.service_aliases ?? {})) {
    if (k.length >= 2) out.add(k.toLowerCase());
  }
  // Provider-name pieces themselves are distinctive (e.g. "atlas" for
  // mongodb-atlas, "snowflake" for snowflake).
  for (const piece of provider.split(/[-_]+/)) {
    if (piece.length >= 3) out.add(piece.toLowerCase());
  }
  // Strip the provider prefix from resource names and add the leading
  // segment (e.g. "snowflake_warehouse" → "warehouse",
  // "mongodbatlas_advanced_cluster" → "advanced", "cloudflare_workers_kv"
  // → "workers"). Keeps the vocabulary bounded — only one token per
  // resource.
  const collapsedProvider = provider.replace(/[-_]/g, "");
  for (const name of Object.keys(manifest.resources ?? {})) {
    const stripped = stripProviderPrefix(name, provider, collapsedProvider);
    if (!stripped) continue;
    const head = stripped.split("_")[0];
    if (head && head.length >= 3) out.add(head.toLowerCase());
  }
  return out;
}

function stripProviderPrefix(
  name: string,
  provider: string,
  collapsedProvider: string,
): string | undefined {
  if (name.startsWith(`${provider}_`)) return name.slice(provider.length + 1);
  if (name.startsWith(`${collapsedProvider}_`)) return name.slice(collapsedProvider.length + 1);
  return undefined;
}
