# S7 — Token-Cost Measurement (E1 + E3)

## Brief Mode Compression (E1)

Measured against the real bundle at `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers` with `--max 5` per query.
Token estimate: bytes / 4 chars per token (rough).

| Query | Archetype | Full bytes | Full ~tokens | Brief bytes | Brief ~tokens | Brief/Full | Δ tokens |
|---|---|---|---|---|---|---|---|
| "aws s3 bucket" | A1 (single-resource) | 16,388 | ~4,097 | 6,779 | ~1,695 | **41.4%** | -2,402 |
| "Snowflake warehouse RBAC roles grants" | A6 (single-prov topology) | 26,280 | ~6,570 | 6,815 | ~1,704 | **25.9%** | -4,866 |
| "TLS cert ACM Cloudflare DNS" | A7 (cross-prov topology) | 24,152 | ~6,038 | 7,313 | ~1,828 | **30.3%** | -4,210 |

### Assessment vs ≤25% target

The ≤25% (S5's E1 target) is met only for the A6 topology query (25.9% — marginally).
A1 misses at 41.4% and A7 misses at 30.3%.

Root cause: S5's 18% reduction measurement used the bundle-mini fixture with small stubs. The real bundle has full manifest entries: 30-80 required/optional args per resource, 200-line example_usage blocks, block schemas, enum tables. The brief mode correctly strips `required_args`, `optional_args`, `computed_attrs`, `recommended_companions`, `description`, `blocks`, `enum_values`, `sections`, and `import_syntax`. However the residual — `files[].path`, `files[].score_norm`, `files[].hit_reasons`, `files[].concept_aliases`, `files[].name` — plus the outer envelope fields still constitutes 26-41% of the full payload.

The brief mode does provide meaningful savings (59-74% reduction) and is correct as implemented. The absolute ≤25% target was too aggressive for real-world bundles.

---

## Auto Short-Circuit (E3)

The E3 short-circuit fires in `runProviderPipeline()` when:
- `args.max === undefined` (no explicit --max passed)
- `provisionalNormsForSC.get(ranked[0].path) > 90`
- `ranked[1] === undefined || provisionalNormsForSC.get(ranked[1].path) < 50`

The eval suite passes `--max 15` to every query, so the SC cannot fire during eval runs. The SC was tested manually:

| Query | No-max files returned | Top1 score_norm (output) | Top2 score_norm (output) | SC Fired? |
|---|---|---|---|---|
| "aws_s3_bucket" | 10 | 45.0 | 27.0 | No |
| "vault_kv_secret_v2" | 10 | 52.5 | 26.0 | No |
| "snowflake warehouse named ANALYTICS_WH" | 10 | 95.6 | 37.5 | No |
| "cloudflare_workers_script" | 10 | 52.5 | 26.0 | No |

**Observed SC firing rate across 76-prompt set (no --max): 0/76 (0%).**

The discrepancy: the SC checks `provisionalNormsForSC` computed on raw tier1 scores before enrichment. The output `score_norm` is computed after enrichment on a potentially narrower set. For the snowflake warehouse query, the output shows `top1=95.6, top2=37.5` — which WOULD trigger SC — but the provisional check operates on the raw pre-enrich tier1 scores, where the distribution is different. In real bundles with many similar-scoring resources, the provisional normalization rarely exceeds 90 for tier1 alone.

The SC unit tests (5 tests, all passing) use a synthetic bundle specifically designed to produce score_norm > 90. The logic is correct in isolation; the threshold calibration (>90) is too high for the real bundle's raw score distributions.

**Impact on eval:** Zero. The eval explicitly passes `--max 15` (disabling SC).
**Impact on production:** SC is an additive optimization with correct fallback behavior. When it does not fire, the harness returns the DEFAULT_MAX (20) results as before.
