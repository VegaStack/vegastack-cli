# Concept aliases (v0.1)

Concept aliases map natural-language phrases to specific resource sets, on a per-provider basis. They live at `bundle/<provider>/aliases.yaml` and are consumed by the harness's `loadAliases()` (folded into `tokenize()` for phrase rewrites and into `synthetic_subcategories` at manifest-build time, so they participate in normal Tier-1 scoring).

## File schema

```yaml
- phrase: "protect from bots"
  alias: bot_protection
  resources:
    - cloudflare_bot_management
    - cloudflare_turnstile_widget
    - cloudflare_ruleset
  rule_phase: bot_management            # CF-specific; for ruleset phases
- phrase: "rate limit api"
  alias: rate_limit
  resources:
    - cloudflare_ratelimit
    - cloudflare_ruleset
  rule_phase: http_ratelimit
```

`phrase` is matched as a case-insensitive substring against the original query. When a phrase fires, the listed `resources[]` are inserted into the query's effective token set, **and** the match is recorded in the response's `concept_aliases_used[]` for transparency.

`rule_phase` is optional and used only by Cloudflare aliases that target a specific ruleset phase.

## Per-provider inventory (28 aliases across 4 providers)

E3 ships these. Total: 12 + 8 + 4 + 4 = 28.

### `bundle/cloudflare/aliases.yaml` (12 aliases)

| alias | phrase examples | resources |
|---|---|---|
| `bot_protection` | "protect from bots", "block scrapers" | `cloudflare_bot_management`, `cloudflare_turnstile_widget`, `cloudflare_ruleset` (phase=bot_management) |
| `rate_limit` | "rate limit api", "throttle requests" | `cloudflare_ratelimit`, `cloudflare_ruleset` (phase=http_ratelimit) |
| `ddos_protection` | "ddos protection", "absorb ddos" | `cloudflare_ruleset` (phase=ddos_l7), `cloudflare_zone_settings_override` |
| `zero_trust` | "zero trust app", "private app behind cf" | `cloudflare_zero_trust_access_application`, `cloudflare_zero_trust_access_policy`, `cloudflare_zero_trust_access_identity_provider` |
| `tunnel` | "expose private service", "cf tunnel" | `cloudflare_zero_trust_tunnel_cloudflared`, `cloudflare_zero_trust_tunnel_cloudflared_config` |
| `worker` | "edge function", "cf worker" | `cloudflare_workers_script`, `cloudflare_workers_route`, `cloudflare_workers_kv_namespace` |
| `pages` | "deploy static site to cf" | `cloudflare_pages_project`, `cloudflare_pages_domain` |
| `r2` | "object storage on cf", "s3-compatible cf" | `cloudflare_r2_bucket`, `cloudflare_r2_custom_domain` |
| `d1` | "sqlite on cf edge" | `cloudflare_d1_database` |
| `queues` | "cf queue", "edge messaging" | `cloudflare_queue` |
| `lb` | "cf load balancer", "geo-routing" | `cloudflare_load_balancer`, `cloudflare_load_balancer_pool`, `cloudflare_load_balancer_monitor` |
| `waf` | "block sql injection", "cf waf rule" | `cloudflare_ruleset` (phase=http_request_firewall_managed), `cloudflare_ruleset` (phase=http_request_firewall_custom) |

### `bundle/aws/aliases.yaml` (8 aliases)

| alias | phrase examples | resources |
|---|---|---|
| `dev_cluster` | "ephemeral dev cluster on aws" | `aws_eks_cluster` (size class small), `aws_eks_node_group`, `aws_iam_role` |
| `apigw_private` | "private api gateway", "internal api gw" | `aws_apigatewayv2_api`, `aws_apigatewayv2_vpc_link` |
| `s3_static_site` | "host static site on s3" | `aws_s3_bucket`, `aws_s3_bucket_website_configuration`, `aws_cloudfront_distribution`, `aws_acm_certificate` |
| `sqs_dlq` | "dead letter queue", "sqs dlq" | `aws_sqs_queue` (×2), `aws_sqs_queue_redrive_policy` |
| `secret_rotation` | "rotate db password", "secrets manager rotation" | `aws_secretsmanager_secret`, `aws_secretsmanager_secret_rotation`, `aws_lambda_function` |
| `client_vpn` | "site-to-site vpn", "client vpn endpoint" | `aws_ec2_client_vpn_endpoint`, `aws_ec2_client_vpn_network_association` |
| `service_mesh` | "service mesh on ecs" | `aws_appmesh_mesh`, `aws_appmesh_virtual_service`, `aws_appmesh_virtual_router` |
| `ecr_private` | "private docker registry on aws" | `aws_ecr_repository`, `aws_ecr_repository_policy`, `aws_ecr_lifecycle_policy` |

### `bundle/gcp/aliases.yaml` (4 aliases)

| alias | phrase examples | resources |
|---|---|---|
| `cloud_run_v2` | "serverless container gcp" | `google_cloud_run_v2_service`, `google_cloud_run_v2_job`, `google_service_account` |
| `cloud_sql_pg` | "managed postgres gcp" | `google_sql_database_instance`, `google_sql_database`, `google_sql_user` |
| `gke_private` | "private gke cluster" | `google_container_cluster` (private_cluster_config block), `google_container_node_pool`, `google_compute_network` |
| `wif` | "workload identity federation" | `google_iam_workload_identity_pool`, `google_iam_workload_identity_pool_provider`, `google_service_account_iam_member` |

### `bundle/azure/aliases.yaml` (4 aliases)

| alias | phrase examples | resources |
|---|---|---|
| `aks` | "managed kubernetes azure" | `azurerm_kubernetes_cluster`, `azurerm_kubernetes_cluster_node_pool` |
| `function_app` | "azure functions", "serverless azure" | `azurerm_linux_function_app`, `azurerm_function_app_slot`, `azurerm_storage_account` |
| `private_endpoint` | "private link azure", "vnet integration" | `azurerm_private_endpoint`, `azurerm_private_dns_zone`, `azurerm_private_dns_zone_virtual_network_link` |
| `managed_identity` | "msi", "system-assigned identity" | `azurerm_user_assigned_identity`, `azurerm_role_assignment` |

## How aliases land in the response

The `concept_aliases_used[]` array contains one entry per alias that fired:

```json
{
  "phrase": "protect from bots",
  "provider": "cloudflare",
  "matched_alias": "bot_protection",
  "resources": ["cloudflare_bot_management", "cloudflare_turnstile_widget", "cloudflare_ruleset"],
  "rule_phase": "bot_management"
}
```

Cite the matched phrase in your reply when an alias fires — it makes the NL → resource mapping legible to the user ("interpreting 'protect from bots' as Cloudflare bot management — using `cloudflare_bot_management`, …").

## Authoring guidelines

- **Aliases are per-provider.** A phrase that fires on AWS should not also fire on Cloudflare; if you need cross-provider phrasing, that's a recipe, not an alias.
- **`phrase` should be the user's words, not the provider's.** "Protect from bots" not "WAF managed bot ruleset".
- **`resources[]` should be the minimal viable resource set** for the alias. If three resources always go together, list all three; if one resource is sometimes needed, leave it out.
- **`rule_phase` only applies to Cloudflare** rulesets — other providers can omit it.
