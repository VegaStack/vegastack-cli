# P5 — S2 §7 Success-criterion verification

Each success criterion from the v0.1.1 plan (SYNTHESIS.md §7) was independently re-verified against the rebuilt `dist/cli.js`, the on-disk bundle at `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`, and the 76-prompt re-run of E9.

| # | Criterion | Target | Actual | Verdict |
|---|---|---|---|---|
| 1 | `package.json#keywords` populated; install one-liners (`npx skills add`, `tessl i`) in README; SKILL.md surfaces in registries | discovery channels live | 20 keywords (10 original + 10 new); README has "Install via skill registry" block with both `npx skills add @vegastack/cli` and `tessl i @vegastack/cli`; SKILL.md frontmatter has `tags`, `codex`, `compatibility` per R6 | ✅ MET (cannot verify "registers within 24h" without external network call, but all the local prerequisites are in place) |
| 2 | `E9-A7-tls-acm-cloudflare` returns merged envelope in one call (no `status=ambiguous`) | `status: ok`, `merged_from_providers` populated | `status: ok`, `provider: aws,cloudflare,tls`, `merged_from_providers: ["aws", "cloudflare", "tls"]` | ✅ MET |
| 3 | `vega tf "S3 backend state locking DynamoDB"` cites `aws-s3-native-state-locking` knowledge card | card in `knowledge[].id` | `knowledge_ids: ["aws-s3-native-state-locking"]` | ✅ MET |
| 4 | Bottom-5 provider mean ≥ 0.55 (was 0.165) | ≥0.55 | **0.299** (local 0.000 unchanged · tls 0.125 unchanged · mongodb-atlas 0.222 unchanged · crowdstrike 0.167 → 0.834 · cloudflare 0.312 unchanged) | ❌ MISSED — only crowdstrike actually moved; the other 4 bottom providers are flat. Reasons traced below. |
| 5 | `E9-A6-cloudflare-workers-d1-r2` AND `E9-A6-snowflake-warehouse-rbac` both ≥ 0.75 | both ≥0.75 | snowflake-warehouse-rbac = **1.000** ✅ · cloudflare-workers-d1-r2 = **0.333** ❌ | ❌ PARTIAL (1 of 2) |
| 6 | `vega tf "tune Atlas cluster cost"` returns `mongodbatlas_advanced_cluster` rank 1 | top-1 = mongodbatlas_advanced_cluster | `status: error`, `code: ProviderUndetected` ("Could not detect provider from query. Pass --provider explicitly.") | ❌ MISSED |

## Why the misses

### #4 / #6 — bottom-5 mean still low; "Atlas cluster" still ProviderUndetected

The bundle data fix (P2) inlined `service_aliases.atlas_cluster → [mongodb-atlas_advanced_cluster, mongodb-atlas_cluster]` and "atlas cluster" / "M40 atlas" phrases into `mongodb-atlas/MANIFEST.json`. The CLI tokenizer + tier1-alias matcher consumes them correctly **once a provider has been classified**. But the *provider classifier* (`src/lib/discover/provider.ts`) only knows three substring phrases and a hand-curated `DEFAULT_SERVICE_ALIASES` table; the literal token "atlas" is in *neither*. So `detectProvider("tune Atlas cluster cost", ...)` returns `score: 0`, the discover orchestrator emits `ProviderUndetected`, and tiebreaker never fires (it only kicks in when ≥2 providers tie on the candidate ranking, which requires at least one to score above 0).

P1's tiebreaker is correct *for the case it covers* (queries like "Snowflake warehouse" or "BigQuery dataset" where both candidates already register on canonical-name match). It does NOT close the gap where the modifier is the only routing signal. The fix would be to either (a) seed the bundle's `service_aliases` map back into the classifier's alias table at load time (so the bundle-side `atlas_cluster` alias would route to mongodb-atlas), or (b) hard-code "atlas" into `DEFAULT_SERVICE_ALIASES`. Neither of those was in the v0.1.1 plan.

The same root cause keeps **local** at 0.000 (the literal token "local" is anti-detected as Terraform-meta noise and the bundle-side `local_file` alias never reaches the classifier), and explains why **tls** and **mongodb-atlas** didn't move despite P2 doing the bundle-side work.

### #5 — `E9-A6-cloudflare-workers-d1-r2` only 0.333

The aliases fired correctly: `concept_aliases_used` shows `edge worker → worker`, `d1 database → d1`, `r2 bucket → r2`. The `recommended_companions` for `cloudflare_workers_script` is correct in the bundle (`[workers_route, workers_kv_namespace, r2_bucket, d1_database]`). But the top-15 file list is dominated by `cloudflare_workers_*` resources (10 of 15), and `cloudflare_d1_database` / `cloudflare_r2_bucket` rank below position 15. The runner asks for `--max 15` and the scorer checks `top_k=15`. Within those 15, only `has_worker` passes; the d1/r2 expectations check basenames, find none, fail.

Two contributing root causes:
- The alias-promoted resources from `d1` and `r2` aliases get scored independently and don't get a "topology" boost when paired with `worker`.
- The companions list of `cloudflare_workers_script` doesn't get aggressively promoted into the top results.

This is a tier1 ranking gap, not a bundle-content gap.

## Headline numbers (BEFORE → AFTER)

- mean manifest_score: **0.623 → 0.678** (+0.055)
- full-pass count: **32 → 39** (+7 prompts)
- zero-pass count: **12 → 11** (−1)
- A7 (cross-prov topology): **0.434 → 0.446** (+0.012; target ≈0.7 — MISS by a wide margin)
- A6 (single-prov topology): **0.536 → 0.774** (+0.238; closes most of the gap)
- A1 (single resource): **0.579 → 0.711** (+0.132; mostly from clickhouse / crowdstrike / redis-cloud aliases)

## Real lift summary

The harness improved by +0.055 mean manifest_score on the 76-prompt suite (8.8% relative). 7 more prompts now full-pass. Cross-team work was successful where the data and the CLI agreed on the contract (A6 +0.238, A1 +0.132); it stalled where the provider classifier remained the bottleneck (A7 +0.012, mongodb-atlas / local / tls / cloudflare unchanged).
