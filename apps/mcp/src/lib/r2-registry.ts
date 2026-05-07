// R2 + KV Registry pack reader for the MCP worker.
//
// All keys are bucket-relative and include the `cli/` prefix because the
// `vegastack-cli-registry` bucket stores every public Registry surface under
// that prefix. `REGISTRY_PUBLIC_BASE_URL` is the bare custom domain
// (https://cli-registry.vegastack.com) — `${BASE}/${key}` works symmetrically
// with the R2 binding read.
//
// The worker reads:
//   * `cli/packs/terraform/MANIFEST.json`        — Terraform pack index
//   * `cli/packs/terraform/docs/<provider>/MANIFEST.json` — per-provider scoring data + resources
//   * `cli/packs/terraform/docs/knowledge/<id>.md` — knowledge card markdown
//   * `cli/packs/terraform/docs/recipes/<id>.toml` — recipe definitions
//
// The Registry sync workflow uploads the complete generated `cli/` tree to R2.
//
// Lookup order for any key:
//   1. In-memory LRU (per isolate, cold-start friendly)
//   2. KV cache (warm across isolates), TTL = CACHE_TTL_SECONDS
//   3. R2 bucket binding (`env.REGISTRY`) — source of truth
//   4. Public CDN fallback (`env.REGISTRY_PUBLIC_BASE_URL`) for local `wrangler dev`
//      runs without an R2 binding configured.
//
// The reader is intentionally R2-binding-first: in production the binding is
// zero-egress; the public CDN fallback exists only so a contributor can
// `wrangler dev` against the live Registry pack without provisioning R2 first.

import type { TerraformRootManifest, ProviderManifest } from "./types.js";

interface MemoryEntry {
  body: string;
  fetchedAtMs: number;
}

const MEM_CACHE = new Map<string, MemoryEntry>();
const MEM_CACHE_MAX = 64;

// Hard upper bound on any single Registry artifact loaded into a Workers
// isolate. Workers have a 128 MiB memory ceiling; an unbounded R2 / CDN read
// followed by `JSON.parse` (or a hand-rolled YAML/TOML walk) can OOM-kill
// the isolate. 4 MiB is generous for manifests; knowledge / recipe artifacts
// are typically <64 KiB. (audit F-003, code-review/mcp)
export const MAX_REGISTRY_ARTIFACT_BYTES = 4 * 1024 * 1024;

// Public CDN fallback fetch budget. Without this, a slow origin holds the
// subrequest until the global Workers limit (~30s) fires, turning every
// cache miss into a 30s stall on the MCP client side. (audit F-004)
const CDN_FETCH_TIMEOUT_MS = 5_000;

function rememberInMemory(key: string, body: string): void {
  if (MEM_CACHE.size >= MEM_CACHE_MAX) {
    // Drop the oldest entry — Map preserves insertion order.
    const firstKey = MEM_CACHE.keys().next().value as string | undefined;
    if (firstKey !== undefined) MEM_CACHE.delete(firstKey);
  }
  MEM_CACHE.set(key, { body, fetchedAtMs: Date.now() });
}

function ttlMs(env: Env): number {
  const sec = Number.parseInt(env.CACHE_TTL_SECONDS ?? "300", 10);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 300_000;
}

/** Fetch any text key from the Registry pack. Throws if it cannot be located. */
export async function readRegistryText(env: Env, key: string): Promise<string> {
  // 1. In-memory
  const mem = MEM_CACHE.get(key);
  if (mem && Date.now() - mem.fetchedAtMs < ttlMs(env)) {
    return mem.body;
  }

  // 2. KV (optional)
  if (env.MCP_CACHE) {
    const kvHit = await env.MCP_CACHE.get(key, "text");
    if (kvHit !== null) {
      rememberInMemory(key, kvHit);
      return kvHit;
    }
  }

  // 3. R2 binding
  let body: string | null = null;
  try {
    const obj = await env.REGISTRY.get(key);
    if (obj) {
      // Fail fast on oversized artifacts before allocating the string into
      // isolate memory (audit F-003). `obj.size` is set on R2 GETs.
      const size = (obj as { size?: number }).size;
      if (typeof size === "number" && size > MAX_REGISTRY_ARTIFACT_BYTES) {
        throw new ArtifactTooLarge(key, size);
      }
      body = await obj.text();
    }
  } catch (e) {
    if (e instanceof ArtifactTooLarge) throw e;
    // R2 binding may be unavailable in some local dev modes; fall through to CDN.
    body = null;
  }

  // 4. Public CDN fallback (dev convenience). Network failures are silently
  //    swallowed — the next step will throw RegistryKeyNotFound with the Registry pack
  //    key, which is the contract every caller expects.
  if (body === null && env.REGISTRY_PUBLIC_BASE_URL) {
    const url = `${env.REGISTRY_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CDN_FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (resp.ok) {
        // Honour Content-Length when present; otherwise the body still cannot
        // exceed the cap — we re-check after reading. (audit F-003)
        const lenHeader = resp.headers.get("Content-Length");
        const len = lenHeader ? Number.parseInt(lenHeader, 10) : Number.NaN;
        if (Number.isFinite(len) && len > MAX_REGISTRY_ARTIFACT_BYTES) {
          throw new ArtifactTooLarge(key, len);
        }
        const text = await resp.text();
        if (text.length > MAX_REGISTRY_ARTIFACT_BYTES) {
          throw new ArtifactTooLarge(key, text.length);
        }
        body = text;
      }
    } catch (e) {
      if (e instanceof ArtifactTooLarge) {
        clearTimeout(timer);
        throw e;
      }
      body = null;
    } finally {
      clearTimeout(timer);
    }
  }

  if (body === null) {
    throw new RegistryKeyNotFound(key);
  }

  rememberInMemory(key, body);
  if (env.MCP_CACHE) {
    // Best-effort warm cache; failures are not fatal.
    const expirationTtl = Math.max(60, Math.floor(ttlMs(env) / 1000));
    await env.MCP_CACHE.put(key, body, { expirationTtl }).catch(() => undefined);
  }
  return body;
}

/** Fetch + JSON-parse a Registry pack key. */
export async function readRegistryJson<T = unknown>(env: Env, key: string): Promise<T> {
  const text = await readRegistryText(env, key);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ArtifactCorrupt(key, e);
  }
}

/** Read the root MANIFEST.json (cached). */
export async function readRootManifest(env: Env): Promise<TerraformRootManifest> {
  const key = env.REGISTRY_MANIFEST_KEY ?? "cli/packs/terraform/MANIFEST.json";
  return readRegistryJson<TerraformRootManifest>(env, key);
}

/** Read a per-provider MANIFEST.json (cached). */
export async function readProviderManifest(env: Env, provider: string): Promise<ProviderManifest> {
  // Regex matches the canonical schema (allows leading digit so `1password`
  // is accepted). Closes punch-list #3 from P5.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new RegistryKeyNotFound(`cli/packs/terraform/docs/${provider}/MANIFEST.json`);
  }
  return readRegistryJson<ProviderManifest>(env, `cli/packs/terraform/docs/${provider}/MANIFEST.json`);
}

/** List the canonical provider names from the root manifest. */
export async function listProviders(env: Env): Promise<string[]> {
  const root = await readRootManifest(env);
  if (Array.isArray(root.providers)) return [...root.providers].sort();
  if (root.providers && typeof root.providers === "object") {
    return Object.keys(root.providers).sort();
  }
  return [];
}

export class RegistryKeyNotFound extends Error {
  readonly code = "RegistryKeyNotFound";
  constructor(public readonly key: string) {
    super(`Registry pack key not found: ${key}`);
    this.name = "RegistryKeyNotFound";
  }
}

export class ArtifactTooLarge extends Error {
  readonly code = "ArtifactTooLarge";
  constructor(public readonly key: string, public readonly size: number) {
    super(`Registry pack key exceeds size cap: ${key} (${size} bytes > ${MAX_REGISTRY_ARTIFACT_BYTES})`);
    this.name = "ArtifactTooLarge";
  }
}

export class ArtifactCorrupt extends Error {
  readonly code = "ArtifactCorrupt";
  constructor(public readonly key: string, override readonly cause: unknown) {
    super(`Registry pack key is not valid JSON: ${key}`);
    this.name = "ArtifactCorrupt";
  }
}

/** Reset all caches (used by tests). */
export function clearRegistryCaches(): void {
  MEM_CACHE.clear();
}
