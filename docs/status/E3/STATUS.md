# E3 — Content authoring STATUS

Wall-clock: ~75 min. Time budget: 120 min. Done within budget.

## Scope shipped

- 16 knowledge cards under `bundle/knowledge/`
- 10 recipes under `bundle/recipes/`
- 4 `aliases.yaml` files (cloudflare 12, aws 8, gcp 4, azure 4 = 28 aliases)
- 11 `companions.yaml` files (32 source keys / 109 companion entries — exceeds the §10.4 target of 30)

## Files authored / modified

### bundle/knowledge/ (16 NEW)
- aws-s3-native-state-locking.md
- aws-s3-bpa-default-on.md
- aws-s3-versioning-split.md
- aws-alb-rename.md
- aws-ebs-encryption-default.md
- aws-iam-oidc-github.md
- cloudflare-resource-renames-v5.md
- cloudflare-empty-subcategory.md
- gcp-google-beta-split.md
- gcp-cloud-run-v2-default.md
- azure-azurerm-v4-renames.md
- kubernetes-provider-v2-fields.md
- helm-provider-v3.md
- datadog-monitor-v2-syntax.md
- vault-kv-v2-mount.md
- mongodb-atlas-cluster-vs-advanced.md

### bundle/recipes/ (10 NEW)
- zero-trust-cloudflare-aws-okta.toml
- scalable-backend-aws-ecs-fargate-rds-datadog.toml
- github-oidc-to-aws-deploy-role.toml
- gke-cloudflare-dns-and-waf.toml
- eks-with-irsa-and-alb-controller.toml
- serverless-webhook-aws-lambda-apigw-ddb.toml
- gitops-atlantis-on-eks.toml
- vercel-deploy-with-neon-and-datadog.toml
- mongo-atlas-aws-privatelink.toml
- observability-grafana-cloud-dashboards-as-code.toml

### bundle/<provider>/aliases.yaml (4 NEW; cloudflare REPLACED E1 stub with full content)
- cloudflare/aliases.yaml — 12 entries
- aws/aliases.yaml — 8 entries
- gcp/aliases.yaml — 4 entries
- azure/aliases.yaml — 4 entries

### bundle/<provider>/companions.yaml (11 files; 4 REPLACED E1 stubs with full content; 7 NEW)
- aws/companions.yaml — 12 source keys, 49 entries (REPLACED stub)
- cloudflare/companions.yaml — 5 keys, 13 entries (REPLACED stub; cloudflare_zone_settings_override → cloudflare_zone_setting fix)
- kubernetes/companions.yaml — 4 keys, 12 entries (REPLACED stub)
- vault/companions.yaml — 2 keys, 6 entries (REPLACED stub)
- helm/companions.yaml — 1 key, 2 cross-provider entries (NEW)
- azure/companions.yaml — 2 keys, 7 entries (NEW)
- gcp/companions.yaml — 2 keys, 8 entries (NEW)
- snowflake/companions.yaml — 1 key, 5 entries (NEW)
- datadog/companions.yaml — 1 key, 2 entries (NEW)
- github/companions.yaml — 1 key, 3 entries (NEW)
- mongodb-atlas/companions.yaml — 1 key, 4 entries (NEW)

## Web-search fact-checks performed (April 2026)

| Topic | Result | Source URL used in card |
|---|---|---|
| AWS S3 native state locking (use_lockfile) | Confirmed: TF 1.10 introduced experimental, TF 1.11 marked dynamodb_table deprecated, dynamodb_endpoint and endpoints.dynamodb also deprecated. Card body updated accordingly. | https://developer.hashicorp.com/terraform/language/backend/s3 |
| AWS S3 BPA default-on April 2023 | Confirmed: April 27 2023 cut-over, all new buckets BPA on + ACLs disabled. | https://aws.amazon.com/about-aws/whats-new/2022/12/amazon-s3-automatically-enable-block-public-access-disable-access-control-lists-buckets-april-2023/ |
| AWS S3 inline versioning/encryption/lifecycle deprecated | Confirmed: deprecated since AWS provider v4; remain marked deprecated in v6. | https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket |
| aws_alb is alias of aws_lb | Confirmed: load_balancer_type selects ALB/NLB/Gateway. aws_alb resources NOT present in bundle manifest (verified). | https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb |
| EBS encryption-by-default | Confirmed: Region-specific; once enabled cannot be disabled per-volume; encrypted=false is silently overridden. | https://docs.aws.amazon.com/ebs/latest/userguide/encryption-by-default.html |
| GitHub OIDC thumbprint deprecation | Confirmed: AWS validates via root CAs since July 6 2023; thumbprint_list still required by schema, value ignored. | https://github.blog/changelog/2023-07-13-github-actions-oidc-integration-with-aws-no-longer-requires-pinning-of-intermediate-tls-certificates/ |
| Cloudflare provider v5 | Confirmed: GA Feb 2025, current 5.16+ as of Jan 2026, tf-migrate GA week of April 20 2026. v6 NOT YET RELEASED (as of Apr 28 2026). Card title/body kept as v5. | https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/guides/version-5-upgrade |
| azurerm v4 status | Confirmed: 4.70.0 published Apr 2026; v5 NOT YET RELEASED. Subscription_id required, list→set arg changes, AKS preview removed, Media Services + MariaDB resources removed. | https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/4.0-upgrade-guide |
| google-beta provider | Confirmed: superset of google; needed for some Workload Identity / Cloud Run / NCC fields. Recent additions verified (use_default_shared_ca on workload_identity_pool, node_selector on cloud_run_v2_job). | https://registry.terraform.io/providers/hashicorp/google-beta/latest/docs/guides/provider_versions |
| google_cloud_run_v2_service vs v1 | Confirmed: v1 not deprecated but v2 receives all new features; migration requires terraform import (different ID shape). | https://cloud.google.com/blog/products/devops-sre/migrating-terraform-resources-stablely-to-cloud-run-api-version-2/ |
| kubernetes provider _v1 versioned aliases | Confirmed: v2.7+ ships versioned suffixes; unsuffixed remain for compat but slated for removal. | https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/guides/versioned-resources |
| helm provider v3 | Confirmed: Q4 2024 GA on Plugin Framework, current 3.1.x as of Apr 2026. set/set_list/set_sensitive changed from blocks to lists of objects (silent breaking). | https://registry.terraform.io/providers/hashicorp/helm/latest/docs/guides/v3-upgrade-guide |
| Datadog monitor query syntax | Confirmed: tag scoping uses {tag_key:value, ...}; serverless metrics need aws_account+functionname (host: no-ops). | https://registry.terraform.io/providers/DataDog/datadog/latest/docs/resources/monitor |
| Vault KV v2 mount path | Confirmed: vault_kv_secret_v2.name uses logical path WITHOUT data/; policy paths DO include data/. | https://registry.terraform.io/providers/hashicorp/vault/latest/docs/resources/kv_secret_v2 |
| mongodbatlas_cluster deprecation | Confirmed: deprecated, advanced_cluster preferred for multi-cloud, asymmetric sharding, analytics independent scaling. | https://registry.terraform.io/providers/mongodb/mongodbatlas/latest/docs/resources/advanced_cluster |
| AWS provider v6.0 (April 2026) | Confirmed shipped April 2026. Did NOT change fundamentals of S3 native locking (Terraform-core feature), ALB rename, IAM OIDC, or S3 inline-block deprecations referenced in cards. No card needed substitution. | (logged here; not used as authoritative_source) |

## Substitutions made

None. All 16 plan-prescribed card subjects remain accurate as of April 28 2026:
- Cloudflare v5 still current (no v6 shipped)
- azurerm still v4 (no v5 shipped)
- mongodbatlas_cluster still deprecated (replacement is advanced_cluster)
- Cloud Run v2 still recommended for new work
- helm v3 current
- Vault KV v2 mount semantics unchanged

The AWS v6 release (April 2026) was checked for impact on each AWS card; none of
the card content premises were invalidated by v6.

## Validation performed

1. **YAML parse** — every `aliases.yaml` and `companions.yaml` parsed by `yaml.safe_load` (Python 3.9 + PyYAML).
2. **TOML parse** — every recipe parsed by `tomli` (since Python 3.11+ tomllib was unavailable on the host). All 10 valid; required keys (`id, providers, triggers, scaffold.hcl, [[pitfalls]]`) present; every recipe has ≥2 pitfalls.
3. **Knowledge frontmatter** — every card's `---`-delimited frontmatter parsed as YAML with required keys (`id, title, date_authored, authoritative_source, providers, triggers, overrides_training`). All 16 valid.
4. **Manifest cross-check** — every `resources[]` entry in aliases.yaml and every companion entry validated against `bundle/<provider>/MANIFEST.json` via jq. Result: 221 OK, 0 errors. The only 2 cross-provider companions (helm → kubernetes_namespace_v1 / kubernetes_service_account_v1) were verified to exist in `bundle/kubernetes/MANIFEST.json`.
5. **Resource-name corrections** — caught and fixed:
   - Cloudflare: `cloudflare_zone_settings_override` (does NOT exist in v5 manifest) → replaced with `cloudflare_zone_setting`
   - GCP: `google_*` names do NOT exist in `bundle/gcp/MANIFEST.json`; bundle uses `gcp_*` prefix. Used `gcp_*` everywhere.
   - Azure: same — bundle uses `azure_*` not `azurerm_*`. Used `azure_*` everywhere.
   - GCP service-account: bundle key is `gcp_google_service_account` (preserved upstream double-prefix), not `gcp_service_account`.
   - MongoDB Atlas: bundle uses `mongodb-atlas_*` (with hyphen in provider segment), not `mongodbatlas_*`.
   - Snowflake: v0.93+ uses `snowflake_account_role` and `snowflake_grant_privileges_to_account_role` not `snowflake_role` / `snowflake_grant_privileges_to_role`. Used the v0.93+ names (only ones in manifest).

## Cross-team contract

- **E1**: stubs at `aws/companions.yaml`, `cloudflare/companions.yaml`, `cloudflare/aliases.yaml`, `kubernetes/companions.yaml`, `vault/companions.yaml` were REPLACED with full content (per the brief: "if E1 already wrote a stub, REPLACE it with your full content"). E1's `build_companions.py` and `build_aliases.py` will read these files unchanged.
- **E2**: knowledge frontmatter and recipe TOML keys conform to format-examples.md §1, §2, §3, §4 verbatim — no contract issues raised.

## Blocked / open / for audit

- **No blockers.** All targeted resources existed in the relevant MANIFEST.json after my corrections.
- **For audit**: spot-check that runtime tokenizer matches the alias `phrase` strings case-insensitively (per format-examples.md §3). All phrases in aliases.yaml are lowercase to match expected normalisation.
- **For audit**: knowledge card `triggers.tokens` use lowercase tokens with provider-prefixed resource names where the resource name is the token signal (e.g. `[aws_alb, aws_lb]`); confirm tokenizer splits on underscore or treats them as a unit before scoring.
- **Stretch cards** mentioned in R4 §2 ("snowflake-grant-v0.93-rewrite, auth0-action-supersedes-rule, okta-app-oauth-pkce-default, digitalocean-app-spec-v2") were NOT authored — those are explicitly stretch goals, plan §10.1 enumerates only 16.

## Build / typecheck / lint

N/A — content authoring only; no code changes.

## npm installs

None — content authoring only. (Used existing system Python + PyYAML + jq; installed `tomli` once for recipe validation.)
