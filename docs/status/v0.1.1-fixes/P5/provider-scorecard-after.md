# P5 — Provider scorecard (BEFORE vs AFTER)

Comparison: E9 baseline (before v0.1.1 fixes) vs P5 re-run (after P1+P2+P3+P4).

Bundle: `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`. 
Runner: same Python harness as E9 (76 prompts, top_k=15, manifest-side scoring). 
CLI rebuilt from `main` after P1-P4 landed.


## Headline

- mean **manifest_score**: **0.623 → 0.678** (Δ +0.055)
- full-pass count: **32 → 39** (Δ +7)
- zero-pass count: **12 → 11** (Δ -1)

## Per-archetype delta

| Archetype | n | Before | After | Δ | Notes |
|---|---|---|---|---|---|
| A1 | 19 | 0.579 | 0.711 | +0.132 | aliases for clickhouse/crowdstrike/redis-cloud landed cleanly |
| A10 | 3 | 0.500 | 0.667 | +0.167 | gitlab-ci-pipeline +0.500 |
| A11 | 3 | 0.667 | 0.667 | +0.000 | unchanged |
| A12 | 4 | 0.541 | 0.541 | +0.000 | mongodb-cluster-replaced still missing card; stemming alone insufficient |
| A2 | 5 | 1.000 | 1.000 | +0.000 | argument lookups already perfect; nothing to lift |
| A3 | 5 | 1.000 | 1.000 | +0.000 | import-id syntax already perfect |
| A4 | 4 | 0.792 | 0.708 | -0.083 | k8s-v1-suffix migration card stopped firing — see regressions.md |
| A5 | 4 | 0.667 | 0.583 | -0.084 | clickhouse soft-deps regressed under auto-merge |
| A6 | 7 | 0.536 | 0.774 | +0.238 | companions YAML extension worked: snowflake-warehouse-rbac → 1.000, datadog-aws → 1.000 |
| A7 | 14 | 0.434 | 0.446 | +0.012 | auto-merge improved provider routing but `--max 15` global cap displaces minor-provider resources; net +0.012 vs target ~0.7 |
| A8 | 4 | 0.500 | 0.500 | +0.000 | unchanged |
| A9 | 4 | 0.750 | 0.750 | +0.000 | unchanged |

## Per-provider delta

| Provider | n prompts | Before | After | Δ | Notes |
|---|---|---|---|---|---|
| local | — | 0.000 | 0.000 | +0.000 | token "local" still anti-detected as Terraform meta |
| tls | — | 0.125 | 0.125 | +0.000 | self-signed cert still routed to local provider |
| mongodb-atlas | — | 0.222 | 0.222 | +0.000 | classifier still fails on "Atlas" without "mongodb" |
| kubernetes | — | 0.389 | 0.278 | -0.111 |  |
| cloudflare | — | 0.312 | 0.312 | +0.000 | d1/r2 aliases fire but get displaced past top-15 |
| github | — | 0.333 | 0.333 | +0.000 |  |
| auth0 | — | 0.584 | 0.416 | -0.167 |  |
| helm | — | 0.488 | 0.488 | +0.000 |  |
| azure | — | 0.500 | 0.500 | +0.000 |  |
| netlify | — | 0.666 | 0.500 | -0.166 |  |
| time | — | 0.500 | 0.500 | +0.000 |  |
| aws | — | 0.428 | 0.639 | +0.211 | baseline anchor; mostly stable |
| 1password | — | 0.834 | 0.666 | -0.167 |  |
| clickhouse | — | 0.334 | 0.666 | +0.333 | A1 prompt now full-pass; A5 soft-deps regressed |
| vault | — | 0.750 | 0.667 | -0.084 |  |
| gcp | — | 0.667 | 0.667 | +0.000 |  |
| gitlab | — | 0.458 | 0.667 | +0.208 | A10 ci-pipeline now full-pass |
| okta | — | 0.700 | 0.700 | +0.000 |  |
| vercel | — | 0.767 | 0.700 | -0.067 |  |
| ansible | — | 0.750 | 0.750 | +0.000 |  |
| external | — | 0.750 | 0.750 | +0.000 |  |
| pinecone | — | 0.889 | 0.778 | -0.111 |  |
| redis-cloud | — | 0.611 | 0.778 | +0.167 | A1 subscription now full-pass |
| snowflake | — | 0.648 | 0.778 | +0.130 | companions extension lifted A6 to 1.000 |
| crowdstrike | — | 0.167 | 0.834 | +0.667 | P2 aliases + companions surfaced both falcon resources |
| digitalocean | — | 0.666 | 0.834 | +0.167 |  |
| splunk | — | 0.834 | 0.834 | +0.000 |  |
| datadog | — | 0.567 | 0.867 | +0.300 | A6 datadog-aws integration now full-pass |
| random | — | 0.875 | 0.875 | +0.000 |  |
| grafana | — | 0.917 | 0.917 | +0.000 |  |
| pagerduty | — | 0.938 | 0.938 | +0.000 |  |

## Bottom-5 (per S2 §3) before/after

- **local**: 0.000 → 0.000 (Δ +0.000)
- **tls**: 0.125 → 0.125 (Δ +0.000)
- **crowdstrike**: 0.167 → 0.834 (Δ +0.667)
- **mongodb-atlas**: 0.222 → 0.222 (Δ +0.000)
- **cloudflare**: 0.312 → 0.312 (Δ +0.000)
- **MEAN**: 0.165 → 0.299 (target ≥0.55 — **MISSED by 0.251**)