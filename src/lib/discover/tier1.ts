// Tier 1: deterministic O(1) scoring against a per-provider MANIFEST.json.
// 12 stages total — 1a..1k are ports of the legacy Python harness; 1l is
// the v0.1 recommended_companions surface.
//
// Refactor note (audit #59): the original `tier1` had cyclomatic complexity
// 117 — every stage was inlined into one function. It has been split into
// per-stage helpers below. The public signature, iteration order, and the
// final ScoredFile output are byte-identical to the pre-refactor version
// (see tests/lib/discover/tier1-characterization.test.ts).
//
// New in v0.1:
//   • Stages 1a + primary_resource ALSO fire `subcategory_peer` boosts
//     on every other resource in the same subcategory. Closes F9.
//   • SUBCAT_KEYWORDS / PRIMARY_RESOURCES come from the manifest, not
//     hand-curated tables in code. Closes the "embedded tables" smell.
//   • Stage 1l consumes a pre-built `fileToResource` Map (built once in
//     enrich.ts) instead of re-scanning resources on every hit. Closes F24.
//   • Alias-resource widening: when an alias matches the original query,
//     every alias resource gets a guaranteed +60 boost so it survives top-K.

import * as fs from "node:fs";
import * as path from "node:path";
import { bigrams } from "./bigrams.js";
import { INTENT_KEYWORDS } from "./constants.js";
import { Scorer } from "./scoring.js";
import type { AliasRewrite } from "./tokenize.js";
import type { ProviderManifest, ScoredFile } from "./types.js";

export interface Tier1Args {
  manifest: ProviderManifest;
  tokens: string[];
  provider: string;
  providerDir: string;
  /** Pre-built reverse map: relative file path → resource name. Built in
   *  enrich.ts and passed in to keep stage 1l O(1). Optional for backwards
   *  compat — when absent we build it locally. */
  fileToResource?: ReadonlyMap<string, string>;
  /** Alias matches that should widen the result set (resources guaranteed
   *  in top-K via a +60 boost with reason `alias_resource:<alias>`). */
  aliasMatches?: AliasRewrite[];
}

type ResourceMap = NonNullable<ProviderManifest["resources"]>;
type ResourceEntry = ResourceMap[string];

/** Per-call context shared across stage helpers. */
interface Ctx {
  tokens: string[];
  provider: string;
  providerDir: string;
  scorer: Scorer;
  resources: Record<string, ResourceEntry>;
  dataSources: Record<string, ResourceEntry>;
  subcategoryUseful: boolean;
  subcategories: Record<string, string[]>;
  fullPath(filepath: string): string;
  lookupAny(name: string): ResourceEntry | undefined;
  fanoutSubcatPeers(subcat: string | undefined, selfFile: string | undefined): void;
}

function buildCtx(args: Tier1Args): Ctx {
  const { manifest, tokens, provider, providerDir } = args;
  const scorer = new Scorer();
  const resources = manifest.resources ?? {};
  const dataSources = manifest.data_sources ?? {};
  const subcategoryUseful = manifest.subcategory_useful ?? true;
  const subcategories = subcategoryUseful ? (manifest.subcategories ?? {}) : {};

  const fullPath = (filepath: string): string => path.join(providerDir, filepath);
  const lookupAny = (name: string): ResourceEntry | undefined =>
    resources[name] ?? dataSources[name] ?? undefined;
  const fanoutSubcatPeers = (subcat: string | undefined, selfFile: string | undefined): void => {
    if (!subcategoryUseful || !subcat) return;
    const peers = subcategories[subcat];
    if (!peers) return;
    for (const peer of peers) {
      if (peer === selfFile) continue;
      scorer.add(fullPath(peer), 25, "subcategory_peer", subcat);
    }
  };

  return {
    tokens,
    provider,
    providerDir,
    scorer,
    resources,
    dataSources,
    subcategoryUseful,
    subcategories,
    fullPath,
    lookupAny,
    fanoutSubcatPeers,
  };
}

// ── 1a. exact resource-name match ───────────────────────────────────────
function stage1aExactResource(
  ctx: Ctx,
  hclRefs: NonNullable<ProviderManifest["hcl_references"]>,
): void {
  // Build a one-shot index keyed by both full and stripped resource name.
  // Without this we did O(tokens × resources) per query (≈6k iterations for
  // AWS), with the same shape repeated downstream. The cost is N entries of
  // map storage per call and yields a ≥10× speedup on large providers.
  // Resources have priority over data sources on collision (the previous
  // structure also visited resources first), and the stripped variant only
  // populates the slot when not already taken so a stripped collision with a
  // full name does not shadow it.
  const prefix = `${ctx.provider}_`;
  const resIdx = new Map<string, { resName: string; entry: ResourceEntry }>();
  for (const [resName, entry] of Object.entries(ctx.resources)) {
    resIdx.set(resName, { resName, entry });
    if (resName.startsWith(prefix)) {
      const stripped = resName.slice(prefix.length);
      if (!resIdx.has(stripped)) resIdx.set(stripped, { resName, entry });
    }
  }
  const dsIdx = new Map<string, { resName: string; entry: ResourceEntry }>();
  for (const [resName, entry] of Object.entries(ctx.dataSources)) {
    dsIdx.set(resName, { resName, entry });
    if (resName.startsWith(prefix)) {
      const stripped = resName.slice(prefix.length);
      if (!dsIdx.has(stripped)) dsIdx.set(stripped, { resName, entry });
    }
  }
  // To preserve the legacy iteration order (resources before data sources,
  // and per-token traversal that may fire both branches when a name collides
  // across maps), we still iterate tokens × {resources, dataSources} but each
  // inner step is O(1).
  for (const token of ctx.tokens) {
    // Resources: walk all matching variants. The map can hold the same entry
    // under both its full and stripped key, so iterate by entry value via the
    // small set of unique entries collected here.
    const resMatches = new Set<{ resName: string; entry: ResourceEntry }>();
    const r = resIdx.get(token);
    if (r) resMatches.add(r);
    for (const m of resMatches) {
      ctx.scorer.add(ctx.fullPath(m.entry.file), 100, "exact_resource", m.resName);
      ctx.fanoutSubcatPeers(m.entry.subcategory, m.entry.file);
      expandHclRefs(ctx, hclRefs, m.resName);
    }
    const d = dsIdx.get(token);
    if (d) {
      ctx.scorer.add(ctx.fullPath(d.entry.file), 90, "exact_datasource", d.resName);
    }
  }
}

function expandHclRefs(
  ctx: Ctx,
  hclRefs: NonNullable<ProviderManifest["hcl_references"]>,
  resName: string,
): void {
  const refs = hclRefs[resName];
  if (!refs) return;
  for (const ref of refs.references ?? []) {
    const peerEntry = ctx.lookupAny(ref);
    if (peerEntry) ctx.scorer.add(ctx.fullPath(peerEntry.file), 30, "hcl_ref", ref);
  }
  for (const back of refs.referenced_by ?? []) {
    const peerEntry = ctx.lookupAny(back);
    if (peerEntry) ctx.scorer.add(ctx.fullPath(peerEntry.file), 30, "hcl_back_ref", back);
  }
}

// ── 1b. SUBCAT_KEYWORDS (from manifest) ─────────────────────────────────
function stage1bSubcatKeyword(ctx: Ctx, subcatKeywords: Record<string, string>): void {
  if (!ctx.subcategoryUseful) return;
  for (const token of ctx.tokens) {
    const target = subcatKeywords[token];
    if (target && ctx.subcategories[target]) {
      for (const f of ctx.subcategories[target]) {
        ctx.scorer.add(ctx.fullPath(f), 70, "subcat_keyword", `${token}→${target}`);
      }
    }
  }
}

// ── PRIMARY_RESOURCES boost (from manifest) ─────────────────────────────
function stagePrimaryResource(ctx: Ctx, primaryResources: Record<string, string>): void {
  for (const token of ctx.tokens) {
    const primaryName = primaryResources[token];
    if (!primaryName) continue;
    const entry = ctx.lookupAny(primaryName);
    if (entry) {
      ctx.scorer.add(ctx.fullPath(entry.file), 100, "primary_resource", primaryName);
      ctx.fanoutSubcatPeers(entry.subcategory, entry.file);
    }
  }
}

// ── 1c. synthetic subcategory ───────────────────────────────────────────
function stage1cSynthetic(ctx: Ctx, synthetic: Record<string, string[]>): void {
  for (const token of ctx.tokens) {
    if (synthetic[token]) {
      for (const f of synthetic[token]) {
        ctx.scorer.add(ctx.fullPath(f), 65, "synthetic_subcat", token);
      }
    }
  }
  for (let i = 0; i < ctx.tokens.length - 1; i++) {
    const combined = `${ctx.tokens[i]}_${ctx.tokens[i + 1]}`;
    if (synthetic[combined]) {
      for (const f of synthetic[combined]) {
        ctx.scorer.add(ctx.fullPath(f), 68, "synthetic_subcat", combined);
      }
    }
  }
}

// ── 1d. token-in-subcategory substring ──────────────────────────────────
function stage1dSubcategorySubstring(ctx: Ctx): void {
  if (!ctx.subcategoryUseful) return;
  for (const [subcat, files] of Object.entries(ctx.subcategories)) {
    const sc = subcat.toLowerCase();
    for (const token of ctx.tokens) {
      if (token.length >= 3 && sc.includes(token)) {
        for (const f of files) ctx.scorer.add(ctx.fullPath(f), 40, "subcategory", subcat);
        break;
      }
    }
  }
}

// ── 1e. partial resource-name match ─────────────────────────────────────
function stage1ePartialName(ctx: Ctx): void {
  for (const [resName, entry] of Object.entries(ctx.resources)) {
    const parts = resName.split("_");
    for (const token of ctx.tokens) {
      if (token.length >= 3 && parts.includes(token)) {
        ctx.scorer.add(ctx.fullPath(entry.file), 35, "name_partial", resName);
      }
    }
  }
}

// ── 1f. argument / attribute reverse index ──────────────────────────────
function stage1fArgAttr(
  ctx: Ctx,
  argIndex: Record<string, string[]>,
  attrIndex: Record<string, string[]>,
): void {
  for (const token of ctx.tokens) {
    for (const f of argIndex[token] ?? []) {
      ctx.scorer.add(ctx.fullPath(f), 40, "argument_index", token);
    }
    for (const f of attrIndex[token] ?? []) {
      ctx.scorer.add(ctx.fullPath(f), 40, "attribute_index", token);
    }
  }
}

// ── 1g. example-token index (HCL code-block tokens) ─────────────────────
function stage1gExampleTokens(ctx: Ctx, exampleTokens: Record<string, string[]>): void {
  for (const token of ctx.tokens) {
    for (const f of exampleTokens[token] ?? []) {
      ctx.scorer.add(ctx.fullPath(f), 20, "example_token", token);
    }
    const upper = token.toUpperCase();
    if (upper !== token) {
      for (const f of exampleTokens[upper] ?? []) {
        ctx.scorer.add(ctx.fullPath(f), 20, "example_token", upper);
      }
    }
  }
}

// ── 1h. description substring match ─────────────────────────────────────
//
// Perf note (audit code-review/discover F-003): for an AWS-shaped manifest
// (~1300 resources + ~400 data-sources) the original implementation
// allocated a fresh ~1.7k-entry array via spread+Object.entries on every
// query AND lower-cased every description string per query. The lower-cased
// view is a pure function of the manifest, so we memoise it on a WeakMap
// keyed by the manifest object. First call per manifest pays the
// allocation; every subsequent query iterates the cached flat array.
interface DescEntry {
  file: string;
  desc: string; // lowercased, "" if absent / placeholder
}
const DESC_CACHE = new WeakMap<ProviderManifest, DescEntry[]>();
function getDescIndex(manifest: ProviderManifest): DescEntry[] {
  const cached = DESC_CACHE.get(manifest);
  if (cached) return cached;
  const out: DescEntry[] = [];
  const push = (entries: Record<string, ResourceEntry> | undefined): void => {
    if (!entries) return;
    for (const e of Object.values(entries)) {
      const d = (e.description ?? "").toLowerCase();
      if (!d || d === "|-") continue;
      out.push({ file: e.file, desc: d });
    }
  };
  push(manifest.resources ?? {});
  push(manifest.data_sources ?? {});
  DESC_CACHE.set(manifest, out);
  return out;
}

function stage1hDescription(ctx: Ctx, manifest: ProviderManifest): void {
  const index = getDescIndex(manifest);
  for (const { file, desc } of index) {
    for (const token of ctx.tokens) {
      if (token.length >= 4 && desc.includes(token)) {
        ctx.scorer.add(ctx.fullPath(file), 15, "description", token);
      }
    }
  }
}

// ── 1i. guides — intent-gated ───────────────────────────────────────────
function stage1iGuides(ctx: Ctx, guides: NonNullable<ProviderManifest["guides"]>): void {
  const queryIntents = new Set<string>();
  for (const t of ctx.tokens) if (INTENT_KEYWORDS.has(t)) queryIntents.add(t);
  if (queryIntents.size === 0) return;
  for (const [guideFile, meta] of Object.entries(guides)) {
    const tagsOverlap = (meta.intent_tags ?? []).some((t) => queryIntents.has(t));
    if (!tagsOverlap) continue;
    for (const resName of meta.referenced_resources ?? []) {
      if (ctx.tokens.some((t) => resName.includes(t))) {
        ctx.scorer.add(ctx.fullPath(guideFile), 45, "guide_link", resName);
      }
    }
  }
}

// ── 1j. bigram typo fallback (only when nothing else fired) ─────────────
function stage1jBigramTypo(ctx: Ctx, resourceBigrams: Record<string, string[]>): void {
  if (!ctx.scorer.isEmpty()) return;
  if (Object.keys(resourceBigrams).length === 0) return;
  for (const token of ctx.tokens) {
    if (token.length < 5) continue;
    const tb = new Set(bigrams(token));
    if (tb.size === 0) continue;
    const candidates: { overlap: number; resName: string }[] = collectBigramCandidates(
      tb,
      resourceBigrams,
    );
    candidates.sort((a, b) => b.overlap - a.overlap);
    for (const c of candidates.slice(0, 3)) {
      const entry = ctx.lookupAny(c.resName);
      if (entry) {
        ctx.scorer.add(ctx.fullPath(entry.file), 25, "bigram_typo", `${token}→${c.resName}`);
      }
    }
  }
}

function collectBigramCandidates(
  tb: Set<string>,
  resourceBigrams: Record<string, string[]>,
): { overlap: number; resName: string }[] {
  const candidates: { overlap: number; resName: string }[] = [];
  for (const [resName, rb] of Object.entries(resourceBigrams)) {
    let overlap = 0;
    const rbSet = new Set(rb);
    for (const bi of tb) if (rbSet.has(bi)) overlap++;
    if (overlap >= tb.size * 0.7) candidates.push({ overlap, resName });
  }
  return candidates;
}

// ── 1k. provider index page ─────────────────────────────────────────────
function stage1kProviderIndex(ctx: Ctx): void {
  for (const idx of ["index.md", "index.html.markdown"]) {
    const p = path.join(ctx.providerDir, idx);
    if (fs.existsSync(p)) ctx.scorer.add(p, 5, "provider_index", idx);
  }
}

// ── 1l. recommended_companions — uses pre-built fileToResource ──────────
function stage1lRecommendedCompanions(
  ctx: Ctx,
  recommendedCompanions: Record<string, string[]>,
  fileToResource: ReadonlyMap<string, string>,
): void {
  // Snapshot hits that exist BEFORE this stage; companion adds must not
  // feed back into themselves.
  const currentHits = Array.from(ctx.scorer.toMap().keys());
  const seenCompanions = new Set<string>();
  for (const hitPath of currentHits) {
    const hitFile = path.relative(ctx.providerDir, hitPath);
    const hitResource = fileToResource.get(hitFile);
    if (!hitResource) continue;
    const companions = recommendedCompanions[hitResource];
    if (!companions) continue;
    addCompanionBoosts(ctx, hitPath, hitResource, companions, seenCompanions);
  }
}

/** Companion contribution must not exceed 60% of the source resource's raw
 *  score. Boost amount depends on how the source resource was hit. */
function addCompanionBoosts(
  ctx: Ctx,
  hitPath: string,
  hitResource: string,
  companions: string[],
  seenCompanions: Set<string>,
): void {
  const sourceScored = ctx.scorer.toMap().get(hitPath);
  const hitReasons = new Set(sourceScored?.reasons.map((r) => r.kind) ?? []);
  const companionBoost = chooseCompanionBoost(hitReasons);
  const sourceScore = sourceScored?.score ?? 0;
  const cappedBoost = Math.min(companionBoost, sourceScore * 0.6);

  for (const companion of companions) {
    const dedupKey = `${hitResource}|${companion}`;
    if (seenCompanions.has(dedupKey)) continue;
    seenCompanions.add(dedupKey);
    const entry = ctx.lookupAny(companion);
    if (entry) {
      ctx.scorer.add(
        ctx.fullPath(entry.file),
        cappedBoost,
        "recommended_companion",
        `${hitResource}→${companion}`,
      );
    }
  }
}

function chooseCompanionBoost(hitReasons: Set<string>): number {
  if (hitReasons.has("exact_resource")) return 50;
  if (hitReasons.has("primary_resource")) return 30;
  return 20;
}

// ── alias-resource widening (concept aliases) ───────────────────────────
function stageAliasResource(ctx: Ctx, aliasMatches: AliasRewrite[] | undefined): void {
  if (!aliasMatches || aliasMatches.length === 0) return;
  const aliasSeen = new Set<string>();
  for (const a of aliasMatches) {
    for (const resName of a.resources) {
      const dedupKey = `${a.alias}|${resName}`;
      if (aliasSeen.has(dedupKey)) continue;
      aliasSeen.add(dedupKey);
      const entry = ctx.lookupAny(resName);
      if (entry) {
        ctx.scorer.add(ctx.fullPath(entry.file), 60, "alias_resource", `${a.alias}→${resName}`);
      }
    }
  }
}

function buildRecommendedCompanions(
  resources: Record<string, ResourceEntry>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, entry] of Object.entries(resources)) {
    if (entry.recommended_companions && entry.recommended_companions.length > 0) {
      out[name] = entry.recommended_companions;
    }
  }
  return out;
}

function resolveFileToResource(
  args: Tier1Args,
  resources: Record<string, ResourceEntry>,
  dataSources: Record<string, ResourceEntry>,
): ReadonlyMap<string, string> {
  if (args.fileToResource) return args.fileToResource;
  const local = new Map<string, string>();
  for (const [name, entry] of Object.entries(resources)) local.set(entry.file, name);
  for (const [name, entry] of Object.entries(dataSources)) local.set(entry.file, name);
  return local;
}

export function tier1(args: Tier1Args): ReadonlyMap<string, ScoredFile> {
  const ctx = buildCtx(args);
  const m = args.manifest;
  const synthetic = m.synthetic_subcategories ?? {};
  const hclRefs = m.hcl_references ?? {};
  const argIndex = m.argument_index ?? {};
  const attrIndex = m.attribute_index ?? {};
  const exampleTokens = m.example_tokens ?? {};
  const resourceBigrams = m.resource_bigrams ?? {};
  const guides = m.guides ?? {};
  const subcatKeywords = m.subcat_keywords ?? {};
  const primaryResources = m.primary_resources ?? {};
  const recommendedCompanions = buildRecommendedCompanions(ctx.resources);
  const fileToResource = resolveFileToResource(args, ctx.resources, ctx.dataSources);

  stage1aExactResource(ctx, hclRefs);
  stage1bSubcatKeyword(ctx, subcatKeywords);
  stagePrimaryResource(ctx, primaryResources);
  stage1cSynthetic(ctx, synthetic);
  stage1dSubcategorySubstring(ctx);
  stage1ePartialName(ctx);
  stage1fArgAttr(ctx, argIndex, attrIndex);
  stage1gExampleTokens(ctx, exampleTokens);
  stage1hDescription(ctx, m);
  stage1iGuides(ctx, guides);
  stage1jBigramTypo(ctx, resourceBigrams);
  stage1kProviderIndex(ctx);
  stage1lRecommendedCompanions(ctx, recommendedCompanions, fileToResource);
  stageAliasResource(ctx, args.aliasMatches);

  return ctx.scorer.toMap();
}
