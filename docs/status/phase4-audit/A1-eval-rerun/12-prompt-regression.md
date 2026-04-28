# 12-prompt baseline regression delta — 2026-04-28

A1 audit team — re-ran every prompt from `docs/planning/01-initial-eval-baseline-2026-04-28.md`
through the new TS `vegastack tf` (E2 harness, post-Phase-3) and diffed against the raw JSON
saved at `docs/evals/raw/{A1..D3}.json` from the original 12-prompt run.

Bundle dir used: `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`
Per-prompt result envelopes saved at: `/tmp/exec-status/A1/regression-runs/<id>.json`

Note: the old JSON was a 7-field envelope (`status`, `query`, `provider`, `tokens`,
`tiers_used`, `files`, `count`); the new envelope adds `provider_confidence`,
`schema_version=1`, `bundle_version`, `score_norm`, `manifest_entry`, `example_usage`,
`recommended_companions`, `knowledge[]`, `recipes[]`, `concept_aliases_used[]`,
`citations[]`, `intents`. The "Better/Worse/Same" verdict below is for the **top-1
answer + the specific failure axes called out in the original baseline**, not the
envelope shape (which is universally improved).

| ID | Old top-1 | New top-1 | Verdict | Notes |
|---|---|---|---|---|
| **A1** S3+versioning+SSE | `s3_bucket.html.markdown` (score 360) | `s3_bucket_server_side_encryption_configuration.html.markdown` (score 220, norm 55) | **better** | Top-1 is now the SSE-config child resource (matches the "split-resource" intent of the query). `s3_bucket_versioning` rank 2, `s3_bucket` rank 9 (vs old: top-3 had bucket+versioning+SSE). New: `knowledge[]` carries `aws-s3-versioning-split` card — closes the cite gap from the old eval. |
| **A2** Cloudflare DNS A | `dns_record.md` rank 1 (score 65) | `dns_record.md` rank 1 (score 185, norm 46.3) | **same** | Top-1 unchanged; envelope now richer. Still no `cloudflare-resource-renames-v5` card surfaced (query does not contain the trigger token "rename"; tokens present `[cloudflare,dns,a,record,api,acme,com,proxied]`). |
| **A3** Datadog ECS-CPU monitor | `monitor.md` rank 1 (score ~135) | `monitor.md` rank 1 (score 397.5, norm 99.4) | **same** (top-1) / **better** (signal strength) | Score normalized to 99.4 means high confidence — replaces the original 135 raw score with no normalization. |
| **B1** K8s Deploy+Svc+ConfigMap | `deployment.md` top, then `service.md`, `config_map.md` | `env.md` rank 1 (score 330), `service.md` rank 2, `deployment.md` rank 3, `config_map.md` rank 4 | **worse** (top-1 quality regression) | The new tokenizer surfaces `kubernetes_env.md` (a small standalone `env` resource) above `deployment.md`. The query was "Kubernetes Deployment Service ConfigMap nginx env vars" — "env" matched too aggressively. Companions of deployment/svc/cm still all in top-15. |
| **B2** RDS PG+SG+subnet | `db_subnet_group.html.markdown` rank 1 | `db_subnet_group.html.markdown` rank 1 (score 315, norm 78.8) | **same** | Order: `db_subnet_group → rds_cluster_parameter_group → security_group → rds_shard_group → db_subnet_group(dup) → db_parameter_group → ...`. `aws_db_instance` not in top-15 — same gap as the old run. |
| **B3** Vault PKI | top-12 was all auth-backend `_role` noise | `pki_secret_backend_root_sign_intermediate.html.md` rank 1, then `pki_secret_backend_intermediate_set_signed`, `pki_secret_backend_role` rank 4, `pki_secret_backend_acme_eab` rank 5 | **better (large)** | The PKI-secret-backend resources finally rise to the top. The old result had `vault_alicloud_auth_backend_role` etc. dominating; new run has only one auth-backend-role at rank 8 (`alicloud_auth_backend_role`). PKI-related resources now hold ranks 1, 2, 4, 5, 6 — exactly the win the original report flagged as missing. |
| **C1 (aws side)** ECS+ALB+ASG+RDS | `aws_lb_listener` was missing from top-15 (the explicit complaint from the original baseline) | `lb.html.markdown` rank 1 (score 210, norm 52.5), `appautoscaling_policy` rank 8, `appautoscaling_target` rank 11 | **same on the listener gap** / **better on autoscaling** | `aws_lb_listener` is **still missing from top-15** — the canonical baseline complaint. `appautoscaling_target` and `appautoscaling_policy` now both surface (rank 8 + 11) — the autoscaling gap from the original report **is closed**. |
| **C1 (datadog side)** ECS-CPU monitor | `datadog_monitor` rank 1 in datadog scope | new run on the C1 datadog query disambiguated provider=aws (conf 0.6) and surfaced `ecs_express_gateway_service` rank 1 — datadog provider not detected | **worse (provider misroute)** | Query "ECS service CPU monitor 80% 10 minutes alert" with no explicit provider is now classified aws (because of "ecs"+"service"+"cpu" tokens). To get datadog you need `--provider datadog`. Old run already had to run two separate `vegastack tf` calls for this one. |
| **C2 (aws side)** ALB ingress | `lb.html.markdown` rank 1 then `security_group` | `load_balancer.md` rank 1 — but provider got DETECTED AS CLOUDFLARE (conf 1.0) | **worse (wrong provider)** | The query "ALB security group ingress Cloudflare IP ranges" is now scored as cloudflare-dominant because of the "Cloudflare" token — confidence 1.0. Before, the harness routed to aws. To get the AWS slice the user must `--provider aws`. |
| **C2 (cloudflare side)** Access app | `cloudflare_zero_trust_access_application` rank 1 | `zero_trust_access_policy.md` rank 1, `access_rule.md` rank 2, `zero_trust_access_application` rank 5 | **worse (top-1 ranking regression)** | Policy moved to top-1, application slipped to rank 5. Same provider, top-15 still includes everything needed. |
| **C2 (okta side)** OIDC IdP | `okta_idp_oidc.md` rank 1 | `idp_saml_key.md` rank 1, `idp_oidc.md` rank 2 + 4 | **worse (top-1)** | "OIDC IdP" should privilege `idp_oidc`; instead `idp_saml_key` won. Both still top-5. |
| **C3 (aws side)** ECR+IAM-OIDC for GHA | `aws_ecr_repository`, `aws_iam_openid_connect_provider`, `aws_iam_role` (originally complained `openid_connect_provider` + `eks_cluster` were absent) | provider detected as **GitHub** (conf 1.0); top-1 `repository.html.markdown` (GitHub repo, not ECR repo). Plenty of `actions_*` in top-15. | **mixed** | Provider routed to GitHub — explicit `--provider aws` would still be needed for ECR+IAM. The new tokenizer is more sensitive to the "GitHub Actions" phrase and now disambiguates more aggressively. |
| **C3 (gh side)** Workflow secret | `actions_secret.html.markdown` rank 1 | `actions_repository_permissions.html.markdown` rank 1, `actions_secret` rank 11 | **worse (top-1 ranking)** | Secret resource demoted from rank 1 to rank 11; everything still in top-15. |
| **C3 (k8s side)** EKS+Svc | `kubernetes_deployment.md` rank 1 | `deployment.md` rank 1 (score 397.5, norm 99.4) | **same/better (signal strength)** | Top-1 unchanged; score normalization adds confidence. |
| **D1** S3 native locking (the killer use case) | top-1 `aws_dynamodb_table` (the wrong answer); knowledge card never surfaced | top-1 `dynamodb_resource_policy.html.markdown` (still wrong-domain), `dynamodb_table.html.markdown` rank 3. **`aws-s3-native-state-locking` knowledge card NOT surfaced** despite being on disk and the loader being wired. | **worse (top-1) / no cite improvement** | Root cause: the knowledge card's `tokens` triggers are `[s3, backend, lock]` and `[dynamodb, state, lock]`. The query "S3 backend state locking DynamoDB" tokenises to `[s3, backend, state, locking, dynamodb]` — the literal token "lock" never appears (we have "locking"). The loader does **exact case-folded match**, no stemming. The card on disk is genuinely loaded by the harness for queries containing the literal "lock" token (verified by inspection) but this exact query phrasing misses. **This is a token-match-vs-stemming issue, not a missing card or missing loader** — the v0.1 fix must either (a) add "locking" to the trigger list in the bundle, or (b) add suffix-stripping (`-ing`/`-er`/`-s`) inside the matcher. The original baseline's complaint that the card was vapor is **partly resolved** (the channel exists), but the killer test still fails. |
| **D2** Import CF DNS record | `cloudflare_zone` rank 1 (score 135), `cloudflare_dns_record` rank 4 (score 70) | `cloudflare_dns_record` rank 1 (score 125, norm 31.3); `cloudflare_zone` not even in top-15 | **better (large)** | The exact regression flagged in the original report ("D2 ranking failure: Top result was `cloudflare_zone`, with `cloudflare_dns_record` at rank 4") **is closed**. dns_record now top-1 and dns_records (data source) is rank 4 + 7. cloudflare_zone has been demoted out of top-15. |
| **D3** CF Browser Rendering | top-1 was something irrelevant; original report praised this as "absence of `cloudflare_browser_rendering` from manifest was itself a real signal" | top-1 `ai_search_instance.md` (score 40, norm 10), `cloudflare_browser_rendering` not in any rank | **same (still honestly absent)** | Confirmed: there is NO `cloudflare_browser_rendering` resource in cloudflare/{resources,data-sources}/ — the harness honestly returns the noisy top-15 with score_norm=10 (very low confidence — quality gate behaviour: status=ok with normalized scores ≤ 50 should arguably be ambiguous). No hallucination, but also no friendly "this resource doesn't exist" hint. |

## Summary

- **Better:** A1 (top-1 + card surfaced), B3 (PKI dominance), D2 (dns_record beats zone)
- **Same:** A2, A3, B2, C3-k8s, D3 (top-1 unchanged or signal stronger)
- **Worse:** B1 (env vs deployment top-1), C1-datadog (provider misroute), C2-aws (provider misroute), C2-cloudflare (policy beat application), C2-okta (saml_key beat oidc), C3-aws (provider routed to github), C3-gh (perms beat secret)
- **Mixed:** D1 — channel works but token-stem mismatch keeps the killer card silent; C3-aws

## Specific findings the original baseline called out

| Original failure | Now? |
|---|---|
| C1 `aws_lb_listener` missing from top-15 | **STILL MISSING** — recommend adding `lb_listener` to AWS `recommended_companions` for `aws_lb`, or to subcat_keywords. |
| C1 `aws_appautoscaling_target` + `aws_appautoscaling_policy` missing | **CLOSED** — both now in top-15 (ranks 8 + 11). |
| C3 `aws_iam_openid_connect_provider` + `aws_eks_cluster` missing | **NOT VERIFIABLE** — query routed to GitHub provider; needs `--provider aws` re-run. |
| D1 `aws-s3-native-state-locking` knowledge card never surfaces | **STILL MISSING** for this query — token-stemming gap. Card is loadable for the right phrasing. |
| D2 `cloudflare_zone` outranks `cloudflare_dns_record` | **CLOSED** — dns_record now rank 1, zone out of top-15. |
| D3 No hallucinated `cloudflare_browser_rendering` | **CONFIRMED** — honestly absent. score_norm=10 indicates very low confidence; arguably should be `status=ambiguous` per the quality gate. |
| Knowledge cards: zero hits across 12 prompts | **PARTIALLY CLOSED** — A1 surfaces `aws-s3-versioning-split`. A2/D1 still don't fire. |
| Recipes: zero hits across 12 prompts | **NOT VERIFIED** in this 12-prompt set; recipes/ on disk has 9 toml files but none of these queries trigger one. |
| Concept aliases: zero hits | **NOT VERIFIED** in this 12-prompt set. |
