// Worker-side discovery (v0.1 stub).
//
// SCOPE: this is a deliberately minimal implementation that produces the
// canonical envelope shape (see ./types.ts) by reading per-provider
// MANIFEST.json files from R2. When E2 lands the full TS port at
// /Users/mk/projects/vegastack-cli/src/lib/discover/, replace the body of
// `discover()` below with a worker-friendly fork of that pipeline (no
// node:fs, no node:path beyond "node:path/posix").
//
// What this stub does TODAY:
//   1. Detect the provider — explicit `provider` argument wins; otherwise
//      we attempt a token-vs-providers match against the root manifest.
//   2. Tokenize the query (lowercase, [a-z0-9]+ runs, drop common stopwords
//      and the provider name itself).
//   3. Load the per-provider MANIFEST.json from R2.
//   4. Score each resource/data_source by:
//        + 50  exact resource-name match (post-provider strip)
//        + 20  argument_index hit
//        + 15  attribute_index hit
//        + 10  description_token_index hit
//        +  5  description substring hit
//        +  3  primary_resources hint
//   5. Normalize per-provider (top score → 100), pick top `max`.
//   6. Emit a fully-shaped DiscoverOk including knowledge[] / recipes[] /
//      concept_aliases_used[] (empty for v0.1 stub — populated when E2 lands).
//
// What this stub deliberately omits (deferred to the post-E2 swap):
//   * Tier-2 grep fallback (Workers can't shell out — would need a separate
//     content-indexed shard).
//   * Knowledge / recipe loading (need bundle/knowledge/*.md fetcher; trivial
//     to add once E3 publishes the files).
//   * Concept-alias rewrites (need bundle/<provider>/aliases.yaml fetcher).
//   * Per-resource HCL example extraction (currently echoes a synthesized stub).

import {
  BundleCorrupt,
  BundleNotFound,
  listProviders,
  readProviderManifest,
  readRootManifest,
} from "./r2-bundle.js";
import type {
  DiscoverFile,
  DiscoverResult,
  ManifestResourceEntry,
  ProviderManifest,
} from "./types.js";

const NOISE = new Set([
  "a", "an", "the", "and", "or", "but", "with", "without", "for", "to", "of",
  "in", "on", "at", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "how", "what", "which",
  "that", "this", "these", "those", "it", "its", "i", "we", "you", "they",
  "create", "make", "set", "setup", "configure", "use", "using", "want",
  "need", "please", "show", "list", "give", "me", "us", "my", "our",
]);

export interface DiscoverInput {
  query: string;
  provider?: string;
  max?: number;
}

const DEFAULT_MAX = 20;

export async function discover(env: Env, input: DiscoverInput): Promise<DiscoverResult> {
  const { query } = input;
  const max = input.max ?? DEFAULT_MAX;

  // ── Root manifest (for provider list + bundle_version) ───────────────────
  let providers: string[];
  let bundleVersion: string;
  try {
    const root = await readRootManifest(env);
    providers = await listProviders(env);
    bundleVersion = root.bundle_version ?? "unknown";
  } catch (e) {
    return errorResult(query, e);
  }

  // ── Provider detection ───────────────────────────────────────────────────
  let provider = input.provider?.toLowerCase().trim();
  let providerConfidence = provider ? 1.0 : 0.0;

  const tokens0 = rawTokens(query);

  if (!provider) {
    const candidates = scoreProviders(tokens0, providers);
    if (candidates.length === 0) {
      return {
        status: "error",
        query,
        error:
          "Could not detect a provider from the query. Pass `provider` explicitly (one of: " +
          providers.slice(0, 8).join(", ") +
          (providers.length > 8 ? ", ..." : "") +
          ").",
        code: "ProviderUnknown",
      };
    }
    if (candidates.length > 1 && candidates[0]!.score - candidates[1]!.score < 0.2) {
      return {
        status: "ambiguous",
        query,
        tokens: tokenize(query, undefined),
        candidate_providers: candidates,
        recipes: [], // recipe loader lands when E3 publishes recipes/
        hint: "Use `provider` to disambiguate.",
      };
    }
    provider = candidates[0]!.provider;
    providerConfidence = candidates[0]!.score;
  }

  if (!providers.includes(provider)) {
    return {
      status: "error",
      query,
      error: `Unknown provider "${provider}". Known providers: ${providers.join(", ")}.`,
      code: "ProviderUnknown",
    };
  }

  // ── Tokenize (post-provider strip) ───────────────────────────────────────
  const tokens = tokenize(query, provider);

  // ── Per-provider manifest ────────────────────────────────────────────────
  let manifest: ProviderManifest;
  try {
    manifest = await readProviderManifest(env, provider);
  } catch (e) {
    return errorResult(query, e);
  }

  // ── Score ────────────────────────────────────────────────────────────────
  const scores = new Map<string, { score: number; reasons: string[]; entry: ManifestResourceEntry; key: string; kind: "resources" | "data_sources" }>();
  scoreSection(scores, manifest, "resources", tokens);
  scoreSection(scores, manifest, "data_sources", tokens);
  primaryResourceBoost(scores, manifest, tokens);

  // Normalize
  let topRaw = 0;
  for (const s of scores.values()) if (s.score > topRaw) topRaw = s.score;
  const ranked = [...scores.entries()]
    .filter(([, v]) => v.score > 0)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, max);

  const files: DiscoverFile[] = ranked.map(([, v]) => ({
    path: `cli/bundle/${provider}/${v.entry.file}`,
    score: round1(v.score),
    score_norm: topRaw > 0 ? Math.round((v.score / topRaw) * 100) : 0,
    tier: "manifest",
    reasons: v.reasons,
    manifest_entry: v.entry,
    example_usage: synthExample(provider!, v.key, v.kind === "data_sources" ? "data" : "resource", v.entry),
  }));

  const tiersUsed: ("manifest" | "grep" | "alias" | "knowledge" | "recipe")[] = ["manifest"];

  return {
    status: "ok",
    query,
    provider,
    provider_confidence: round1(providerConfidence),
    tokens,
    tiers_used: tiersUsed,
    schema_version: 1,
    bundle_version: bundleVersion,
    files,
    knowledge: [], // tf_get_knowledge_card serves cli/bundle/knowledge/*.md on demand
    recipes: [],   // tf_get_recipe serves cli/bundle/recipes/*.toml on demand
    concept_aliases_used: [], // populated by tokenize when cli/bundle/<provider>/aliases.yaml loader lands
    citations: files.map((f) => f.path),
    count: files.length,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function errorResult(query: string, e: unknown): DiscoverResult {
  if (e instanceof BundleNotFound) {
    return { status: "error", query, error: e.message, code: "BundleMissing" };
  }
  if (e instanceof BundleCorrupt) {
    return { status: "error", query, error: e.message, code: "BundleCorrupt" };
  }
  return {
    status: "error",
    query,
    error: e instanceof Error ? e.message : String(e),
    code: "Internal",
  };
}

function rawTokens(query: string): string[] {
  return (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

export function tokenize(query: string, provider: string | undefined): string[] {
  const raw = rawTokens(query);
  const strip = new Set<string>();
  if (provider) {
    strip.add(provider.replace(/-/g, ""));
    for (const piece of provider.split(/[-_\s]+/)) {
      if (piece.length >= 2) strip.add(piece);
    }
  }
  const out: string[] = [];
  for (const t of raw) {
    if (NOISE.has(t)) continue;
    if (strip.has(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

function scoreProviders(
  tokens: string[],
  providers: string[],
): { provider: string; score: number }[] {
  const tokenSet = new Set(tokens);
  const scored: { provider: string; score: number }[] = [];
  for (const p of providers) {
    let s = 0;
    if (tokenSet.has(p)) s = 1.0;
    else if (tokenSet.has(p.replace(/-/g, ""))) s = 0.9;
    else {
      for (const piece of p.split(/[-_]/)) {
        if (piece.length >= 3 && tokenSet.has(piece)) {
          s = Math.max(s, 0.6);
        }
      }
    }
    if (s > 0) scored.push({ provider: p, score: s });
  }
  scored.sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));
  return scored;
}

function scoreSection(
  out: Map<
    string,
    {
      score: number;
      reasons: string[];
      entry: ManifestResourceEntry;
      key: string;
      kind: "resources" | "data_sources";
    }
  >,
  manifest: ProviderManifest,
  kind: "resources" | "data_sources",
  tokens: string[],
): void {
  const section = manifest[kind] ?? {};
  const argIndex = manifest.argument_index ?? {};
  const attrIndex = manifest.attribute_index ?? {};
  const descIndex = manifest.description_token_index ?? {};

  for (const [name, entry] of Object.entries(section)) {
    let score = 0;
    const reasons: string[] = [];
    const lowerName = name.toLowerCase();

    for (const t of tokens) {
      if (lowerName === t) {
        score += 50;
        reasons.push(`exact_${kind === "resources" ? "resource" : "datasource"}:${name}`);
      } else if (lowerName.includes(`_${t}`) || lowerName.includes(`${t}_`) || lowerName.endsWith(`_${t}`)) {
        score += 20;
        reasons.push(`name_partial:${t}`);
      }

      if (descIndex[t]?.includes(name)) {
        score += 10;
        reasons.push(`description:${t}`);
      } else if (entry.description && entry.description.toLowerCase().includes(t)) {
        score += 5;
        reasons.push(`description:${t}`);
      }
      if (argIndex[t]?.includes(name)) {
        score += 20;
        reasons.push(`argument_index:${t}`);
      }
      if (attrIndex[t]?.includes(name)) {
        score += 15;
        reasons.push(`attribute_index:${t}`);
      }
    }

    if (score > 0) {
      const existing = out.get(name);
      if (!existing || existing.score < score) {
        out.set(name, { score, reasons: dedup(reasons), entry, key: name, kind });
      }
    }
  }
}

function primaryResourceBoost(
  out: Map<
    string,
    { score: number; reasons: string[]; entry: ManifestResourceEntry; key: string; kind: "resources" | "data_sources" }
  >,
  manifest: ProviderManifest,
  tokens: string[],
): void {
  const primary = manifest.primary_resources ?? {};
  for (const t of tokens) {
    const hit = primary[t];
    if (!hit) continue;
    const entry = manifest.resources?.[hit] ?? manifest.data_sources?.[hit];
    if (!entry) continue;
    const existing = out.get(hit);
    const bumped = (existing?.score ?? 0) + 30;
    out.set(hit, {
      score: bumped,
      reasons: dedup([...(existing?.reasons ?? []), `primary_resource:${hit}`]),
      entry,
      key: hit,
      kind: existing?.kind ?? (manifest.resources?.[hit] ? "resources" : "data_sources"),
    });
  }
}

function synthExample(
  provider: string,
  resourceName: string,
  kind: "resource" | "data",
  entry: ManifestResourceEntry,
): string {
  const block = kind === "data" ? "data" : "resource";
  const required = entry.required_args.slice(0, 4).map((a) => `  ${a.name} = "..."`);
  const optHint = entry.optional_args.length
    ? `  # optional: ${entry.optional_args
        .slice(0, 4)
        .map((a) => a.name)
        .join(", ")}${entry.optional_args.length > 4 ? ", ..." : ""}`
    : "";
  return [
    `${block} "${resourceName}" "example" {`,
    ...required,
    ...(optHint ? [optHint] : []),
    "}",
  ].join("\n");
}

function dedup(xs: string[]): string[] {
  return [...new Set(xs)];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
