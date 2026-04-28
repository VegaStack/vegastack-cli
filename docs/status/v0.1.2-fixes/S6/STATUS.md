# S6 STATUS — companion-boost fix (closes P5 C5)

**Date:** 2026-04-28  
**Agent:** S6 (single Sonnet subagent)  
**Task:** boost `recommended_companions` when source resource is an `exact_resource` hit

---

## Files changed

| File | LOC delta | Description |
|---|---|---|
| `src/lib/discover/tier1.ts` | +21 / -5 | Stage 1l: exact_resource→+50, primary_resource→+30, 60% cap |
| `tests/lib/discover/companion-boost.test.ts` | +175 / 0 | New unit test file (7 tests) |

---

## What changed in tier1.ts (stage 1l)

**Before:** flat `+20` companion boost regardless of how source resource was hit.

**After:**
- `exact_resource` hit → companion boost **+50** (closes P5 C5)
- `primary_resource` hit → companion boost **+30** (secondary bump)  
- All other hit kinds → `+20` (legacy fallback, unchanged)
- Cap: companion boost capped at `min(boost, sourceScore * 0.6)` — companions can never exceed 60% of source's raw score, preserving the ranking invariant.

All boost numbers annotated with `// closes P5 C5` provenance comment.

---

## Build / typecheck / lint / test exit codes

| Gate | Exit code |
|---|---|
| `npm run build` | **0** |
| `npm run typecheck` | **0** |
| `npm test` | **0** — 380 / 380 pass (7 new) |
| `npm run lint` | **0** |

Test count: 380 total (was 373 before this PR → +7 new companion-boost tests).

---

## Anti-regression checks

### Prompt 1: "create an aws_s3_bucket with versioning"

| Rank | Resource | score_norm |
|---|---|---|
| **1** | **s3_bucket.html.markdown** (aws_s3_bucket) | **52.5** |
| 2 | version-4-upgrade.html.markdown (guide) | 50.6 |
| 3 | s3_bucket_versioning.html.markdown | 35.0 |

Source `aws_s3_bucket` ranks #1. ✓ PASS

### Prompt 2: "ECS service with autoscaling"

| Rank | Resource | score_norm |
|---|---|---|
| 1 | autoscaling_lifecycle_hook.html.markdown | 55 |
| 2 | autoscaling_notification.html.markdown | 55 |
| **3** | **ecs_service.html.markdown** | **55** |

`ecs_service` ties at rank 3. This is pre-existing behavior (the `autoscaling` token fires name_partial + subcategory matches against many autoscaling_* resources). My change does not affect this ranking (autoscaling_* are not companions of ecs_service; they're subcategory peers and name_partial hits).

Note: `aws_appautoscaling_target` is NOT above `ecs_service` — the companion invariant is maintained.

### Prompt 3: "Cloudflare workers script"

| Rank | Resource | score_norm |
|---|---|---|
| **1** | **worker.md** (cloudflare_workers_script) | **93.8** |
| 2 | workers_route.md | 67.5 |
| 3 | workers.md | 58.0 |

Source `cloudflare_workers_script` ranks #1 with strong lead. ✓ PASS

---

## C5 verification: "Cloudflare Workers with D1 database and R2 bucket"

Command: `VEGA_BUNDLE_DIR=... node dist/cli.js tf "Cloudflare Workers with D1 database and R2 bucket" --raw --no-pretty`

Top-10 results:

| Rank | Resource | score_norm | Key reasons |
|---|---|---|---|
| **1** | **worker.md** (cloudflare_workers_script) | **93.8** | exact_resource, name_partial |
| 2 | workers.md (data) | 58.0 | exact_datasource, synthetic_subcat |
| 3 | workers_route.md | 52.5 | name_partial, recommended_companion |
| 4 | workers_script.md | 52.5 | name_partial, recommended_companion |
| 5 | worker.md (data) | 50.0 | exact_datasource, synthetic_subcat |
| **6** | **d1_database.md** | **47.5** | name_partial, recommended_companion, alias_resource |
| **7** | **r2_bucket.md** | **47.5** | name_partial, recommended_companion, alias_resource |
| 8 | workers_custom_domain.md | 47.5 | name_partial, example_token |
| 9 | workers_kv_namespace.md | 47.5 | name_partial, recommended_companion |
| 10 | workers_custom_domains.md | 44.0 | synthetic_subcat, example_token |

**cloudflare_workers_script**: rank 1 ✓  
**cloudflare_d1_database**: rank 6 (within top-10) ✓ — was beyond rank 15 before fix  
**cloudflare_r2_bucket**: rank 7 (within top-10) ✓ — was beyond rank 15 before fix

C5 expectation `resource_present` for d1 and r2 now passes at `--max 10` or higher. ✓

**Previous manifest_score: 0.333 (1/3)** → **New: 1.000 (3/3)** (all three resource_present checks pass within top-10)

---

## Key invariant confirmation

The 60% cap holds across all tested scenarios:
- Companion boost for `aws_s3_bucket_versioning` (exact_resource path): score=75 (50 companion + 25 subcat_peer), source after multiplier=150. Source > companion ✓
- All 7 unit tests in `companion-boost.test.ts` assert this invariant.
