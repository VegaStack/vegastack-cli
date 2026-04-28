// Public entry point for the discoverer (v0.1 envelope).
//
// Pipeline:
//   1. resolveCanonicalProviders + loadBundleRootManifest
//   2. detectProvider (confidence-scored)
//      • If ambiguous AND ≤4 candidate providers: fan out the rest of the
//        pipeline once per candidate via Promise.all and union the results
//        into a single "ok" envelope with `merged_from_providers` and a
//        comma-joined `provider`. Closes E9 §Recs #2 / A7. Falls back to
//        the legacy ambiguous envelope when the candidate set is >4 to
//        bound latency.
//   3. (per provider) loadAliases
//   4. (per provider) tokenize (alias-aware)
//   5. (per provider) loadManifest
//   6. (per provider) tier1 + tier2 in parallel via Promise.all
//   7. (per provider) mergeAndRank with canonical multiplier + length tie-break
//   8. (per provider) quality gate decides whether tier2 results actually
//      merge in
//   9. (per provider) enrichFiles attaches manifest_entry, example_usage,
//      score_norm
//  10. (per provider) loadKnowledge / loadRecipes — populated channels
//  11. final envelope (single provider OR merged across N providers)
//
// The output is the canonical DiscoverResult union — discriminated by `status`.

import { VegastackError } from "../errors.js";
import { aliasesToConceptMatches, loadAliases } from "./aliases.js";
import {
  DEFAULT_SERVICE_ALIASES,
  SCORE_NORM_TOP1_GATE,
  SCORE_NORM_TOP3_AVG_GATE,
  TIER1_CONFIDENCE_THRESHOLD,
  TIER1_MIN_RESULTS,
} from "./constants.js";
import { enrichFiles } from "./enrich.js";
import { buildIntents } from "./intents.js";
import { loadKnowledge } from "./knowledge.js";
import {
  distinctiveTokensFor,
  loadBundleRootManifest,
  loadManifest,
  providerDir as resolveProviderDir,
  resolveCanonicalProviders,
} from "./manifest.js";
import { mergeAndRank } from "./merge.js";
import { detectProvider } from "./provider.js";
import { loadRecipes } from "./recipes.js";
import { applyCanonicalMultiplier, normalizeScores } from "./scoring.js";
import { tier1 } from "./tier1.js";
import { tier2 } from "./tier2.js";
import { tokenizeWithAliases } from "./tokenize.js";
import type {
  ConceptAliasMatch,
  DiscoverArgs,
  DiscoverFile,
  DiscoverOk,
  DiscoverResult,
  DiscoverTimings,
  KnowledgeCard,
  RecipeMatch,
  ScoredFile,
} from "./types.js";

export type {
  DiscoverArgs,
  DiscoverFile,
  DiscoverResult,
  KnowledgeCard,
  RecipeMatch,
  ConceptAliasMatch,
} from "./types.js";

const DEFAULT_MAX = 20;

/** When the classifier reports ambiguous AND candidate count ≤ this, the
 *  discoverer fans out per-provider pipelines and unions results. Above
 *  this cap we keep the legacy `ambiguous` envelope to bound latency. */
const AUTO_MERGE_MAX_CANDIDATES = 4;

/** Run the discovery pipeline and return the v0.1 envelope. Async because
 *  tier1+tier2 can run in parallel via Promise.all. */
export async function discover(args: DiscoverArgs): Promise<DiscoverResult> {
  const t0 = nowMs();
  const { query, root } = args;
  const max = args.max ?? DEFAULT_MAX;
  const enrich = args.enrich ?? true;
  const debug = args.debug ?? false;
  const brief = args.brief ?? false;
  const fullExamples = args.fullExamples ?? false;

  const bundleRoot = loadBundleRootManifest(root);
  const bundleVersion =
    typeof bundleRoot.bundle_version === "string" && bundleRoot.bundle_version.length > 0
      ? bundleRoot.bundle_version
      : "unknown";
  const knownProviders = resolveCanonicalProviders(root);

  // ── Provider detection ──
  const tDetect0 = nowMs();
  let provider: string | undefined;
  let confidence = 0;
  if (args.provider !== undefined) {
    // F20: validate the user-supplied provider against the bundle's list.
    if (knownProviders.length > 0 && !knownProviders.includes(args.provider)) {
      return finalize({
        result: {
          status: "error",
          query,
          error: `unknown provider '${args.provider}'. Known providers: ${knownProviders.join(", ")}`,
          code: "ProviderUnknown",
        },
        t0,
        timings: zeroTimings(nowMs() - tDetect0),
        debug,
      });
    }
    provider = args.provider;
    confidence = 1.0;
  } else {
    // Build the distinctive_tokens map across known providers — used by the
    // classifier tiebreaker for "X cluster" / "X service" queries.
    // Also build a merged service-alias table from per-provider manifests so
    // that aliases like "atlas" → mongodb-atlas reach detectProvider even when
    // not present in DEFAULT_SERVICE_ALIASES. Closes C6 in the TS harness.
    const { distinctiveTokensByProvider, serviceAliases } = buildProviderDetectionData(
      root,
      knownProviders,
    );
    let det = detectProvider(query, { knownProviders, distinctiveTokensByProvider, serviceAliases });

    // ── Concept-alias phrase pre-detection (closes C6 / C4 in the TS harness) ──
    // If the confidence-based classifier failed to detect a provider, scan
    // all providers' aliases.yaml for phrase matches against the query. This
    // mirrors what Python's discover.py §3 "concept-alias phrase matching"
    // does. A phrase match from aliases.yaml scores 0.6 (alias-floor; see
    // detectProviderFromAliasFiles).
    //
    // closes S7 regression (E9-A7-crowdstrike-on-aws, E9-A7-do-app-cf-dns):
    // we previously also fired this layer when det.ambiguous and overrode
    // the ambiguous envelope with a single-provider win whenever the
    // alias-detected provider was already in the candidate set. That broke
    // multi-provider topology queries: "EC2 in our AWS org with CrowdStrike
    // Falcon" produced two canonical hits at 1.0 (aws + crowdstrike), the
    // alias phrase "falcon" then forced provider=crowdstrike, and the
    // auto-merge fanout never ran — losing the aws sub-envelope (containing
    // aws_ssm_association). The alias-file layer is a *fallback* for when
    // the classifier produced nothing — it must not collapse a legitimate
    // ambiguous result into a single provider.
    if (det.provider === undefined && !det.ambiguous) {
      const aliasDetect = detectProviderFromAliasFiles(query, root, knownProviders);
      if (aliasDetect) {
        det = {
          provider: aliasDetect.provider,
          score: aliasDetect.score,
          via: "alias",
          ambiguous: false,
        };
      }
    }

    // ── Multi-provider phrasing heuristic (closes S7 regression) ──
    // Even when the classifier produced a confident single-provider win,
    // the original query may explicitly name multiple providers via
    // connector-word patterns ("X on Y", "X with Y", "X via Y", etc.). In
    // that case we force `ambiguous` so the auto-merge fanout runs and
    // both providers' resources surface. See detectMultiProviderPhrasing
    // for the exact pattern set + anti-overtrigger guards.
    if (det.provider !== undefined && !det.ambiguous) {
      const multi = detectMultiProviderPhrasing(query, knownProviders, root);
      if (multi && multi.providers.length >= 2) {
        det = {
          score: det.score,
          ambiguous: true,
          candidates: multi.providers.map((p) => ({ provider: p, score: 0.9 })),
        };
      }
    } else if (det.ambiguous && det.candidates) {
      // When already ambiguous, let the multi-provider heuristic ENRICH the
      // candidate list with any additional providers the classifier may
      // have missed (e.g. "GitHub Actions OIDC to AWS" — github canonical
      // 1.0, aws canonical 1.0, both already there; no-op. But "Atlas on
      // GCP" — mongodb-atlas via alias 0.6, gcp canonical 1.0, may collapse
      // to gcp single-provider; the heuristic forces both.)
      const multi = detectMultiProviderPhrasing(query, knownProviders, root);
      if (multi && multi.providers.length >= 2) {
        const merged = new Map(det.candidates.map((c) => [c.provider, c.score] as const));
        for (const p of multi.providers) {
          if (!merged.has(p)) merged.set(p, 0.9);
        }
        det = {
          score: det.score,
          ambiguous: true,
          candidates: Array.from(merged.entries()).map(([provider, score]) => ({
            provider,
            score,
          })),
        };
      }
    }

    if (det.ambiguous && det.candidates) {
      const detectMs = nowMs() - tDetect0;
      const candidates = det.candidates;

      // ── Auto-merge: ≤4 candidates → fan out and union ──
      if (candidates.length > 0 && candidates.length <= AUTO_MERGE_MAX_CANDIDATES) {
        const candidateProviders = candidates.map((c) => c.provider);
        const perProvider = await Promise.all(
          candidateProviders.map((p) =>
            runProviderPipeline({
              query,
              provider: p,
              providerConfidence: candidates.find((c) => c.provider === p)?.score ?? 0,
              root,
              max,
              enrich,
              brief,
              fullExamples,
            }),
          ),
        );
        // Filter out any provider whose pipeline failed (e.g. malformed
        // manifest) — degrade rather than fail the whole call.
        const oks = perProvider.filter(
          (r): r is { kind: "ok"; envelope: DiscoverOkEnvelope; timings: ProviderTimings } =>
            r.kind === "ok",
        );

        if (oks.length === 0) {
          // No pipeline produced a usable result — fall through to the
          // legacy ambiguous envelope.
          const recipes = await safeLoadRecipes({
            bundleRoot: root,
            tokens: [],
            query,
          });
          return finalize({
            result: {
              status: "ambiguous",
              query,
              tokens: [],
              candidate_providers: candidates,
              recipes,
              hint: "Use --provider <name> to disambiguate.",
            },
            t0,
            timings: zeroTimings(detectMs),
            debug,
          });
        }

        const merged = mergeOkEnvelopes(
          oks.map((r) => r.envelope),
          {
            query,
            bundleVersion,
            max,
          },
        );

        return finalize({
          result: merged,
          t0,
          timings: aggregateTimings(
            detectMs,
            oks.map((r) => r.timings),
          ),
          debug,
        });
      }

      // ── Legacy: candidate count > AUTO_MERGE_MAX_CANDIDATES ──
      // Recipes that span the candidate set still surface here.
      const recipes = await safeLoadRecipes({
        bundleRoot: root,
        tokens: [],
        query,
      });
      return finalize({
        result: {
          status: "ambiguous",
          query,
          tokens: [],
          candidate_providers: candidates,
          recipes,
          hint: "Use --provider <name> to disambiguate.",
        },
        t0,
        timings: zeroTimings(detectMs),
        debug,
      });
    }
    if (det.provider !== undefined) {
      provider = det.provider;
      confidence = det.score;
    }
  }
  const detectMs = nowMs() - tDetect0;

  if (provider === undefined) {
    return finalize({
      result: {
        status: "error",
        query,
        error: "Could not detect provider from query. Pass --provider explicitly.",
        code: "ProviderUndetected",
      },
      t0,
      timings: zeroTimings(detectMs),
      debug,
    });
  }

  // ── Single-provider pipeline ──
  const result = await runProviderPipeline({
    query,
    provider,
    providerConfidence: confidence,
    root,
    max,
    enrich,
    brief,
    fullExamples,
  });

  if (result.kind === "error") {
    return finalize({
      result: result.envelope,
      t0,
      timings: zeroTimings(detectMs),
      debug,
    });
  }

  // Surface the bundle-version warning at the top level (single-provider
  // mode only — the merged path adds its own warnings).
  if (bundleVersion === "unknown") {
    const ws = result.envelope.warnings ?? [];
    ws.push("bundle_version unknown (bundle root MANIFEST.json missing or malformed)");
    result.envelope.warnings = ws;
  }

  return finalize({
    result: result.envelope,
    t0,
    timings: {
      ...result.timings,
      detect_provider_ms: detectMs,
      total_ms: 0,
    },
    debug,
  });
}

/** Synchronous variant retained for tests / scripts that don't want to await
 *  every call. Internally awaits the async pipeline. */
export function discoverSync(args: DiscoverArgs): Promise<DiscoverResult> {
  return discover(args);
}

// ─── Per-provider pipeline ───────────────────────────────────────────────

interface ProviderPipelineArgs {
  query: string;
  provider: string;
  providerConfidence: number;
  root: string;
  max: number;
  enrich: boolean;
  /** E1: brief mode — strips manifest_entry/example_usage, adds name field. */
  brief: boolean;
  /** E2: fullExamples mode — restores full example_usage content. */
  fullExamples: boolean;
}

interface ProviderTimings {
  tokenize_ms: number;
  tier1_ms: number;
  tier2_ms: number;
  enrich_ms: number;
  load_knowledge_ms: number;
  load_recipes_ms: number;
  load_aliases_ms: number;
  merge_ms: number;
}

/** A DiscoverOk envelope WITH the `status: "ok"` discriminator attached.
 * @internal Exported so the unit test for mergeOkEnvelopes can construct
 * synthetic envelopes without going through the full discover() pipeline. */
export type DiscoverOkEnvelope = { status: "ok" } & DiscoverOk;

type ProviderPipelineResult =
  | { kind: "ok"; envelope: DiscoverOkEnvelope; timings: ProviderTimings }
  | { kind: "error"; envelope: Extract<DiscoverResult, { status: "error" }> };

/** Runs the post-detection pipeline for a single provider. Used directly
 *  for single-provider queries and via Promise.all for ambiguous-merge. */
async function runProviderPipeline(args: ProviderPipelineArgs): Promise<ProviderPipelineResult> {
  const { query, provider, providerConfidence, root, max, enrich, brief, fullExamples } = args;

  // ── Alias load ──
  const tAlias0 = nowMs();
  const allAliases = loadAliases({ bundleRoot: root, provider });
  const aliasMs = nowMs() - tAlias0;

  // ── Tokenize (alias-aware) ──
  const tTok0 = nowMs();
  const { tokens, aliasMatches } = tokenizeWithAliases(query, provider, { aliases: allAliases });
  const tokenizeMs = nowMs() - tTok0;

  // ── Manifest load ──
  const dir = resolveProviderDir(root, provider);
  let manifest;
  try {
    manifest = loadManifest(dir);
  } catch (e) {
    if (e instanceof VegastackError) {
      return {
        kind: "error",
        envelope: {
          status: "error",
          query,
          error: e.message,
          code: e.kind,
        },
      };
    }
    throw e;
  }

  // ── Tier 1 + Tier 2 in parallel ──
  const tT1_0 = nowMs();
  const tT2_0 = nowMs();
  const [t1, t2Result] = await Promise.all([
    Promise.resolve(
      tier1({
        manifest,
        tokens,
        provider,
        providerDir: dir,
        aliasMatches,
      }),
    ),
    Promise.resolve(tier2({ tokens, provider, providerDir: dir })),
  ]);
  const tier1Ms = nowMs() - tT1_0;
  const tier2Ms = nowMs() - tT2_0;

  // Quality gate.
  const provisionalRanked = Array.from(t1.entries())
    .map(([p, sf]) => ({ path: p, score: sf.score, reasons: sf.reasons, tier: sf.tier }))
    .sort((a, b) => b.score - a.score);
  const provisionalNorms = normalizeScores(
    new Map(provisionalRanked.map((r) => [r.path, { score: r.score }] as const)),
  );
  const top1Norm = provisionalRanked[0]
    ? (provisionalNorms.get(provisionalRanked[0].path) ?? 0)
    : 0;
  const top3Avg = avgNorm(provisionalRanked.slice(0, 3), provisionalNorms);
  const tier1MeetsQuality = top1Norm >= SCORE_NORM_TOP1_GATE && top3Avg >= SCORE_NORM_TOP3_AVG_GATE;
  const t2: ReadonlyMap<string, ScoredFile> = tier1MeetsQuality ? new Map() : t2Result;

  // ── Merge + canonical multiplier + rank ──
  const tMerge0 = nowMs();
  const merged = mergeAndRank(t1, t2, Number.MAX_SAFE_INTEGER);
  const boostedMap = applyCanonicalMultiplier(new Map(merged.map((r) => [r.path, r] as const)));
  const ranked = merged
    .map((r) => {
      const boosted = boostedMap.get(r.path);
      return boosted ? { ...r, score: boosted.score, reasons: boosted.reasons } : r;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    })
    .slice(0, max);
  const mergeMs = nowMs() - tMerge0;

  // ── E3: Auto short-circuit for high-confidence single-resource queries ──
  // Token-saving optimization: when the top result is dominant (score_norm > 90)
  // and the second result is weak (score_norm < 50), return only the top result
  // rather than K also-rans. This fires on ~60-70% of A1+A2+A3 style queries.
  // Override: if the user explicitly passed --max N (args.max !== undefined),
  // do NOT short-circuit — respect the user's request for K results.
  let shortCircuitRanked = ranked;
  if (args.max === undefined && ranked.length >= 1) {
    const provisionalNormsForSC = normalizeScores(
      new Map(ranked.map((r) => [r.path, { score: r.score }] as const)),
    );
    const top1NormSC = provisionalNormsForSC.get(ranked[0]!.path) ?? 0;
    const top2NormSC = ranked[1] ? (provisionalNormsForSC.get(ranked[1].path) ?? 0) : 0;
    if (top1NormSC > 90 && (ranked[1] === undefined || top2NormSC < 50)) {
      shortCircuitRanked = ranked.slice(0, 1);
    }
  }

  // ── Enrichment ──
  const tEnrich0 = nowMs();
  const { files } = enrichFiles({ ranked: shortCircuitRanked, manifest, providerDir: dir, enrich, brief, fullExamples });
  const enrichMs = nowMs() - tEnrich0;

  // ── Channel loaders ──
  const tKnow0 = nowMs();
  const tRec0 = nowMs();
  const [knowledge, recipes] = await Promise.all([
    Promise.resolve(loadKnowledge({ bundleRoot: root, tokens, query, provider })),
    safeLoadRecipes({ bundleRoot: root, tokens, query, provider }),
  ]);
  const knowledgeMs = nowMs() - tKnow0;
  const recipesMs = nowMs() - tRec0;

  // ── Compose envelope ──
  const tiersUsed: ("manifest" | "grep" | "alias" | "knowledge" | "recipe")[] = ["manifest"];
  if (t2.size > 0) tiersUsed.push("grep");
  if (aliasMatches.length > 0) tiersUsed.push("alias");
  if (knowledge.length > 0) tiersUsed.push("knowledge");
  if (recipes.length > 0) tiersUsed.push("recipe");

  const intents = buildIntents(shortCircuitRanked);
  const conceptAliasesUsed = aliasesToConceptMatches(aliasMatches);
  const citations = Array.from(
    new Set([
      ...files.map((f) => f.path),
      ...knowledge.map((k) => k.id),
      ...recipes.map((r) => r.id),
    ]),
  );

  const envelope: DiscoverOkEnvelope = {
    status: "ok",
    query,
    provider,
    provider_confidence: round2(providerConfidence),
    tokens,
    tiers_used: tiersUsed,
    schema_version: 1,
    bundle_version: "", // filled by caller
    files,
    knowledge,
    recipes,
    concept_aliases_used: conceptAliasesUsed,
    citations,
    count: files.length,
    // E1: Signal the mode so consumers can branch without inspecting files[].
    mode: brief ? "brief" : "full",
  };
  if (intents.length > 0) envelope.intents = intents;

  // The caller fills in bundle_version (single-provider mode) or the merge
  // helper fills it in (multi-provider mode). Default here for safety:
  // populate from the manifest's bundle_version field if present.
  if (typeof manifest.bundle_version === "string" && manifest.bundle_version.length > 0) {
    envelope.bundle_version = manifest.bundle_version;
  }

  return {
    kind: "ok",
    envelope,
    timings: {
      tokenize_ms: tokenizeMs,
      tier1_ms: tier1Ms,
      tier2_ms: tier2Ms,
      enrich_ms: enrichMs,
      load_knowledge_ms: knowledgeMs,
      load_recipes_ms: recipesMs,
      load_aliases_ms: aliasMs,
      merge_ms: mergeMs,
    },
  };
}

// ─── Auto-merge of ambiguous-fanout envelopes ────────────────────────────

/** @internal Exported so the unit test for mergeOkEnvelopes can call it directly. */
export interface MergeOpts {
  query: string;
  bundleVersion: string;
  max: number;
}

/** Union the per-provider DiscoverOkEnvelope envelopes into a single envelope.
 *  - `provider` becomes the comma-joined sorted provider list.
 *  - `provider_confidence` is the mean of per-provider confidences.
 *  - `merged_from_providers` is the alphabetically sorted provider list.
 *  - files[] are unioned by path (keep highest-scoring), sorted by
 *    score_norm desc then raw score desc, capped at `max`.
 *  - knowledge[]/recipes[] unioned by id, sorted alphabetically.
 *  - concept_aliases_used / citations / tokens / tiers_used / warnings
 *    unioned with order preservation (or sort where the contract sorts).
 */
/** @internal Exported for unit-testing the per-provider quota logic.
 *  Not part of the public API surface — do NOT import from application code. */
export function mergeOkEnvelopes(envelopes: DiscoverOkEnvelope[], opts: MergeOpts): DiscoverOkEnvelope {
  const { query, bundleVersion, max } = opts;

  const sortedProviders = [...envelopes.map((e) => e.provider)].sort((a, b) => a.localeCompare(b));
  const meanConfidence =
    envelopes.reduce((s, e) => s + e.provider_confidence, 0) / envelopes.length;

  // Union files[] — per-provider quota applied BEFORE merging so that a
  // dominant provider (e.g. cloudflare returning 15 high-scoring files) can't
  // squeeze out resources from smaller providers (vault, vercel) that the
  // topology query explicitly requests.
  //
  // P5 regressions.md items #2–#5 (E9-A5-clickhouse-soft-deps,
  // E9-A7-pinecone-vault-1password, E9-A7-vercel-cloudflare-workers-ab,
  // E9-A7-auth0-action-external-claim): pre-P1, the Python runner re-ran
  // each provider independently with --max 15, so each provider got 15
  // slots; the union could be up to 45 files before the top-k cut.  Post-P1,
  // native mergeOkEnvelopes applied the global `max` cap over the combined
  // pool, letting the largest provider sweep most slots.
  //
  // Fix: give each provider a quota of ceil(max / N) + 2 slots before
  // pooling.  The +2 buffer ensures that near-threshold resources from
  // well-matched providers are included in the re-rank pool even when N
  // divides unevenly.  The global `max` cap is still enforced on the merged
  // output, so the envelope size contract is respected.
  const N = envelopes.length;
  const quota = Math.ceil(max / N) + 2;
  const filesByPath = new Map<string, DiscoverFile>();
  for (const env of envelopes) {
    // Take top-`quota` from this provider's already-ranked files[].
    const providerSlice = env.files.slice(0, quota);
    for (const f of providerSlice) {
      const cur = filesByPath.get(f.path);
      if (!cur || f.score > cur.score) filesByPath.set(f.path, f);
    }
  }
  const allFiles = Array.from(filesByPath.values()).sort((a, b) => {
    if (b.score_norm !== a.score_norm) return b.score_norm - a.score_norm;
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });
  const cappedFiles = allFiles.slice(0, max);

  // Union knowledge[] and recipes[] by id.
  const knowledgeById = new Map<string, KnowledgeCard>();
  for (const env of envelopes) for (const k of env.knowledge) knowledgeById.set(k.id, k);
  const knowledge = Array.from(knowledgeById.values()).sort((a, b) => a.id.localeCompare(b.id));

  const recipesById = new Map<string, RecipeMatch>();
  for (const env of envelopes) for (const r of env.recipes) recipesById.set(r.id, r);
  const recipes = Array.from(recipesById.values()).sort((a, b) => a.id.localeCompare(b.id));

  // Union concept_aliases_used preserving first-seen order, dedup by
  // (provider, matched_alias).
  const aliasesSeen = new Set<string>();
  const concept_aliases_used: ConceptAliasMatch[] = [];
  for (const env of envelopes) {
    for (const a of env.concept_aliases_used) {
      const k = `${a.provider}|${a.matched_alias}`;
      if (aliasesSeen.has(k)) continue;
      aliasesSeen.add(k);
      concept_aliases_used.push(a);
    }
  }

  // Union tokens preserving first-seen order.
  const tokenSet = new Set<string>();
  const tokens: string[] = [];
  for (const env of envelopes) {
    for (const t of env.tokens) {
      if (tokenSet.has(t)) continue;
      tokenSet.add(t);
      tokens.push(t);
    }
  }

  // Union tiers_used (preserve canonical order: manifest, grep, alias,
  // knowledge, recipe).
  const TIER_ORDER: ("manifest" | "grep" | "alias" | "knowledge" | "recipe")[] = [
    "manifest",
    "grep",
    "alias",
    "knowledge",
    "recipe",
  ];
  const tierSet = new Set<string>();
  for (const env of envelopes) for (const t of env.tiers_used) tierSet.add(t);
  const tiers_used = TIER_ORDER.filter((t) => tierSet.has(t));

  // Citations are derived from files / knowledge / recipes — recompute on
  // the merged set so the contract holds.
  const citations = Array.from(
    new Set([
      ...cappedFiles.map((f) => f.path),
      ...knowledge.map((k) => k.id),
      ...recipes.map((r) => r.id),
    ]),
  );

  // Union warnings, preserving first-seen order.
  const warningSet = new Set<string>();
  const warnings: string[] = [];
  for (const env of envelopes) {
    for (const w of env.warnings ?? []) {
      if (warningSet.has(w)) continue;
      warningSet.add(w);
      warnings.push(w);
    }
  }
  if (bundleVersion === "unknown") {
    const w = "bundle_version unknown (bundle root MANIFEST.json missing or malformed)";
    if (!warningSet.has(w)) warnings.push(w);
  }

  // Union intents — keep all, dedup by (intent, files-key).
  const intentsSeen = new Set<string>();
  const intents: NonNullable<DiscoverOk["intents"]> = [];
  for (const env of envelopes) {
    for (const i of env.intents ?? []) {
      const key = `${i.intent}|${[...i.files].sort().join(",")}`;
      if (intentsSeen.has(key)) continue;
      intentsSeen.add(key);
      intents.push(i);
    }
  }

  const out: DiscoverOkEnvelope = {
    status: "ok",
    query,
    provider: sortedProviders.join(","),
    provider_confidence: round2(meanConfidence),
    tokens,
    tiers_used,
    schema_version: 1,
    bundle_version: bundleVersion,
    files: cappedFiles,
    knowledge,
    recipes,
    concept_aliases_used,
    citations,
    count: cappedFiles.length,
    merged_from_providers: sortedProviders,
  };
  if (intents.length > 0) out.intents = intents;
  if (warnings.length > 0) out.warnings = warnings;
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function safeLoadRecipes(args: Parameters<typeof loadRecipes>[0]) {
  try {
    return loadRecipes(args);
  } catch {
    return [];
  }
}

/** Detect multi-provider phrasing in the original query. Closes S7 regression
 *  pair (E9-A7-crowdstrike-on-aws, E9-A7-do-app-cf-dns) where the query
 *  explicitly names two providers via connector-words ("X on Y", "X with Y",
 *  etc.) but a single-provider classification was winning, suppressing the
 *  auto-merge fallback that would have surfaced the second provider's
 *  resources.
 *
 *  Algorithm:
 *    1. Scan the query (preserving connector words — NOT tokenized) for a
 *       small set of patterns that strongly signal multi-provider topology.
 *    2. For each side of each pattern, resolve to a provider via the same
 *       lookup the main classifier uses (canonical name, service-alias
 *       table, alias-file phrase). If BOTH sides resolve to a known
 *       provider AND they're distinct, count as a multi-provider pair.
 *    3. Return the deterministic ordered list of providers (first-mention
 *       wins), capped at AUTO_MERGE_MAX_CANDIDATES.
 *
 *  Anti-overtrigger guards:
 *    • The right-hand side of a pattern must resolve to a *known* provider
 *      via canonical/alias/distinctive lookup. Generic nouns like "bare
 *      metal", "config map", "versioning" do NOT resolve, so phrases like
 *      "kubernetes cluster on bare metal" / "S3 bucket with versioning"
 *      stay single-provider.
 *    • Cloudflare-internal product names (D1, R2, KV, Workers) are NOT
 *      separate providers in the bundle, so "Cloudflare Workers + D1 + R2"
 *      stays single-provider.
 *    • A pattern only contributes when the matched provider differs from
 *      every other matched provider — same-provider mentions don't count.
 */
export interface MultiProviderDetection {
  multiProvider: true;
  providers: string[];
}

/** Connector words/punctuation that signal multi-provider topology when
 *  they appear BETWEEN two provider mentions. Carefully curated — adding
 *  generic prepositions like "for" or "of" would over-trigger. */
const MULTI_PROVIDER_CONNECTORS: readonly RegExp[] = [
  /\bon\b/,
  /\bwith\b/,
  /\bvia\b/,
  /\busing\b/,
  /\bbehind\b/,
  /\bplus\b/,
  /\band\b/,
  /\bto\b/,
  /\bin\s+front\s+of\b/,
  /\bpointed\s+(?:via|to|at)\b/,
  /\+/, // explicit plus sign as connector ("AWS + GCP")
  /,/, // comma as Oxford-list connector
];

export function detectMultiProviderPhrasing(
  query: string,
  knownProviders: readonly string[],
  bundleRoot?: string,
): MultiProviderDetection | undefined {
  const q = query.toLowerCase();

  const knownSet = new Set(knownProviders);
  const aliasMap = new Map<string, string>(DEFAULT_SERVICE_ALIASES);
  const substringPhrases = [
    ["mongodb atlas", "mongodb-atlas"],
    ["redis cloud", "redis-cloud"],
    ["1 password", "1password"],
    ["digital ocean", "digitalocean"],
  ] as const;

  // Per-bundle alias files (e.g. "falcon" → crowdstrike). Loaded once.
  const aliasFilePhrases: { phrase: string; provider: string }[] = [];
  if (bundleRoot !== undefined) {
    for (const p of knownProviders) {
      try {
        for (const a of loadAliases({ bundleRoot, provider: p })) {
          aliasFilePhrases.push({ phrase: a.phrase.toLowerCase(), provider: p });
        }
      } catch {
        /* skip malformed alias file */
      }
    }
    // Sort alias phrases by length desc so longer phrases match first
    // (prefer "cloudflare dns" over "dns" alone).
    aliasFilePhrases.sort((a, b) => b.phrase.length - a.phrase.length);
  }

  // ── Step 1: Find every provider mention in the query along with its
  // [start, end) position. Mentions overlap by intent — a longer mention
  // wins over a shorter one at the same position (e.g. "mongodb atlas"
  // beats "mongodb"). After collecting, we drop overlapping mentions
  // greedily by length descending so each character of the query belongs
  // to at most one mention.
  interface Mention {
    provider: string;
    start: number;
    end: number;
  }
  const raw: Mention[] = [];

  // Canonical names (word-boundary).
  for (const provider of knownProviders) {
    const rx = new RegExp(`(?<![a-z0-9])${escapeRegExpLocal(provider)}(?![a-z0-9])`, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(q)) !== null) {
      raw.push({ provider, start: m.index, end: m.index + m[0].length });
    }
  }
  // PROVIDER_SUBSTRING phrases.
  for (const [phrase, provider] of substringPhrases) {
    const rx = new RegExp(`(?<![a-z0-9])${escapeRegExpLocal(phrase)}(?![a-z0-9])`, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(q)) !== null) {
      raw.push({ provider, start: m.index, end: m.index + m[0].length });
    }
  }
  // Service-alias table — only when the alias resolves to a known provider.
  for (const [alias, provider] of aliasMap) {
    if (!knownSet.has(provider)) continue;
    const rx = new RegExp(`\\b${escapeRegExpLocal(alias)}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(q)) !== null) {
      raw.push({ provider, start: m.index, end: m.index + m[0].length });
    }
  }
  // Alias-file phrases (e.g. "falcon" for crowdstrike, "cloudflare dns").
  for (const { phrase, provider } of aliasFilePhrases) {
    if (!knownSet.has(provider)) continue;
    let from = 0;
    for (;;) {
      const idx = q.indexOf(phrase, from);
      if (idx === -1) break;
      // Word-boundary check on both sides (prevent matching mid-word).
      const before = idx === 0 ? " " : q[idx - 1]!;
      const after = idx + phrase.length >= q.length ? " " : q[idx + phrase.length]!;
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
        raw.push({ provider, start: idx, end: idx + phrase.length });
      }
      from = idx + 1;
    }
  }

  if (raw.length < 2) return undefined;

  // Resolve overlaps: longest first, drop later matches that overlap.
  raw.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: Mention[] = [];
  for (const r of raw) {
    const conflicts = accepted.some(
      (a) => !(r.end <= a.start || r.start >= a.end),
    );
    if (!conflicts) accepted.push(r);
  }
  // Sort by start for downstream connector lookup.
  accepted.sort((a, b) => a.start - b.start);

  // Distinct provider count check — same provider mentioned twice doesn't
  // count as multi-provider.
  const distinctProviders = new Set(accepted.map((m) => m.provider));
  if (distinctProviders.size < 2) return undefined;

  // ── Step 2: Verify that AT LEAST ONE pair of distinct-provider mentions
  // is separated only by a connector pattern. This is the critical
  // anti-overtrigger guard: two providers floating around in the query
  // with no syntactic connection should not auto-trigger merge.
  let hasConnector = false;
  for (let i = 0; i < accepted.length - 1; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      const a = accepted[i]!;
      const b = accepted[j]!;
      if (a.provider === b.provider) continue;
      // Inspect the substring strictly BETWEEN the two mentions.
      const between = q.slice(a.end, b.start);
      // Reject if the between-segment is too long (likely two unrelated
      // sentences) — cap at ~80 chars (covers "AWS account with Falcon
      // Cloud Security, set up an SSM association to install the sensor").
      if (between.length > 80) continue;
      for (const rx of MULTI_PROVIDER_CONNECTORS) {
        if (rx.test(between)) {
          hasConnector = true;
          break;
        }
      }
      if (hasConnector) break;
    }
    if (hasConnector) break;
  }
  if (!hasConnector) return undefined;

  // ── Step 3: Return distinct providers in first-mention order, capped.
  const seen = new Map<string, number>();
  for (const m of accepted) {
    if (!seen.has(m.provider)) seen.set(m.provider, m.start);
  }
  const ordered = Array.from(seen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p)
    .slice(0, AUTO_MERGE_MAX_CANDIDATES);

  return { multiProvider: true, providers: ordered };
}

const RX_ESCAPE_LOCAL = /[.*+?^${}()|[\]\\]/g;
function escapeRegExpLocal(s: string): string {
  return s.replace(RX_ESCAPE_LOCAL, "\\$&");
}

/** Scan all providers' aliases.yaml for phrase matches against the query.
 *  Returns the provider with the highest-priority phrase match, or undefined
 *  when no phrase fires. Mirrors Python discover.py's concept-alias detection
 *  layer (closes C6 in the TS harness).
 *
 *  Confidence: 0.6.
 *
 *  closes S7 regression: phrase-substring matches are softer signals than
 *  canonical/distinctive_token, so they should not dominate when a second
 *  provider also matches at >=0.6 (which triggers auto-merge via the existing
 *  best-second_best<0.2 ambiguity rule). Specifically:
 *    • E9-A7-crowdstrike-on-aws (P5 0.667 → S7 0.333): phrase "falcon"
 *      matched crowdstrike's aliases.yaml at 0.65, beating aws (canonical
 *      conf 1.0) only because the alias-file path happens AFTER ambiguous
 *      detection. By emitting 0.6 instead of 0.65 we stay at-or-below the
 *      alias-floor so this layer cannot solo-win when canonical aws is in
 *      play.
 *    • E9-A7-do-app-cf-dns (P5 0.667 → S7 0.333): same mechanism for
 *      cloudflare_dns / digitalocean.
 *  When multiple providers match, returns the first one with the most
 *  specific (longest) phrase match. */
function detectProviderFromAliasFiles(
  query: string,
  bundleRoot: string,
  providers: readonly string[],
): { provider: string; score: number } | undefined {
  const q = query.toLowerCase();
  let best: { provider: string; score: number; phraseLen: number } | undefined;

  for (const p of providers) {
    const aliases = loadAliases({ bundleRoot, provider: p });
    for (const alias of aliases) {
      const phrase = alias.phrase.toLowerCase();
      if (q.includes(phrase)) {
        // Longer phrase = more specific = preferred.
        if (!best || phrase.length > best.phraseLen) {
          best = { provider: p, score: 0.6, phraseLen: phrase.length };
        }
      }
    }
  }

  return best ? { provider: best.provider, score: best.score } : undefined;
}

/** Build per-provider detection data (distinctive_tokens + service aliases)
 *  for the classifier. Loads each provider's MANIFEST.json once (cached by
 *  mtime via loadManifest). Skips providers whose manifest is missing or
 *  malformed — degrades gracefully rather than throwing. Closes C6 in the
 *  TS harness: manifest service_aliases now reach detectProvider so that
 *  aliases like "atlas" → mongodb-atlas register before the tiebreaker. */
function buildProviderDetectionData(
  bundleRoot: string,
  providers: readonly string[],
): {
  distinctiveTokensByProvider: Map<string, Set<string>>;
  serviceAliases: (readonly [string, string])[];
} {
  const distinctiveTokensByProvider = new Map<string, Set<string>>();
  // Seed with DEFAULT_SERVICE_ALIASES so that hard-coded entries are always
  // present even when a manifest doesn't ship the full table.
  const serviceAliasSet = new Map<string, string>(DEFAULT_SERVICE_ALIASES);

  for (const p of providers) {
    try {
      const m = loadManifest(resolveProviderDir(bundleRoot, p));
      distinctiveTokensByProvider.set(p, distinctiveTokensFor(m, p));
      // Merge manifest service_aliases into the detection table.
      // Keys may be compound (e.g. "atlas_cluster_cost") or simple (e.g.
      // "atlas", "d1"). detectProvider uses a word-boundary regex so compound
      // keys only fire when the full compound string appears verbatim in the
      // query — harmless for our use case.
      for (const alias of Object.keys(m.service_aliases ?? {})) {
        if (!serviceAliasSet.has(alias)) serviceAliasSet.set(alias, p);
      }
    } catch {
      // Bundle missing or malformed for this provider — skip silently.
    }
  }

  return {
    distinctiveTokensByProvider,
    serviceAliases: Array.from(serviceAliasSet.entries()),
  };
}

function avgNorm(files: { path: string }[], norms: ReadonlyMap<string, number>): number {
  if (files.length === 0) return 0;
  let sum = 0;
  for (const f of files) sum += norms.get(f.path) ?? 0;
  return sum / files.length;
}

/** Aggregate per-provider timings into a single DiscoverTimings envelope.
 *  Sums sub-stage timings (so callers see the total work performed across
 *  the fanout, not just one provider's portion). */
function aggregateTimings(detectMs: number, perProvider: ProviderTimings[]): DiscoverTimings {
  const sum = (k: keyof ProviderTimings): number =>
    perProvider.reduce((s, t) => s + (t[k] ?? 0), 0);
  return {
    total_ms: 0,
    detect_provider_ms: detectMs,
    tokenize_ms: sum("tokenize_ms"),
    tier1_ms: sum("tier1_ms"),
    tier2_ms: sum("tier2_ms"),
    enrich_ms: sum("enrich_ms"),
    load_knowledge_ms: sum("load_knowledge_ms"),
    load_recipes_ms: sum("load_recipes_ms"),
    load_aliases_ms: sum("load_aliases_ms"),
    merge_ms: sum("merge_ms"),
  };
}

function nowMs(): number {
  return performance.now();
}

function zeroTimings(detectMs: number, tokenizeMs = 0, aliasMs = 0): DiscoverTimings {
  return {
    total_ms: 0,
    tokenize_ms: tokenizeMs,
    detect_provider_ms: detectMs,
    tier1_ms: 0,
    tier2_ms: 0,
    enrich_ms: 0,
    load_knowledge_ms: 0,
    load_recipes_ms: 0,
    load_aliases_ms: aliasMs,
  };
}

function finalize(args: {
  result: DiscoverResult;
  t0: number;
  timings: DiscoverTimings;
  debug: boolean;
}): DiscoverResult {
  args.timings.total_ms = round1(performance.now() - args.t0);
  for (const k of Object.keys(args.timings) as (keyof DiscoverTimings)[]) {
    const v = args.timings[k];
    if (typeof v === "number") (args.timings as unknown as Record<string, number>)[k] = round1(v);
  }
  if (args.debug && args.result.status === "ok") {
    args.result.timings = args.timings;
  }
  return args.result;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export the tunables for tests / docs.
export { TIER1_CONFIDENCE_THRESHOLD, TIER1_MIN_RESULTS };
