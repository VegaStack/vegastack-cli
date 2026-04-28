// Helpers for inspecting the docs bundle on disk. Includes a hand-rolled
// structural validator for MANIFEST.json — keeps us dependency-free while
// catching schema drift without crashing the CLI.

import * as fs from "node:fs";
import * as path from "node:path";
import { bundleDir, bundleManifestPath, bundleVersionFile } from "./paths.js";
import { VegaError } from "./errors.js";

export interface BundleStatus {
  installed: boolean;
  path: string;
  version?: string;
  schemaVersion?: number;
  providerCount?: number;
  manifestPath?: string;
  generatedAt?: string;
  error?: string;
}

export interface RootManifest {
  format_version: number;
  generated_at: string;
  mount_root: string;
  discovery_script: string;
  schema_hint: string;
  providers: Record<string, ProviderEntry>;
}

export interface ProviderEntry {
  manifest: string;
  branch: string;
  upstream_sha: string;
  synced_at: string;
  file_count: number;
  // The directory fields are optional: not every provider has all three.
  // Providers without guides (utility providers, simple SaaS APIs) omit
  // `guides_dir`; a couple omit `resources_dir` or `datasources_dir`.
  resources_dir?: string;
  datasources_dir?: string;
  guides_dir?: string;
}

/** Latest manifest schema version this CLI knows how to read. */
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([4]);

/**
 * Read bundle status without throwing. Used by `vega doctor`. For strict access
 * (e.g. `vega tf`), use `requireBundle()` which throws a VegaError.
 */
export function readBundleStatus(): BundleStatus {
  const dir = bundleDir();
  const out: BundleStatus = { installed: false, path: dir };

  if (!fs.existsSync(dir)) return out;

  const verFile = bundleVersionFile();
  if (fs.existsSync(verFile)) {
    try {
      out.version = fs.readFileSync(verFile, "utf8").trim();
    } catch {
      /* ignore */
    }
  }

  const manifestPath = bundleManifestPath();
  if (!fs.existsSync(manifestPath)) {
    out.error = "MANIFEST.json missing";
    return out;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    const root = parseRootManifest(raw, manifestPath);
    out.installed = true;
    out.manifestPath = manifestPath;
    out.providerCount = Object.keys(root.providers).length;
    out.generatedAt = root.generated_at;

    const firstProviderKey = Object.keys(root.providers)[0];
    if (firstProviderKey !== undefined) {
      const firstProvider = root.providers[firstProviderKey];
      if (firstProvider) {
        const ppath = path.join(dir, firstProvider.manifest);
        if (fs.existsSync(ppath)) {
          try {
            const pm = JSON.parse(fs.readFileSync(ppath, "utf8")) as { schema_version?: number };
            if (typeof pm.schema_version === "number") out.schemaVersion = pm.schema_version;
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (e) {
    out.error = `MANIFEST.json invalid: ${(e as Error).message}`;
  }

  return out;
}

/**
 * Strict accessor: returns the parsed RootManifest or throws VegaError. Use
 * from `vega tf` and any other command that genuinely cannot proceed without
 * a valid bundle.
 */
export function requireBundle(): { dir: string; manifest: RootManifest } {
  const dir = bundleDir();
  const manifestPath = bundleManifestPath();

  if (!fs.existsSync(dir)) {
    throw new VegaError("BundleMissing", `bundle not found at ${dir}`, { context: { dir } });
  }
  if (!fs.existsSync(manifestPath)) {
    throw new VegaError("BundleCorrupt", `bundle MANIFEST.json missing at ${manifestPath}`, {
      context: { manifestPath },
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new VegaError(
      "BundleCorrupt",
      `MANIFEST.json is not valid JSON: ${(e as Error).message}`,
      {
        cause: e,
        context: { manifestPath },
      },
    );
  }

  return { dir, manifest: parseRootManifest(raw, manifestPath) };
}

// ── Structural validators (zod-free, dependency-free) ────────────

function parseRootManifest(raw: unknown, manifestPath: string): RootManifest {
  if (!isObject(raw)) {
    throw new VegaError("BundleCorrupt", "MANIFEST.json is not a JSON object", {
      context: { manifestPath },
    });
  }

  const formatVersion = raw.format_version;
  if (typeof formatVersion !== "number") {
    throw new VegaError(
      "BundleCorrupt",
      "MANIFEST.json missing required field 'format_version' (number)",
      { context: { manifestPath } },
    );
  }
  if (formatVersion !== 1) {
    throw new VegaError(
      "BundleVersionMismatch",
      `MANIFEST.json format_version=${formatVersion} not supported (expected 1)`,
      { context: { actual: formatVersion, expected: 1, manifestPath } },
    );
  }

  const providers = raw.providers;
  if (!isObject(providers)) {
    throw new VegaError(
      "BundleCorrupt",
      "MANIFEST.json missing required field 'providers' (object)",
      {
        context: { manifestPath },
      },
    );
  }
  if (Object.keys(providers).length === 0) {
    throw new VegaError("BundleCorrupt", "MANIFEST.json declares zero providers", {
      context: { manifestPath },
    });
  }

  const parsedProviders: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(providers)) {
    if (!isObject(entry)) {
      throw new VegaError("BundleCorrupt", `provider '${name}' entry is not an object`, {
        context: { manifestPath, provider: name },
      });
    }
    const provider: ProviderEntry = {
      manifest: stringField(entry, "manifest", manifestPath, `providers.${name}`),
      branch: stringField(entry, "branch", manifestPath, `providers.${name}`),
      upstream_sha: stringField(entry, "upstream_sha", manifestPath, `providers.${name}`),
      synced_at: stringField(entry, "synced_at", manifestPath, `providers.${name}`),
      file_count: numberField(entry, "file_count", manifestPath, `providers.${name}`),
    };
    const rd = optionalStringField(entry, "resources_dir", manifestPath, `providers.${name}`);
    if (rd !== undefined) provider.resources_dir = rd;
    const dd = optionalStringField(entry, "datasources_dir", manifestPath, `providers.${name}`);
    if (dd !== undefined) provider.datasources_dir = dd;
    const gd = optionalStringField(entry, "guides_dir", manifestPath, `providers.${name}`);
    if (gd !== undefined) provider.guides_dir = gd;
    parsedProviders[name] = provider;
  }

  return {
    format_version: formatVersion,
    generated_at: stringField(raw, "generated_at", manifestPath),
    mount_root: stringField(raw, "mount_root", manifestPath),
    discovery_script: stringField(raw, "discovery_script", manifestPath),
    schema_hint: stringField(raw, "schema_hint", manifestPath),
    providers: parsedProviders,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(
  obj: Record<string, unknown>,
  field: string,
  manifestPath: string,
  scope = "",
): string {
  const v = obj[field];
  if (typeof v !== "string") {
    throw new VegaError(
      "BundleCorrupt",
      `MANIFEST.json missing or non-string '${scope ? `${scope}.` : ""}${field}'`,
      { context: { manifestPath, field, scope } },
    );
  }
  return v;
}

function optionalStringField(
  obj: Record<string, unknown>,
  field: string,
  manifestPath: string,
  scope = "",
): string | undefined {
  const v = obj[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new VegaError(
      "BundleCorrupt",
      `MANIFEST.json field '${scope ? `${scope}.` : ""}${field}' must be a string when present`,
      { context: { manifestPath, field, scope } },
    );
  }
  return v;
}

function numberField(
  obj: Record<string, unknown>,
  field: string,
  manifestPath: string,
  scope = "",
): number {
  const v = obj[field];
  if (typeof v !== "number") {
    throw new VegaError(
      "BundleCorrupt",
      `MANIFEST.json missing or non-number '${scope ? `${scope}.` : ""}${field}'`,
      { context: { manifestPath, field, scope } },
    );
  }
  return v;
}
