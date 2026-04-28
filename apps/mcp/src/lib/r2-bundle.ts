// R2 + KV bundle reader for the MCP worker.
//
// All keys are bucket-relative and include the `cli/` prefix because the
// shared `vegastack-agent-kb` bucket hosts other agent-kb surfaces under
// other prefixes. `BUNDLE_PUBLIC_BASE_URL` is the bare custom domain
// (https://bundles.vegastack.com) — `${BASE}/${key}` works symmetrically
// with the R2 binding read.
//
// The worker reads:
//   * `cli/bundle/MANIFEST.json`        — root index (provider list, bundle_version)
//   * `cli/bundle/<provider>/MANIFEST.json` — per-provider scoring data + resources
//   * `cli/bundle/knowledge/<id>.md`    — knowledge card markdown (with frontmatter)
//   * `cli/bundle/recipes/<id>.toml`    — recipe definitions
//
// The build-and-publish workflow uploads each of these as individual R2
// objects (in addition to the per-provider tar shards under `cli/cas/sha256/`).
//
// Lookup order for any key:
//   1. In-memory LRU (per isolate, cold-start friendly)
//   2. KV cache (warm across isolates), TTL = CACHE_TTL_SECONDS
//   3. R2 bucket binding (`env.BUNDLE`) — source of truth
//   4. Public CDN fallback (`env.BUNDLE_PUBLIC_BASE_URL`) for local `wrangler dev`
//      runs without an R2 binding configured.
//
// The reader is intentionally R2-binding-first: in production the binding is
// zero-egress; the public CDN fallback exists only so a contributor can
// `wrangler dev` against the live bundle without provisioning R2 first.

import type { BundleRootManifest, ProviderManifest } from "./types.js";

interface MemoryEntry {
  body: string;
  fetchedAtMs: number;
}

const MEM_CACHE = new Map<string, MemoryEntry>();
const MEM_CACHE_MAX = 64;

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

/** Fetch any text key from the bundle. Throws if it cannot be located. */
export async function readBundleText(env: Env, key: string): Promise<string> {
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
    const obj = await env.BUNDLE.get(key);
    if (obj) body = await obj.text();
  } catch (e) {
    // R2 binding may be unavailable in some local dev modes; fall through to CDN.
    body = null;
  }

  // 4. Public CDN fallback (dev convenience). Network failures are silently
  //    swallowed — the next step will throw BundleNotFound with the bundle
  //    key, which is the contract every caller expects.
  if (body === null && env.BUNDLE_PUBLIC_BASE_URL) {
    const url = `${env.BUNDLE_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
    try {
      const resp = await fetch(url);
      if (resp.ok) body = await resp.text();
    } catch {
      body = null;
    }
  }

  if (body === null) {
    throw new BundleNotFound(key);
  }

  rememberInMemory(key, body);
  if (env.MCP_CACHE) {
    // Best-effort warm cache; failures are not fatal.
    const expirationTtl = Math.max(60, Math.floor(ttlMs(env) / 1000));
    await env.MCP_CACHE.put(key, body, { expirationTtl }).catch(() => undefined);
  }
  return body;
}

/** Fetch + JSON-parse a bundle key. */
export async function readBundleJson<T = unknown>(env: Env, key: string): Promise<T> {
  const text = await readBundleText(env, key);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new BundleCorrupt(key, e);
  }
}

/** Read the root MANIFEST.json (cached). */
export async function readRootManifest(env: Env): Promise<BundleRootManifest> {
  const key = env.BUNDLE_MANIFEST_KEY ?? "cli/bundle/MANIFEST.json";
  return readBundleJson<BundleRootManifest>(env, key);
}

/** Read a per-provider MANIFEST.json (cached). */
export async function readProviderManifest(env: Env, provider: string): Promise<ProviderManifest> {
  // Regex matches the canonical schema (allows leading digit so `1password`
  // is accepted). Closes punch-list #3 from P5.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new BundleNotFound(`cli/bundle/${provider}/MANIFEST.json`);
  }
  return readBundleJson<ProviderManifest>(env, `cli/bundle/${provider}/MANIFEST.json`);
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

export class BundleNotFound extends Error {
  readonly code = "BundleNotFound";
  constructor(public readonly key: string) {
    super(`bundle key not found: ${key}`);
    this.name = "BundleNotFound";
  }
}

export class BundleCorrupt extends Error {
  readonly code = "BundleCorrupt";
  constructor(public readonly key: string, override readonly cause: unknown) {
    super(`bundle key is not valid JSON: ${key}`);
    this.name = "BundleCorrupt";
  }
}

/** Reset all caches (used by tests). */
export function clearBundleCaches(): void {
  MEM_CACHE.clear();
}
