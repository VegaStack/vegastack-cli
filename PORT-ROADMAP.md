# PORT-ROADMAP — Python harness → TypeScript native (shipped in v0.2)

## Status: ✅ shipped

The native TypeScript discoverer is in `src/lib/discover/` and is the default
runtime for `vega tf`. Python is no longer required to install or use the
CLI. This document is kept for historical context and as a reference for any
future v0.3 retrievals work (common-query cache, trigram body index).

## What landed in v0.2

| Module                            | What it does                                                                                                                                                                                                                                                    | Equivalent in legacy `discover.py`    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `src/lib/discover/types.ts`       | Public + internal types — `DiscoverResult`, `DiscoverFile`, `Reason`, `ScoredFile`, manifest types                                                                                                                                                              | (typing was implicit)                 |
| `src/lib/discover/constants.ts`   | Every constant table verbatim — `CANONICAL_PROVIDERS`, `SERVICE_ALIASES`, `TOKEN_EXPANSIONS`, `SUBCAT_KEYWORDS`, `PRIMARY_RESOURCES`, `PROVIDER_TOKEN_EXPANSIONS`, `PROVIDER_CONTEXT_EXCLUSIONS`, `NOISE`, `PATH_WEIGHTS`, `TIER2_GREP_SKIP`, `INTENT_KEYWORDS` | top of `discover.py`                  |
| `src/lib/discover/manifest.ts`    | mtime-based per-provider manifest cache                                                                                                                                                                                                                         | (no caching — re-read every call)     |
| `src/lib/discover/path-weight.ts` | First-match path-substring multiplier                                                                                                                                                                                                                           | `path_weight()`                       |
| `src/lib/discover/bigrams.ts`     | Sliding-window 2-character bigrams                                                                                                                                                                                                                              | `_bigrams()`                          |
| `src/lib/discover/provider.ts`    | `detectProvider()` — canonical name + alias + context-exclusion logic                                                                                                                                                                                           | `detect_provider()`                   |
| `src/lib/discover/tokenize.ts`    | `tokenize()` — TOKEN_EXPANSIONS + provider-scoped expansions                                                                                                                                                                                                    | `tokenize()`                          |
| `src/lib/discover/scoring.ts`     | `Scorer` class — typed accumulator with dedup rules                                                                                                                                                                                                             | inline closure in `tier1_manifest()`  |
| `src/lib/discover/tier1.ts`       | All 11 Tier-1 stages (1a → 1k) + the new 1l (recommended_companions)                                                                                                                                                                                            | `tier1_manifest()` (one big function) |
| `src/lib/discover/tier2.ts`       | 4-pass grep fallback, ripgrep-aware, allowlisted env                                                                                                                                                                                                            | `tier2_grep()`                        |
| `src/lib/discover/merge.ts`       | `mergeAndRank()` — half-weight grep when already in T1, deterministic sort                                                                                                                                                                                      | `merge_and_rank()`                    |
| `src/lib/discover/intents.ts`     | Intent grouping by `subcat_keyword` reason                                                                                                                                                                                                                      | `_build_intents()`                    |
| `src/lib/discover/enrich.ts`      | **NEW** — inlines `manifest_entry` + `## Example Usage` for top-K                                                                                                                                                                                               | (none)                                |
| `src/lib/discover/index.ts`       | Public `discover()` orchestrator + per-stage timings                                                                                                                                                                                                            | `discover()`                          |

## Performance wins

| Optimization                      | v0.1 (Python shell-out) | v0.2 (native TS)                | Gain                                   |
| --------------------------------- | ----------------------- | ------------------------------- | -------------------------------------- |
| Process startup                   | ~80 ms (python3 cold)   | ~30 ms (Node warm)              | 50 ms / call                           |
| Manifest parse                    | per-call JSON.parse     | mtime-cached in module state    | manifest reads sub-ms after first call |
| `manifest_entry` enrichment       | n/a (agent does jq)     | inline in response              | **eliminates 5–10 jq calls per task**  |
| `example_usage` enrichment        | n/a (agent does grep)   | inline in response              | **eliminates 1–3 grep calls per task** |
| `recommended_companions` widening | not surfaced            | top-K auto-includes companions  | 1 call vs N companion lookups          |
| Per-stage timings (`--debug`)     | n/a                     | seven timing fields in response | observability for free                 |

## Parity gate

`tests/integration/discover-parity.test.ts` runs identical queries through
both the legacy Python `discover.py` AND the native TS port; the gate fails
if top-1 file paths disagree on any prompt. The test suite covers 10
representative prompts spanning every provider; **all 10 currently agree**.

To extend: add prompts to the `PROMPTS` array. New prompts that disagree
will surface bugs in either implementation.

The test is gated on `python3` being available; in CI environments without
Python it skips automatically without failing.

## What's NOT ported (and shouldn't be)

The bundle BUILD pipeline lives in the upstream `engg-vegastack-agent-tf-providers`
repo and stays in Python:

- `scripts/lib/manifest_builder.py` — heavy, well-tested, runs daily at
  02:00 UTC in the upstream cron. Output lands in the bundle as
  `<provider>/MANIFEST.json` files.
- `scripts/lib/validate_manifest.py` — 29 deterministic structural checks.
- `scripts/sync_docs.sh` — bash 3.2-compatible orchestrator.
- `scripts/test_queries.py` — 74-prompt benchmark harness.

These never run on user machines; they produce the artifacts the TS
discoverer consumes. Porting them would not benefit users and would risk
regressions against the existing benchmark.

## Future work (v0.3+)

Items considered during the v0.2 design but explicitly deferred:

1. **Common-query cache** — hash the top ~100 popular queries, snapshot the
   result, ship as `common_cache.json` in the bundle. Cache hits return in
   ~1 ms. Useful only after we have user telemetry to know which queries
   are common. Defer until v0.3 once users are real.

2. **Trigram body index** — per-provider `BODY_INDEX.json` (~5–10 MB each)
   gives Tier-2 fallback ~5× faster than ripgrep. Currently ripgrep alone
   is fast enough for the queries that fall through Tier-1. Defer until
   benchmarks show Tier-2 latency mattering.

3. **HCL AST-aware scoring** — using a real HCL parser (e.g. `tree-sitter-hcl`)
   to score example_tokens by their structural role would beat the current
   bag-of-tokens approach for ambiguous queries. Significant complexity;
   defer until needed.

## Migration path for users

Zero user action. The npm postinstall fetches the same bundle; `vega tf`
swaps Python shell-out for native code. `vega doctor` no longer reports a
Python check. The bundle's `scripts/discover.py` stays in place for
backwards compat (anyone aliasing `python3 $VEGA_BUNDLE/scripts/discover.py`
directly is unaffected), but the CLI never invokes it.
