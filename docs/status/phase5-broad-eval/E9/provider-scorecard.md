# E9 cross-provider scorecard

**76 prompts** across **31 providers**, 12 archetypes (A1-A12), 5 personas. 
Each prompt was run via the TS `vega tf` against bundle 
`/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`. 
Manifest-side scoring only (no LLM, no API key) — covers 
`resource_present`, `no_resource`, `import_syntax_match`, `cites_card`, `cites_recipe`, `cites_path`. 
Cross-provider topology prompts that returned `status=ambiguous` were re-run once 
per candidate provider and the file/knowledge/recipe sets unioned.


## Headline numbers

- mean **manifest_score** across all 76 prompts: **0.623**
- full-pass prompts (score=1.0): **32/76**
- zero-pass prompts (score=0.0): **12/76**
- knowledge-card hit rate: **2/7** (28.6%)
- recipe hit rate: **0/0** (0.0%)
- prompts where any concept-alias fired: **2/76** (2.6%)
- prompts where grep-fallback (tier2) fired: **52/76**
- prompts with provider undetected/error after merge: **5/76**

## Archetype scores

| Archetype | n | mean manifest_score |
|---|---|---|
| A1 | 19 | 0.579 |
| A10 | 3 | 0.500 |
| A11 | 3 | 0.667 |
| A12 | 4 | 0.541 |
| A2 | 5 | 1.000 |
| A3 | 5 | 1.000 |
| A4 | 4 | 0.792 |
| A5 | 4 | 0.667 |
| A6 | 7 | 0.536 |
| A7 | 14 | 0.434 |
| A8 | 4 | 0.500 |
| A9 | 4 | 0.750 |

## Per-provider scorecard

| Provider | n prompts | mean conf | mean top1 norm | mean manifest_score | card hit | recipe hit | alias hit | error |
|---|---|---|---|---|---|---|---|---|
| local | 2 | 0.200 | 10 | 0.000 | 0/0 | 0/0 | 0 | 0 |
| tls | 2 | 0.200 | 36.2 | 0.125 | 0/0 | 0/0 | 0 | 0 |
| crowdstrike | 2 | — | 58.1 | 0.167 | 0/0 | 0/0 | 0 | 0 |
| mongodb-atlas | 3 | — | 93.8 | 0.222 | 0/1 | 0/0 | 0 | 0 |
| cloudflare | 4 | 1 | 87.5 | 0.312 | 0/0 | 0/0 | 1 | 0 |
| github | 3 | 1 | 34.7 | 0.333 | 0/0 | 0/0 | 0 | 0 |
| clickhouse | 2 | — | 70.3 | 0.334 | 0/0 | 0/0 | 0 | 0 |
| kubernetes | 3 | 1 | 69.8 | 0.389 | 0/1 | 0/0 | 0 | 0 |
| aws | 15 | 0.867 | 60.0 | 0.428 | 0/0 | 0/0 | 0 | 0 |
| gitlab | 4 | 1 | 50.5 | 0.458 | 0/0 | 0/0 | 0 | 0 |
| helm | 7 | 0.840 | 61.5 | 0.488 | 0/2 | 0/0 | 0 | 0 |
| azure | 2 | 0.600 | 53.8 | 0.500 | 0/0 | 0/0 | 1 | 0 |
| time | 2 | 0.800 | 50.6 | 0.500 | 0/0 | 0/0 | 0 | 0 |
| datadog | 5 | 1 | 81.1 | 0.567 | 1/1 | 0/0 | 0 | 0 |
| auth0 | 2 | 1 | 81.6 | 0.584 | 0/0 | 0/0 | 0 | 0 |
| redis-cloud | 3 | 0.900 | 65.9 | 0.611 | 0/0 | 0/0 | 0 | 0 |
| snowflake | 9 | 1 | 80.7 | 0.648 | 0/0 | 0/0 | 0 | 0 |
| digitalocean | 2 | 1 | 100 | 0.666 | 0/0 | 0/0 | 0 | 0 |
| netlify | 2 | 1 | 61.9 | 0.666 | 0/0 | 0/0 | 0 | 0 |
| gcp | 3 | 1 | 56.7 | 0.667 | 0/1 | 0/0 | 0 | 0 |
| okta | 5 | 1 | 61.9 | 0.700 | 0/0 | 0/0 | 0 | 0 |
| ansible | 2 | 1 | 45.9 | 0.750 | 0/0 | 0/0 | 0 | 0 |
| external | 2 | 0.600 | 51.9 | 0.750 | 0/0 | 0/0 | 0 | 0 |
| vault | 8 | 1 | 72.2 | 0.750 | 1/1 | 0/0 | 1 | 0 |
| vercel | 5 | 1 | 86.0 | 0.767 | 0/0 | 0/0 | 0 | 0 |
| 1password | 2 | 1 | 64.4 | 0.834 | 0/0 | 0/0 | 0 | 0 |
| splunk | 2 | 1 | 69.7 | 0.834 | 0/0 | 0/0 | 0 | 0 |
| random | 2 | 1 | 77.5 | 0.875 | 0/0 | 0/0 | 0 | 0 |
| pinecone | 3 | 1 | 60.2 | 0.889 | 0/0 | 0/0 | 0 | 0 |
| grafana | 3 | 1 | 88.3 | 0.917 | 0/0 | 0/0 | 0 | 0 |
| pagerduty | 4 | 1 | 77.3 | 0.938 | 0/0 | 0/0 | 0 | 0 |

## Bottom 5 providers (by manifest_score)

- **local** — manifest_score 0.000
- **tls** — manifest_score 0.125
- **crowdstrike** — manifest_score 0.167
- **mongodb-atlas** — manifest_score 0.222
- **cloudflare** — manifest_score 0.312

## Top 5 providers (by manifest_score)

- **pagerduty** — manifest_score 0.938
- **grafana** — manifest_score 0.917
- **pinecone** — manifest_score 0.889
- **random** — manifest_score 0.875
- **1password** — manifest_score 0.834

## Per-prompt detail

| id | archetype | persona | provider | top1 norm | manifest_score | knowledge | recipes | aliases |
|---|---|---|---|---|---|---|---|---|
| E9-A1-snowflake-warehouse | A1 | PlatformEngineer | snowflake | 95.6 | 1.000 | — | — | — |
| E9-A1-clickhouse-service | A1 | PlatformEngineer | aws+clickhouse | 67.5 | 0.000 | — | — | — |
| E9-A1-pinecone-rag-index | A1 | PlatformEngineer | aws+pinecone | 46.3 | 1.000 | — | — | — |
| E9-A1-1password-item | A1 | SecurityEngineer | 1password | 93.8 | 1.000 | — | — | — |
| E9-A1-helm-cert-manager | A1 | PlatformEngineer | aws | 58.8 | 0.000 | — | — | — |
| E9-A1-tls-self-signed | A1 | PlatformEngineer | local | 10 | 0.000 | — | — | — |
| E9-A1-time-rotating | A1 | SecurityEngineer | aws | 53.8 | 0.000 | — | — | — |
| E9-A1-random-password | A1 | PlatformEngineer | aws | 67.5 | 1.000 | — | — | — |
| E9-A1-local-file-render | A1 | JuniorDev | None | — | 0.000 | — | — | — |
| E9-A1-external-data | A1 | PlatformEngineer | external | 17.5 | 1.000 | — | — | — |
| E9-A1-ansible-host | A1 | PlatformEngineer | ansible | 80.6 | 1.000 | — | — | — |
| E9-A1-auth0-action | A1 | PlatformEngineer | auth0 | 86.3 | 0.500 | — | — | — |
| E9-A1-okta-oidc-app | A1 | SecurityEngineer | okta | 61.3 | 0.000 | — | — | — |
| E9-A1-redis-cloud-subscription | A1 | PlatformEngineer | aws+redis-cloud | 55 | 0.500 | — | — | — |
| E9-A1-splunk-index | A1 | SRE | splunk | 47.5 | 1.000 | — | — | — |
| E9-A1-netlify-dns-record | A1 | JuniorDev | netlify | 30 | 1.000 | — | — | — |
| E9-A1-vercel-project | A1 | JuniorDev | vercel | 78.8 | 1.000 | — | — | — |
| E9-A1-digitalocean-droplet | A1 | JuniorDev | digitalocean | 100 | 1.000 | — | — | — |
| E9-A1-crowdstrike-host-group | A1 | SecurityEngineer | aws+crowdstrike | 45 | 0.000 | — | — | — |
| E9-A2-snowflake-grant-args | A2 | PlatformEngineer | snowflake | 82.5 | 1.000 | — | — | — |
| E9-A2-vault-database-secret-args | A2 | PlatformEngineer | vault | 82.5 | 1.000 | — | — | — |
| E9-A2-pagerduty-service-args | A2 | SRE | pagerduty | 45 | 1.000 | — | — | — |
| E9-A2-grafana-dashboard-args | A2 | SRE | grafana | 100 | 1.000 | — | — | — |
| E9-A2-helm-release-args | A2 | PlatformEngineer | helm | 75 | 1.000 | — | — | — |
| E9-A3-import-snowflake-database | A3 | PlatformEngineer | snowflake | 91.9 | 1.000 | — | — | — |
| E9-A3-import-okta-group | A3 | SecurityEngineer | okta | 91.9 | 1.000 | — | — | — |
| E9-A3-import-grafana-folder | A3 | SRE | grafana | 84.4 | 1.000 | — | — | — |
| E9-A3-import-vercel-project | A3 | JuniorDev | vercel | 100 | 1.000 | — | — | — |
| E9-A3-import-pagerduty-service | A3 | SRE | pagerduty | 91.9 | 1.000 | — | — | — |
| E9-A4-vault-kv-v1-to-v2 | A4 | SecurityEngineer | vault | 88.1 | 1.000 | vault-kv-v2-mount | — | — |
| E9-A4-snowflake-grant-rewrite | A4 | PlatformEngineer | snowflake | 86.3 | 1.000 | — | — | — |
| E9-A4-helm-v3-rename | A4 | PlatformEngineer | helm | 60 | 0.500 | — | — | — |
| E9-A4-k8s-v1-suffix | A4 | PlatformEngineer | kubernetes | 69.4 | 0.667 | — | — | — |
| E9-A5-aks-soft-deps | A5 | JuniorDev | azure | 51.2 | 0.333 | — | — | — |
| E9-A5-cloud-run-soft-deps | A5 | JuniorDev | gcp | 70 | 0.667 | — | — | — |
| E9-A5-pinecone-soft-deps | A5 | PlatformEngineer | pinecone | 99.4 | 1.000 | — | — | — |
| E9-A5-clickhouse-soft-deps | A5 | PlatformEngineer | aws+clickhouse | 73.1 | 0.667 | — | — | — |
| E9-A6-grafana-slo-dashboard-pack | A6 | SRE | grafana+pagerduty | 80.6 | 0.750 | — | — | — |
| E9-A6-snowflake-warehouse-rbac | A6 | PlatformEngineer | snowflake | 52 | 0.333 | — | — | — |
| E9-A6-vault-pki-intermediate | A6 | SecurityEngineer | vault | 55 | 1.000 | — | — | — |
| E9-A6-gitlab-project-bootstrap | A6 | PlatformEngineer | aws+gitlab | 48.8 | 0.333 | — | — | — |
| E9-A6-cloudflare-workers-d1-r2 | A6 | PlatformEngineer | cloudflare | 93.8 | 0.333 | — | — | — |
| E9-A6-datadog-aws-integration | A6 | SRE | aws+datadog | 60 | 0.333 | — | — | — |
| E9-A7-helm-cert-manager-route53 | A7 | PlatformEngineer | aws | 50 | 0.250 | — | — | — |
| E9-A7-vault-dynamic-postgres-on-k8s | A7 | SecurityEngineer | kubernetes+vault+aws | 90 | 0.000 | — | — | — |
| E9-A7-pinecone-vault-1password | A7 | SecurityEngineer | 1password+pinecone | 35 | 0.667 | — | — | — |
| E9-A7-tls-acm-cloudflare | A7 | PlatformEngineer | aws+cloudflare+tls | 62.5 | 0.250 | — | — | — |
| E9-A7-random-secrets-rds-rotation | A7 | SecurityEngineer | aws | 87.5 | 0.750 | — | — | — |
| E9-A7-vercel-cloudflare-workers-ab | A7 | PlatformEngineer | cloudflare+netlify+vercel | 93.8 | 0.333 | — | — | — |
| E9-A7-crowdstrike-on-aws | A7 | SecurityEngineer | aws+crowdstrike | 71.3 | 0.333 | — | — | — |
| E9-A7-splunk-to-otel-datadog | A7 | SRE | datadog+splunk+aws | 91.9 | 0.667 | — | — | — |
| E9-A7-ansible-gitlab-github | A7 | PlatformEngineer | ansible+github+gitlab+aws | 11.3 | 0.500 | — | — | — |
| E9-A7-auth0-action-external-claim | A7 | PlatformEngineer | auth0+vault | 76.9 | 0.667 | — | — | — |
| E9-A7-redis-elasticache-mongo | A7 | SRE | mongodb-atlas+redis-cloud+aws | 93.8 | 0.333 | — | — | — |
| E9-A7-gitlab-tfc-pipeline | A7 | PlatformEngineer | gitlab | 91.9 | 0.500 | — | — | — |
| E9-A7-snowflake-datadog | A7 | PlatformEngineer | datadog+snowflake | 78.8 | 0.500 | — | — | — |
| E9-A7-do-app-cf-dns | A7 | JuniorDev | cloudflare+datadog+digitalocean | 100 | 0.333 | — | — | — |
| E9-A8-snowflake-network-policy | A8 | SecurityEngineer | aws+snowflake | 58.8 | 0.000 | — | — | — |
| E9-A8-okta-mfa-policy | A8 | SecurityEngineer | okta | 65 | 1.000 | — | — | — |
| E9-A8-github-branch-protection | A8 | SecurityEngineer | None | — | 0.000 | — | — | — |
| E9-A8-gcp-org-policy-encryption | A8 | SecurityEngineer | gcp | 53.8 | 1.000 | — | — | — |
| E9-A9-snowflake-cost-cut | A9 | FinOps | snowflake | 100 | 1.000 | — | — | — |
| E9-A9-mongo-atlas-cost-cut | A9 | FinOps | None | — | 0.000 | — | — | — |
| E9-A9-redis-cloud-cost-cut | A9 | FinOps | redis-cloud | 48.8 | 1.000 | — | — | — |
| E9-A9-vercel-bandwidth | A9 | FinOps | vercel | 99.4 | 1.000 | — | — | — |
| E9-A10-gitlab-ci-pipeline | A10 | PlatformEngineer | aws+gitlab | 50 | 0.500 | — | — | — |
| E9-A10-github-actions-deploy-vercel | A10 | PlatformEngineer | vercel | 58.1 | 0.500 | — | — | — |
| E9-A10-helm-argocd | A10 | PlatformEngineer | aws+okta+helm | 50 | 0.500 | — | eks-with-irsa-and-alb-controller | — |
| E9-A11-cycle-okta-app-secret | A11 | SecurityEngineer | okta | 41.3 | 1.000 | — | — | — |
| E9-A11-snowflake-suspend-resume | A11 | FinOps | None | — | 0.000 | — | — | — |
| E9-A11-pagerduty-maintenance-window | A11 | SRE | pagerduty | 91.9 | 1.000 | — | — | — |
| E9-A12-helm-v3-changes | A12 | PlatformEngineer | helm | 45 | 0.500 | — | — | — |
| E9-A12-mongodb-cluster-replaced | A12 | PlatformEngineer | None | — | 0.333 | — | — | — |
| E9-A12-cloud-run-v1-still-supported | A12 | JuniorDev | gcp | 46.3 | 0.333 | — | — | — |
| E9-A6-azure-keyvault-soft-deps | A6 | SecurityEngineer | azure+vault | 56.3 | 0.667 | — | — | — |
| E9-A12-datadog-monitor-tag-syntax | A12 | SRE | datadog | 75 | 1.000 | datadog-monitor-v2-syntax | — | — |