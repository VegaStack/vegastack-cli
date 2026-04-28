# R4 — Real-User-Task Taxonomy

## 1. Query archetypes (12)

| # | Archetype | Description |
|---|-----------|-------------|
| A1 | Single-resource scaffold | "Make a thing with options X, Y, Z." |
| A2 | Argument lookup | "What args does resource Q take?" |
| A3 | Import existing resource | "Bring this into TF state." |
| A4 | Modernise / migrate pattern | "We're on the old way; upgrade us." |
| A5 | Soft-dep expansion | "Spin up a VM" → really 6 resources. |
| A6 | Multi-resource topology (single provider) | "Stand up an EKS cluster end-to-end." |
| A7 | Cross-provider topology | "GitHub Actions deploys to EKS, alerts to Datadog." |
| A8 | Compliance / hardening | "Make this S3 SOC2-ready." |
| A9 | Cost-optimisation rewrite | "Cut this RDS bill in half." |
| A10 | GitOps / CI-CD wiring | "OIDC GitHub → AWS, Atlantis, drift detection." |
| A11 | Operational / day-2 task | "Rotate this secret, restore from snapshot, drain a node." |
| A12 | Recent-change / deprecation | "Is X deprecated? What replaced Y?" |

**Current evals (4 prompts in evals.json) cover only A1, A3, A6/A7. Eight archetypes have ZERO eval coverage.**

## 2. Knowledge-card inventory — 16 cards

| # | id | title | trigger query | body shape |
|---|----|-------|---------------|------------|
| K1 | aws-s3-native-state-locking | S3 native state locking obsoletes DynamoDB | "S3 backend, do I need DynamoDB for locks?" | Since AWS provider 5.55 / TF 1.10 the s3 backend supports use_lockfile = true; DynamoDB table now optional. |
| K2 | aws-s3-bpa-default-on | S3 Block Public Access on by default | "Why is my S3 ACL failing?" | All new buckets since Apr 2023 have BPA on and ACLs disabled; opt back via aws_s3_bucket_public_access_block + aws_s3_bucket_ownership_controls only when needed. |
| K3 | aws-s3-versioning-split | aws_s3_bucket inline blocks deprecated | "S3 bucket versioning + encryption" | Inline versioning, server_side_encryption_configuration, lifecycle_rule, logging, cors_rule, acl, policy, replication_configuration blocks on aws_s3_bucket are deprecated; use the per-feature aws_s3_bucket_* resources. |
| K4 | aws-alb-rename | aws_alb is alias for aws_lb | "Difference between aws_alb and aws_lb?" | aws_alb/aws_alb_* are aliases of aws_lb*; new code should use aws_lb, aws_lb_listener, aws_lb_target_group. |
| K5 | aws-ebs-encryption-default | EBS encryption-by-default flips region defaults | "Do I need encrypted=true on EBS?" | When aws_ebs_encryption_by_default enabled (recommended), the encrypted arg on volumes/snapshots is implicit; setting it false is silently overridden. |
| K6 | aws-iam-oidc-github | GitHub OIDC → AWS thumbprint no longer required | "GitHub Actions OIDC to AWS" | AWS now trusts GitHub's OIDC JWT signature directly; thumbprint_list still required by schema but accepts any value (use sentinel). |
| K7 | cloudflare-resource-renames-v5 | Cloudflare provider v5 mass-rename | "cloudflare_record" / "cloudflare_access_application" | Provider v5 (Sep 2024) renamed dozens: cloudflare_record → cloudflare_dns_record; cloudflare_access_* → cloudflare_zero_trust_access_*; cloudflare_teams_* → cloudflare_zero_trust_*. State migration required. |
| K8 | cloudflare-empty-subcategory | Cloudflare upstream docs lack subcategory | (internal/dev card) | Cloudflare markdown has empty subcategory: so manifest scoring degrades — the alias layer is the sole fix. |
| K9 | gcp-google-beta-split | google vs google-beta provider | "GCP cluster with Workload Identity" | Several features (some Workload Identity options, Cloud Run v2 fields, NCC) require provider = google-beta; mixing requires two required_providers blocks. |
| K10 | gcp-cloud-run-v2-default | Cloud Run v2 supersedes v1 | "google_cloud_run_service" | New work should use google_cloud_run_v2_service / _job; v1 stays for state compat but new features land only on v2. |
| K11 | azure-azurerm-v4-renames | azurerm v4 provider renames + behaviour changes | "azurerm_kubernetes_cluster default_node_pool" | v4 (Aug 2024) tightened defaults (e.g. default_node_pool.os_sku changed; azurerm_storage_account cross-tenant replication off by default); pin ~> 4.x and review plan diffs. |
| K12 | kubernetes-provider-v2-fields | kubernetes provider _v1 vs unsuffixed | "kubernetes_deployment vs kubernetes_deployment_v1" | The _v1 resources are the recommended versioned aliases; unsuffixed will eventually be removed. |
| K13 | helm-provider-v3 | helm provider v3 release_name behaviour | "helm_release name vs release_name" | helm provider v3 (Q4 2024) deprecates several positional defaults; name is strictly the release name; chart pulls from chart URL or local path. |
| K14 | datadog-monitor-v2-syntax | Datadog monitor query syntax v2 | "datadog_monitor for Lambda errors" | Tag scoping shifted to {aws_account:* AND functionname:foo}; legacy host: scoping silently no-ops on serverless metrics. |
| K15 | vault-kv-v2-mount | Vault KV v1 vs v2 mount path | "vault_kv_secret for our app" | KV v2 mounts require data/ in the path for the API but not for vault_kv_secret_v2.path; mixing produces 404s. |
| K16 | mongodb-atlas-cluster-vs-advanced | mongodbatlas_cluster deprecated | "M10 Atlas cluster" | mongodbatlas_cluster is deprecated in favour of mongodbatlas_advanced_cluster. |

Stretch: snowflake-grant-v0.93-rewrite, auth0-action-supersedes-rule, okta-app-oauth-pkce-default, digitalocean-app-spec-v2.

## 3. Recipe inventory — 10 cross-provider recipes

| # | id | providers | trigger prompt | resource skeleton |
|---|----|-----------|----------------|-------------------|
| R1 | zero-trust-cloudflare-aws-okta | aws, cloudflare, okta | "zero-trust internal app, cloudflare access + alb + okta" | cloudflare: zero_trust_access_application/policy/identity_provider; aws: lb, lb_listener, security_group (Cloudflare IPs only); okta: app_oauth |
| R2 | scalable-backend-aws-ecs-fargate-rds-datadog | aws, datadog | "ECS Fargate behind ALB, RDS, Datadog monitor" | aws: ecs_cluster/service/task_definition, lb/lb_listener/lb_target_group (target_type=ip), db_instance/db_subnet_group, appautoscaling_target/policy, security_group×3; datadog: monitor |
| R3 | github-oidc-to-aws-deploy-role | aws, github | "GitHub Actions OIDC to AWS terraform apply" | aws: iam_openid_connect_provider, iam_role (sub-claim restricted), iam_role_policy; github: actions_secret, actions_environment_secret |
| R4 | gke-cloudflare-dns-and-waf | cloudflare, gcp | "GKE app exposed via Cloudflare DNS + WAF" | gcp: container_cluster/node_pool, compute_global_address; cloudflare: dns_record, ruleset (waf), zone_settings_override |
| R5 | eks-with-irsa-and-alb-controller | aws, helm | "EKS with IRSA and AWS Load Balancer Controller" | aws: eks_cluster/node_group, iam_openid_connect_provider, iam_role (OIDC trust), iam_policy; helm: release (aws-load-balancer-controller) |
| R6 | serverless-webhook-aws-lambda-apigw-ddb | aws | "Lambda + API Gateway + DynamoDB for webhooks" | aws: lambda_function, apigatewayv2_api/route/integration, dynamodb_table, iam_role |
| R7 | gitops-atlantis-on-eks | aws, github, helm | "Atlantis on EKS for our TF monorepo" | aws: eks_*; github: repository_webhook, actions_secret; helm: release (atlantis) |
| R8 | vercel-deploy-with-neon-and-datadog | vercel, datadog | "Vercel + Postgres + Datadog RUM" | vercel: project, project_environment_variable, project_domain; datadog: synthetics_test, dashboard. (Neon not in 31 — backlog) |
| R9 | mongo-atlas-aws-privatelink | aws, mongodb-atlas | "Atlas cluster reachable via PrivateLink from VPC" | mongodb-atlas: advanced_cluster, privatelink_endpoint/endpoint_service; aws: vpc_endpoint, security_group |
| R10 | observability-grafana-cloud-dashboards-as-code | grafana, pagerduty | "Push dashboards-as-code to Grafana, alerts to PagerDuty" | grafana: dashboard, folder, contact_point, notification_policy; pagerduty: service, service_integration |

## 4. Concept-alias inventory — 28 aliases

### Cloudflare (12 — empty-subcategory remedy)
| phrase → alias | resource set |
|---|---|
| "protect from bots" → bot_protection | cloudflare_bot_management, cloudflare_turnstile_widget, cloudflare_ruleset (managed bot ruleset) |
| "rate limit api" → rate_limit | cloudflare_ruleset (rate-limit phase), cloudflare_api_shield_operation |
| "ddos protection" → ddos | cloudflare_ruleset (ddos_l7), cloudflare_zone_settings_override |
| "zero trust app" → access_app | cloudflare_zero_trust_access_application, cloudflare_zero_trust_access_policy |
| "vpn replacement" / "warp" → tunnel | cloudflare_zero_trust_tunnel_cloudflared, cloudflare_zero_trust_dns_location |
| "edge worker" → worker | cloudflare_workers_script, cloudflare_workers_route, cloudflare_workers_kv_namespace |
| "static site" → pages | cloudflare_pages_project, cloudflare_pages_domain |
| "object storage" → r2 | cloudflare_r2_bucket, cloudflare_r2_custom_domain |
| "managed database" → d1 | cloudflare_d1_database |
| "queues" → queues | cloudflare_queue, cloudflare_queue_consumer |
| "load balancer" → lb | cloudflare_load_balancer, cloudflare_load_balancer_pool, cloudflare_load_balancer_monitor |
| "waf custom rule" → waf | cloudflare_ruleset (http_request_firewall_custom phase) |

### AWS (8 plain-English)
"dev cluster" → eks_dev_cluster; "internal api gateway" → apigw_private; "static website" → s3_static_site; "queue with dlq" → sqs_dlq; "secret rotation" → secret_rotation; "vpn into vpc" → client_vpn; "service mesh" → service_mesh; "private artifact registry" → ecr_private.

### GCP (4)
"container app" → cloud_run_v2; "managed postgres" → cloud_sql_pg; "private gke" → gke_private; "workload identity" → wif.

### Azure (4)
"managed kubernetes" → aks; "function app" → function_app; "private endpoint" → private_endpoint; "managed identity" → managed_identity.

## 5. Soft-dependency expansion graph (top-30 resources)
Most encodable in each provider's MANIFEST.json `recommended_companions` field. Examples:
- aws_instance → aws_vpc, aws_subnet, aws_security_group, aws_internet_gateway, aws_route_table, aws_key_pair
- aws_lambda_function → aws_iam_role, aws_iam_role_policy, aws_cloudwatch_log_group, aws_lambda_permission
- aws_eks_cluster → aws_eks_node_group, aws_iam_role×2 (cluster+node), aws_iam_openid_connect_provider, aws_security_group, aws_subnet
- aws_ecs_service → aws_ecs_cluster, aws_ecs_task_definition, aws_lb, aws_lb_target_group, aws_lb_listener, aws_security_group, aws_iam_role
- aws_db_instance → aws_db_subnet_group, aws_security_group, aws_db_parameter_group, aws_kms_key
- aws_lb → aws_lb_listener, aws_lb_target_group, aws_security_group, aws_acm_certificate
- aws_s3_bucket → aws_s3_bucket_versioning, aws_s3_bucket_server_side_encryption_configuration, aws_s3_bucket_public_access_block, aws_s3_bucket_ownership_controls, aws_s3_bucket_lifecycle_configuration
- cloudflare_zero_trust_access_application → cloudflare_zero_trust_access_policy, cloudflare_zero_trust_access_identity_provider, cloudflare_dns_record
- cloudflare_workers_script → cloudflare_workers_route, cloudflare_workers_kv_namespace, cloudflare_r2_bucket, cloudflare_d1_database
- kubernetes_deployment → kubernetes_service, kubernetes_config_map, kubernetes_secret, kubernetes_namespace
- vault_kv_secret_v2 → vault_mount, vault_policy, vault_auth_backend
- snowflake_warehouse → snowflake_database, snowflake_role, snowflake_grant_privileges_to_role, snowflake_user

## 6. Beyond Terraform — next-30 doc surfaces

### Tier A — high-impact PaaS / GitOps / config-as-code (10)
1. Helm chart values schemas (top-100 charts)
2. ArgoCD Application / ApplicationSet CRDs
3. Flux CRDs (Kustomization, HelmRelease, GitRepository)
4. Kubernetes CRDs for top operators (cert-manager, external-secrets, knative, istio, linkerd)
5. OPA / Gatekeeper / Kyverno policies
6. Datadog dashboards / monitors as YAML (datadog-sync)
7. Grafana dashboards-as-code (grafonnet, jsonnet)
8. Vercel project config + edge config (vercel.json) — Vegastack uses this
9. Supabase config (supabase/config.toml + dashboard)
10. Neon / PlanetScale / Turso schema + branching APIs

### Tier B — service-discovery, secrets, control planes (10)
11. Consul config entries + service definitions
12. Nomad job specs
13. Pulumi programs (TS/Python/Go)
14. Crossplane XRDs / Compositions
15. AWS CDK constructs (TS)
16. AWS Control Tower / Azure Landing Zones
17. Doppler / Infisical
18. GitHub Actions reusable workflows
19. Sentry projects + alerts
20. OpenTelemetry Collector config

### Tier C — niche but high-leverage (10)
21. Tailscale ACLs + posture
22. HashiCorp Boundary
23. Terraform Cloud / HCP Terraform
24. Spacelift stacks + policies
25. Render / Fly.io / Railway manifests
26. Cloudflare Workers wrangler.toml
27. GitHub Codespaces / devcontainer.json
28. Stripe API resource provisioning
29. Linear / Jira automation rules
30. K6 / Grafana k6 scripts

Speculative ranking for next quarter: Helm-values, K8s CRDs (cert-manager, external-secrets), ArgoCD, Datadog YAML, Vercel vercel.json — cover majority of incremental queries with low marginal effort.

## 7. Phase 3 prioritisation
1. **Knowledge cards first** (16 in §2) — highest leverage per word; each overrides confidently-wrong training memory.
2. **Cloudflare aliases** (12 in §4) — without them, Cloudflare scoring is broken; empty subcategory: can't be fixed upstream by us.
3. **Soft-dep curation** (§5) — most encodable in recommended_companions; biggest win for A5 noob queries.
4. **Recipes** (10 in §3) — ship order: R3, R2, R5, R1, then rest.
5. **Personas** stay empty in v0.2 — no eval depends on it. Defer until telemetry.
6. **Eval expansion** — current 4 evals miss 8 of 12 archetypes. Add ≥1 eval per archetype before Phase 3 lands so card/recipe lift is measurable.
7. **Beyond-TF surfaces** (§6) is v0.4+, but stub bundle/<surface>/MANIFEST.json with same schema now so harness doesn't restructure later.

## Key findings
- Current state bare: 4 evals, 0 recipes, 0 personas, 0 aliases on disk. Anything authored in Phase 3 is greenfield.
- Harness already has right shape (4-channel envelope, manifest+example_usage enrichment, recommended_companions field). Phase 3 is **content authoring**, not engineering.
- Cloudflare's empty subcategory: is single biggest scoring weakness across 31 providers; aliases are only fix.
- Eval suite dangerously narrow — covers A1/A3/A6/A7, zero coverage of A2/A4/A8-A12. Close gap *first*, otherwise can't measure Phase 3 work.
- Vegastack's own product is Next.js+Vercel+Drizzle+Slack+Notion — confirms beyond-Terraform expansion isn't speculative.
