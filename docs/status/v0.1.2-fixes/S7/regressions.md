# S7 — Regressions Found

Auditor: S7 (independent re-audit, 2026-04-28)
Compared: P5 eval results vs S7 eval results (same 76-prompt harness, --max 15)

---

## Summary

2 new regressions introduced by S1-S6 work.
1 P5 regression made worse (k8s-v1-suffix: was 0.333 partial, now 0.000 zero-pass).
2 P5 regressions not fixed (vercel-cloudflare-workers-ab, auth0-action-external-claim).

---

## New Regression R1 — E9-A7-crowdstrike-on-aws

**Prompt ID:** E9-A7-crowdstrike-on-aws
**E9 score:** 0.333 · **P5 score:** 0.667 · **S7 score:** 0.333

**Root cause:** S3 added `["crowdstrike", "crowdstrike"]` to the alias detection chain. The prompt "Make sure every EC2 in our AWS org runs the CrowdStrike Falcon sensor — register the AWS account with CrowdStrike..." now routes to `provider=crowdstrike` only (confidence=0.65 via concept-alias phrase detection). Previously (E9/P5 pre-S3) it routed to `aws+crowdstrike` via the ambiguous → merged path, which included `aws_ssm_association` from the aws sub-envelope.

**P5's result (0.667):** `ok-merged` provider=aws+crowdstrike — crowdstrike_cloud_aws_account PASSED, aws_ssm_association PASSED (from aws sub-envelope), aws_organizations_policy FAILED.

**S7's result (0.333):** `ok` provider=crowdstrike — crowdstrike_cloud_aws_account PASSED, aws_ssm_association FAILED (not in crowdstrike bundle), aws_organizations_policy FAILED.

**The tradeoff:** S3's fix correctly closes C6 ("tune Atlas cluster cost" → mongodb-atlas). But it over-triggers on multi-provider A7 prompts where crowdstrike is detected, suppressing the aws sub-envelope. This is a known tradeoff of the single-classification-wins approach vs the old ambiguous-merge fallback.

**What S1's per-provider quota does NOT fix:** S1 R1 only allocates per-provider quota when there ARE multiple provider envelopes. Since S3 now routes this query to crowdstrike-only, S1's merge logic is never invoked.

**Net regression vs P5:** -0.334 on this prompt.

---

## New Regression R2 — E9-A7-do-app-cf-dns

**Prompt ID:** E9-A7-do-app-cf-dns
**E9 score:** 0.333 · **P5 score:** 0.667 · **S7 score:** 0.333

**Root cause:** Same pattern as R1. Prompt "Run our small side-project on DigitalOcean App Platform with a custom domain pointed via Cloudflare..." now routes to `provider=cloudflare` only (confidence=0.65 via S2's `cloudflare_dns` alias phrase matching or S3's concept-alias detection). Previously it routed to `cloudflare+datadog+digitalocean` via ambiguous-merge, which included `digitalocean_app` from the DO sub-envelope.

**P5's result (0.667):** ok-merged, cloudflare_dns_record PASSED, digitalocean_app FAILED, datadog_synthetics_test FAILED.

**S7's result (0.333):** ok, provider=cloudflare, cloudflare_dns_record PASSED, digitalocean_app FAILED (not in cloudflare envelope), datadog_synthetics_test FAILED.

**Net regression vs P5:** -0.334 on this prompt.

---

## Worsened Regression W1 — E9-A4-k8s-v1-suffix (P5 had 0.333, S7 has 0.000)

**Prompt ID:** E9-A4-k8s-v1-suffix
**E9 score:** (varies) · **P5 score:** 0.333 · **S7 score:** 0.000

**Context:** P5 identified this as one of 5 regressions, at 0.333. S1 R2 added a digit-protection guard in `stem()` to fix the `kubernetes-provider-v2-fields` knowledge card not firing.

**S7 result:** All 3 expectations fail (0/3):
- `kubernetes_deployment_v1`: FAILED — `deployment_v1.md` exists in bundle but not surfacing in top-15
- `kubernetes_service_v1`: FAILED — `service_v1.md` would need to be in bundle
- `cites_card: kubernetes-provider-v2-fields`: FAILED — knowledge card not triggered

**Root cause of continued failure:**
1. The stem() digit guard was the right fix, but it may not be the only problem. The `kubernetes-provider-v2-fields` card requires `tokens: ["v1"]` to match. With the guard, `stem("v1") === "v1"` now (correct). But the trigger matching also requires `"v1"` to appear as a token in the query. The query is "Our codebase still uses kubernetes_deployment, kubernetes_service, kubernetes_config_map. Migrate to the recommended _v1 suffixed resources." The tokenizer may strip underscores/suffixes from `_v1`.
2. `kubernetes_deployment_v1` and `kubernetes_service_v1` basenames: The bundle has `deployment_v1.md` and `service_v1.md`, but these may not be ranking in top-15 due to the resource names being `kubernetes_deployment` (without _v1 suffix) dominating the tier1 scoring.

**Net vs P5:** 0.333 → 0.000 (worse).

---

## Unchanged P5 Regressions (not fixed by S1-S6)

### E9-A7-vercel-cloudflare-workers-ab (0.000 at P5 and S7)

**S7 run:** provider=cloudflare,netlify,vercel (merged). Top-10 files are ALL cloudflare workers_* files. The per-provider quota (S1 R1) helps, but the vercel and netlify files still don't appear in top-15 after merging. The prompt is about a Cloudflare Worker A/B test routing to Vercel and Netlify sites — Cloudflare's worker resources dominate all 15 slots even with quota.

### E9-A7-auth0-action-external-claim (0.333 at P5 and S7)

**S7 run:** provider=auth0,vault (merged). The vault_kv_secret_v2 still doesn't appear in top-15 of the merged envelope. The auth0 files dominate; the per-provider quota helps but vault_kv_secret_v2 still not in top-15.

---

## No Test Count Regressions

Test count: 380/380 (UP from P5's 371 baseline, tracking S1 +2, S3 +10, S5 +18, S6 +7 = +37 from P5's 343 root-only count; 380 is the S6-reported count and it matches). No tests were deleted. No flaky or skipped tests observed.

---

## No Build/Typecheck/Lint Regressions

All gates exit 0 across all 3 workspaces. No new warnings observed.
