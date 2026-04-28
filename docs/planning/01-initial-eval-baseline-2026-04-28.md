# Initial 12-prompt baseline eval — 2026-04-28

This is the eval run that triggered the v0.1 modernization plan. It was performed against the as-shipped `vega tf` v0.1 harness, using the bundle at `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers` (31 providers, generated 270426 17:50 IST).

Raw discovery JSON for every prompt is preserved at `docs/evals/raw/{A1..D3}.json`.

---

## TL;DR — the report that started everything

The single most important finding outweighed everything else: **the `vega tf` v0.1 envelope did not match what `skills/terraform-docs/SKILL.md` describes.** The skill body promises an enriched response with `manifest_entry`, `example_usage`, `knowledge[]`, `recipes[]`, `concept_aliases_used[]`, and `citations[]` inline. The harness actually returned:

```json
{ "status", "query", "provider", "tokens", "tiers_used", "files":[{path,score,tier,reasons}], "count" }
```

`dist/lib/discover.js:2` literally said *"v0.2 will replace this with a native TypeScript port that adds enrichment"*, and `dist/cli.js:125` registered `--raw` as the *"v0.2 toggle"* (a no-op). `discover.py` had zero code paths that loaded knowledge cards, recipes, or concept aliases — and none existed on disk. Every promise the SKILL body made about beating stale training memory through `knowledge[]` was vapor.

---

## Per-prompt scoring matrix (10-dim rubric)

Dimension key: 1 resource accuracy · 2 argument fidelity · 3 deprecation awareness · 4 import-ID correctness · 5 recent-change override · 6 soft-dep expansion · 7 cross-provider coherence · 8 citation discipline · 9 no fabrication · 10 performance (tool calls)
N/A scored as **2** (not relevant ≠ failure).

| Prompt | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Total /20 | Tool calls | Wall-clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 S3+versioning+SSE       | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | **18** | 4 (1 vega, 3 jq) | ~6 s |
| A2 Cloudflare DNS A        | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | **20** | 2 (1 vega, 1 jq) | ~3 s |
| A3 Datadog ECS-CPU monitor | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | **20** | 2 (1 vega, 1 jq) | ~3 s |
| B1 K8s Deploy+Svc+CM       | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 2 | **19** | 4 (1 vega, 3 jq) | ~5 s |
| B2 RDS PG + SG + subnet    | 2 | 0 | 2 | 2 | 2 | 1 | 2 | 2 | 1 | 2 | **16** | 5 (1 vega, 4 jq) | ~7 s |
| B3 Vault PKI               | 1 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 1 | 0 | **14** | 7 (1 vega, 6 jq) | ~10 s |
| C1 ECS+ALB+ASG+RDS+DD      | 1 | 0 | 2 | 2 | 2 | 1 | 1 | 2 | 1 | 1 | **13** | 8 (2 vega, 6 jq) | ~14 s |
| C2 CF Access + ALB + Okta  | 1 | 1 | 2 | 2 | 2 | 1 | 1 | 2 | 1 | 2 | **15** | 7 (3 vega, 4 jq) | ~12 s |
| C3 GH Actions → ECR → EKS  | 1 | 1 | 2 | 2 | 2 | 0 | 1 | 2 | 1 | 2 | **14** | 7 (3 vega, 4 jq) | ~13 s |
| D1 S3 native state locking | 0 | 2 | 2 | 2 | 0 | 2 | 2 | 1 | 2 | 2 | **15** | 2 (1 vega, 1 grep) | ~3 s |
| D2 CF DNS record import    | 1 | 2 | 2 | 2 | 0 | 2 | 2 | 2 | 2 | 2 | **17** | 2 (1 vega, 1 jq) | ~3 s |
| D3 CF Browser Rendering    | 0 | 2 | 2 | 2 | 0 | 2 | 2 | 1 | 2 | 2 | **15** | 2 (1 vega, 1 jq) | ~3 s |
| **Mean** |   |   |   |   |   |   |   |   |   |   | **16.3 / 20** | 4.3 calls | ~7 s |

---

## Where the skill demonstrably beat an unaided LLM

- **A2 (Cloudflare DNS).** The manifest answered `cloudflare_dns_record`; older training data still emits `cloudflare_record` (renamed in cloudflare/cloudflare provider v5). Verified: `jq '.resources | has("cloudflare_record")' .../cloudflare/MANIFEST.json` → `false`.
- **A1 (S3 versioning split).** Manifest reported `aws_s3_bucket.deprecated = true` and surfaced `aws_s3_bucket_versioning` + `aws_s3_bucket_server_side_encryption_configuration` in the top 5.
- **A2/D2 (Cloudflare DNS record import format).** Manifest gave `terraform import cloudflare_dns_record.example '<zone_id>/<dns_record_id>'` verbatim.
- **D2/D3 (Cloudflare resource set).** The absence of `cloudflare_browser_rendering` from the manifest was itself a real signal — better than an LLM confidently generating a fake name.

## Where it underperformed expectations

- **All of Band D — the killer use case — failed on the recent-change axis.** D1 should have surfaced an `aws-s3-native-state-locking` knowledge card; the SKILL.md uses this exact card as Example 2. The card did not exist on disk, the harness had no card loader, and the response confidently ranked `aws_dynamodb_table` first.
- **D2 ranking failure.** Query was "Import an existing Cloudflare DNS record." Top result was `cloudflare_zone` (score 135), with `cloudflare_dns_record` at rank 4 (score 70).
- **B3 ranking failure.** Query "Vault PKI engine root intermediate CA role TTL" surfaced `vault_alicloud_auth_backend_role`, `vault_aws_auth_backend_role`, `vault_azure_auth_backend_role`, etc. — all matched on bare token "role". The relevant `vault_pki_secret_backend_root_cert`, `vault_pki_secret_backend_intermediate_cert_request`, `vault_pki_secret_backend_role` were NOT in top 12.
- **C1 / C3 missing companions.** C1's `aws_lb_listener`, `aws_appautoscaling_target`, `aws_appautoscaling_policy` absent from top-15. C3's `aws_iam_openid_connect_provider` and `aws_eks_cluster` absent from top-10.

## Knowledge-card / recipe / concept-alias hits and misses

- **Knowledge cards: zero hits across 12 prompts.** None on disk, no loader code in `discover.py`. SKILL.md's Example 2 (S3 native locking) was unsupported by the shipped artifact.
- **Recipes: zero hits.** No `recipes/` directory in the bundle. Band C had to fall back to per-provider calls.
- **Concept aliases: zero hits.** `concept_aliases_used[]` was never present in the response.

## Manifest-builder bugs found (fed directly into R3 audit)

- `aws_db_instance.required_args` includes `bucket_name, ingestion_role, source_engine, source_engine_version` (from `s3_import` sub-block).
- `aws_security_group.required_args` includes duplicated `from_port, to_port, protocol` (from inline `ingress`/`egress` legacy blocks).
- `aws_lb_listener.required` is wildly wrong: 25 args, mostly from `authenticate_oidc`/`authenticate_cognito` action sub-blocks. Real top-level required: `default_action` + `load_balancer_arn`.
- `aws_eks_cluster.required` is `[name, role_arn, vpc_config, provider, resources, key_arn, cidrs, cidrs, subnet_ids, control_plane_instance_type, group_name, outpost_arns]` — only the first three are actually required at the top level.
- `cloudflare_zero_trust_access_application.required = []` but actually needs `account_id` (or `zone_id`), plus typically `name`/`domain`.

## Verdict (2026-04-28)

**Not shippable as marketed.** The skill body markets four channels; the harness ships one and a half. A paying user reading "knowledge cards override your stale training memory" would trust the answer on Band D and get nothing — the worst possible failure mode for a "trust this over your training" product.

**With one of two minimal deltas, shippable:**

1. **Honest-docs delta (small):** Rewrite SKILL.md to describe the current envelope. Drop the four-channels framing. Pitch as "manifest-grounded resource lookup that beats `terraform plan` failures from invented names and arguments" — A1/A2/A3/B1/B2/D2 all back this claim.
2. **Earned-docs delta (medium):** Land 2 knowledge cards (S3 native locking, CF Browser Rendering rename) and 2 recipes (scalable backend, GitHub→AWS OIDC) — even as static JSON files the harness merges into the envelope. Flips D1/D3/C1/C3 from underperformance to clear wins, and lets the four-channels narrative stand. ~50 LOC of Python.

The manifest-pollution bug (over-reported `required_args`) had to be fixed before either ship — it makes the highest-value AWS resources' arguments actively dangerous to trust.

---

This eval is what triggered the Phase-1 research (R1–R5), the v1.0 synthesis plan (`07-v1-plan-synthesis.md`), and the v0.1 single-shot execution decision.

Reproducible: every "manifest says X" claim in this report is reproducible with the jq commands embedded inline against `$VEGA_BUNDLE_DIR/<provider>/MANIFEST.json` where `VEGA_BUNDLE_DIR=/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`.
