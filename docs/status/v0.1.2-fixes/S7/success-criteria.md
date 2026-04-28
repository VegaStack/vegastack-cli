# S7 — Success Criteria Verification (9 criteria from P5)

Auditor: S7 (independent re-audit)
Date: 2026-04-28
Based on: 76-prompt E9 eval re-run, code inspection, build/test runs

---

| # | Criterion | Target | Actual | Verdict |
|---|---|---|---|---|
| 1 | All 5 P5 regressions resolved | 0 prompts dropped vs P5 baseline | 3/5 fixed; 2/5 unchanged; 2 NEW regressions introduced | ❌ MISSED |
| 2 | Bottom-5 provider mean ≥ 0.50 | ≥0.50 (P5 success); ≥0.55 (hard target) | **0.515** | 🟡 PARTIAL |
| 3 | "tune Atlas cluster cost" → mongodb-atlas rank 1 | top-1 = mongodbatlas_advanced_cluster | provider=mongodb-atlas, score=1.0, top1=cluster.md | ✅ MET |
| 4 | cloudflare-workers-d1-r2 ≥ 0.66 | ≥0.66 | **0.333** (1/3 expectations) | ❌ MISSED |
| 5 | A7 cross-provider topology mean ≥ 0.55 | ≥0.55 | **0.423** (P5 stuck at 0.446; S7 is lower) | ❌ MISSED |
| 6 | apps/mcp types re-export from contract | re-export pattern not hand-mirror | `export type { ... } from "../../../../docs/contracts/discover-types"` confirmed | ✅ MET |
| 7 | `--brief` envelope ≤ 25% of full | ≤25% | A1: 41% · A6: 26% · A7: 30% | 🟡 PARTIAL |
| 8 | All 380+ tests still pass | ≥380 tests, 0 failures | **380/380 pass** (44 test files) | ✅ MET |
| 9 | Build/typecheck/lint clean | exit 0 all workspaces | All exit 0 across CLI, apps/mcp, apps/dashboard | ✅ MET |

4 MET / 2 PARTIAL / 3 MISSED

---

## Criterion #1 — P5 Regressions

The 5 P5 regressions and their S7 status:

| Prompt ID | P5 score | S7 score | Status |
|---|---|---|---|
| E9-A4-k8s-v1-suffix | 0.333 | **0.000** | ❌ STILL REGRESSED (worse: was partial, now zero) |
| E9-A5-clickhouse-soft-deps | 0.333 | 0.667 | ✅ FIXED by S1 R1 per-provider quota |
| E9-A7-pinecone-vault-1password | 0.333 | 0.667 | ✅ FIXED by S1 R1 per-provider quota |
| E9-A7-vercel-cloudflare-workers-ab | 0.000 | 0.000 | UNCHANGED (not fixed) |
| E9-A7-auth0-action-external-claim | 0.333 | 0.333 | UNCHANGED (not fixed) |

Additional regressions introduced by S1-S6 (NEW):
| Prompt ID | E9 score | P5 score | S7 score | Root cause |
|---|---|---|---|---|
| E9-A7-crowdstrike-on-aws | 0.333 | **0.667** | 0.333 | S3 alias detection routes to crowdstrike-only; loses aws_ssm_association |
| E9-A7-do-app-cf-dns | 0.333 | **0.667** | 0.333 | S3 alias detection routes to cloudflare-only; loses digitalocean_app |

## Criterion #2 — Bottom-5 Mean

P5's bottom-5 providers (local, tls, mongodb-atlas, crowdstrike, cloudflare):
- local: 0.000 → 0.000 → **1.000** (+1.000 from S2/S3 aliases)
- tls: 0.125 → 0.125 → **0.125** (unchanged; E9-A1-tls-self-signed still routes to local)
- mongodb-atlas: 0.222 → 0.222 → **0.555** (+0.333 from S3 classifier + S2 aliases)
- crowdstrike: 0.167 → 0.834 → **0.666** (-0.167 new regression; was fixed by P2)
- cloudflare: 0.312 → 0.312 → **0.229** (-0.084 new regression)

Mean: 0.165 → 0.299 → **0.515** (target ≥0.55: missed by 0.035; ≥0.50: MET)

## Criterion #3 — Atlas Cluster

Command: `VEGASTACK_BUNDLE_DIR=<bundle> node dist/cli.js tf "tune Atlas cluster cost"`
Result: `provider=mongodb-atlas, status=ok, top1=cluster.md, score=1.0`

S3 fixed this via three layers: `["atlas", "mongodb-atlas"]` in DEFAULT_SERVICE_ALIASES,
manifest service_aliases in detectProvider, and concept-alias phrase detection fallback.

## Criterion #4 — cloudflare-workers-d1-r2

Eval prompt: "Deploy an edge worker that reads from a D1 database and writes uploaded blobs to an R2 bucket — give me the full Cloudflare topology."

S7 top-15 files (cloudflare, status=ok):
- worker.md (score_norm=100) ✅ cloudflare_workers_script PASSES
- workers_cron_trigger.md (67.5)
- workers_deployment.md (67.5)
- workers_for_platforms_dispatch_namespace.md (67.5)
- workers_kv.md (67.5)
- workers_script_subdomain.md (67.5)
- workers_script.md (63.7)
- ... (more workers_* files)
- d1_database.md and r2_bucket.md NOT in top-15

S6 ran a different query ("Cloudflare Workers with D1 database and R2 bucket") and saw d1_database at rank 6, r2_bucket at rank 7. The actual eval prompt ("Deploy an edge worker that reads from a D1 database...") produces different scores — the companion boost from S6 is insufficient to overcome the workers_* dominance for this specific prompt. Score remains 0.333 (1/3).

## Criterion #5 — A7 Cross-Provider Topology

A7 (n=14) mean: 0.434 (E9) → 0.446 (P5) → **0.423** (S7).
S1-S6 introduced 2 new A7 regressions, net pulling the mean below P5.
Target of ≥0.55 remains unmet.

## Criterion #6 — apps/mcp Types Re-export

File: `/Users/mk/projects/vegastack-cli/apps/mcp/src/lib/types.ts`
Header: `// CANONICAL: ../../../../docs/contracts/discover-types.ts`
Pattern: `export type { DiscoverResult, DiscoverOk, ... } from "../../../../docs/contracts/discover-types"`
`merged_from_providers?: string[]` is now in the canonical contract at line 37 and is re-exported.
S4 shipped: verified MET.

## Criterion #7 — --brief Envelope Size

Measured with real bundle, --max 5:

| Query type | Full (bytes) | Brief (bytes) | Brief/Full | ≤25%? |
|---|---|---|---|---|
| A1: "aws s3 bucket" | 16,388 | 6,779 | 41.4% | ❌ NO |
| A6: "Snowflake warehouse RBAC roles grants" | 26,280 | 6,815 | 25.9% | 🟡 MARGINAL |
| A7: "TLS cert ACM Cloudflare DNS" | 24,152 | 7,313 | 30.3% | ❌ NO |

The ≤25% target is not consistently met on the real bundle. S5's STATUS.md measured 18% reduction (from 5,627→4,609 bytes) with the mini fixture (small stubs). With the real bundle's full manifest entries (50+ args, schema blocks, descriptions), the brief mode achieves 26-41% of full size, not the stated "~80% savings." The A6 query is marginal (25.9%); A1 and A7 miss the target.

The brief mode is working correctly — it strips manifest_entry fields as designed — but the 25% target was based on projections, not actual measurements with the real bundle.

## Criterion #8 — Test Count

Root: **380/380 tests pass** (44 test files) — matches S6's reported count.
apps/mcp: 19/19 tests pass (5 files).
apps/dashboard: 9/9 tests pass (1 file).
Bundle pytest: 27/27 tests pass.
Total: **435 tests, 0 failures, 0 skips.**

## Criterion #9 — Build/Typecheck/Lint

| Workspace | build | typecheck | lint | tests |
|---|---|---|---|---|
| repo root | exit 0 | exit 0 | exit 0 | exit 0 (380/380) |
| apps/mcp | exit 0 (tsc --noEmit) | n/a | n/a | exit 0 (19/19) |
| apps/dashboard | exit 0 | n/a | n/a | exit 0 (9/9) |
| bundle pytest | n/a | n/a | n/a | exit 0 (27/27) |
