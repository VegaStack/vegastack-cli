# S7 — Provider Scorecard (E9 → P5 → S7)

Comparison: E9 baseline → P5 (after P1-P4) → S7 (after S1-S6).

Bundle: `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`.
Runner: same Python harness as E9/P5 (76 prompts, top_k=15, manifest-side scoring).
CLI rebuilt from `main` after S1-S6 landed.

---

## Headline

| Metric | E9 (Before P5) | P5 (After P1-P4) | S7 (After S1-S6) | Δ vs P5 | Δ vs E9 |
|---|---|---|---|---|---|
| Mean manifest_score | 0.623 | 0.678 | **0.713** | **+0.035** | **+0.090** |
| Full-pass (=1.0) | 32/76 | 39/76 | **42/76** | **+3** | **+10** |
| Zero-pass (=0.0) | 12/76 | 11/76 | **9/76** | **-2** | **-3** |

---

## Per-archetype delta

| Archetype | n | E9 | P5 | S7 | Δ vs P5 | Notes |
|---|---|---|---|---|---|---|
| A1 | 19 | 0.579 | 0.711 | 0.763 | +0.052 | local-file-render now full-pass; atlas aliases firing |
| A2 | 5 | 1.000 | 1.000 | 1.000 | +0.000 | still perfect |
| A3 | 5 | 1.000 | 1.000 | 1.000 | +0.000 | still perfect |
| A4 | 4 | 0.792 | 0.708 | 0.625 | -0.083 | k8s-v1-suffix STILL regressed (not fully fixed by S1 R2) |
| A5 | 4 | 0.667 | 0.583 | 0.667 | +0.083 | clickhouse-soft-deps fixed by S1 R1 per-provider quota |
| A6 | 7 | 0.536 | 0.774 | 0.774 | +0.000 | held steady; cloudflare-workers-d1-r2 still 1/3 |
| A7 | 14 | 0.434 | 0.446 | 0.423 | -0.024 | 2 new regressions: crowdstrike-on-aws, do-app-cf-dns |
| A8 | 4 | 0.500 | 0.500 | 0.750 | +0.250 | snowflake-network-policy now full-pass |
| A9 | 4 | 0.750 | 0.750 | 1.000 | +0.250 | mongo-atlas-cost-cut now full-pass (C6 fix) |
| A10 | 3 | 0.500 | 0.667 | 0.667 | +0.000 | held |
| A11 | 3 | 0.667 | 0.667 | 0.667 | +0.000 | held |
| A12 | 4 | 0.541 | 0.541 | 0.541 | +0.000 | unchanged |

---

## Per-provider delta

| Provider | n | E9 (Before P5) | P5 (After P1-P4) | S7 (After S1-S6) | Δ vs P5 | Δ vs E9 |
|---|---|---|---|---|---|---|
| local | 1 | 0.000 | 0.000 | **1.000** | **+1.000** | +1.000 |
| tls | 2 | 0.125 | 0.125 | 0.125 | +0.000 | +0.000 |
| mongodb-atlas | 3 | 0.222 | 0.222 | **0.555** | **+0.333** | +0.333 |
| cloudflare | 4 | 0.312 | 0.312 | 0.229 | -0.084 | -0.083 |
| github | 3 | 0.333 | 0.333 | 0.333 | +0.000 | +0.000 |
| auth0 | 2 | 0.584 | 0.416 | 0.416 | +0.000 | -0.167 |
| helm | 7 | 0.488 | 0.488 | 0.488 | +0.000 | +0.000 |
| kubernetes | 3 | 0.389 | 0.278 | 0.167 | -0.111 | -0.222 |
| azure | 2 | 0.500 | 0.500 | 0.500 | +0.000 | +0.000 |
| netlify | 2 | 0.666 | 0.500 | 0.500 | +0.000 | -0.166 |
| time | 1 | 0.000 | 0.000 | 0.000 | +0.000 | +0.000 |
| aws | 9 | 0.491 | 0.565 | 0.565 | +0.000 | +0.074 |
| 1password | 2 | 0.834 | 0.666 | 0.834 | +0.167 | +0.000 |
| clickhouse | 2 | 0.334 | 0.666 | 0.834 | +0.167 | +0.500 |
| vault | 6 | 0.722 | 0.611 | 0.667 | +0.056 | -0.056 |
| gcp | 3 | 0.667 | 0.667 | 0.667 | +0.000 | +0.000 |
| gitlab | 4 | 0.458 | 0.667 | 0.667 | +0.000 | +0.208 |
| okta | 4 | 0.750 | 0.750 | 0.750 | +0.000 | +0.000 |
| vercel | 5 | 0.767 | 0.700 | 0.700 | +0.000 | -0.067 |
| ansible | 2 | 0.750 | 0.750 | 0.750 | +0.000 | +0.000 |
| external | 1 | 1.000 | 1.000 | 1.000 | +0.000 | +0.000 |
| pinecone | 3 | 0.889 | 0.778 | 0.889 | +0.111 | +0.000 |
| redis-cloud | 3 | 0.611 | 0.778 | 0.778 | +0.000 | +0.167 |
| snowflake | 9 | 0.648 | 0.778 | 0.889 | +0.111 | +0.241 |
| crowdstrike | 2 | 0.167 | 0.834 | 0.666 | -0.167 | +0.500 |
| digitalocean | 2 | 0.666 | 0.834 | 0.666 | -0.167 | +0.000 |
| splunk | 2 | 0.834 | 0.834 | 0.834 | +0.000 | +0.000 |
| datadog | 5 | 0.567 | 0.867 | 0.800 | -0.067 | +0.233 |
| random | 2 | 0.875 | 0.875 | 0.875 | +0.000 | +0.000 |
| grafana | 3 | 0.917 | 0.917 | 0.917 | +0.000 | +0.000 |
| pagerduty | 3 | 1.000 | 1.000 | 1.000 | +0.000 | +0.000 |

---

## Bottom-5 providers (P5 definition: local, tls, mongodb-atlas, crowdstrike, cloudflare)

| Provider | E9 | P5 | S7 | Δ vs P5 |
|---|---|---|---|---|
| local | 0.000 | 0.000 | **1.000** | **+1.000** |
| tls | 0.125 | 0.125 | 0.125 | +0.000 |
| mongodb-atlas | 0.222 | 0.222 | **0.555** | **+0.333** |
| crowdstrike | 0.167 | 0.834 | 0.666 | -0.167 |
| cloudflare | 0.312 | 0.312 | 0.229 | -0.083 |
| **MEAN** | 0.165 | 0.299 | **0.515** | **+0.216** |

Target was ≥0.55. S7 actual is **0.515** (PARTIAL — within 0.035 of target).

Note: crowdstrike dropped from 0.834 to 0.666 because S3's alias detection changed
E9-A7-crowdstrike-on-aws routing from a merged aws+crowdstrike envelope to crowdstrike-only,
losing the aws_ssm_association expectation. cloudflare dropped because the same detection
improvement routed do-app-cf-dns to cloudflare-only instead of merged cloudflare+datadog+digitalocean.

---

## A7 cross-provider topology

| Metric | E9 | P5 | S7 | Target |
|---|---|---|---|---|
| A7 mean | 0.434 | 0.446 | **0.423** | ≥0.55 |

A7 is still well below target. Two new regressions (see `regressions.md`) pulled it from 0.446 to 0.423.
