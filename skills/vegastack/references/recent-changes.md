# Recent Changes

The Registry ships date-stamped knowledge cards in each pack's `index/knowledge.json`. Each captures a recent change or risk signal such as a rename, deprecation, new default, or native-feature replacement. When the user asks "is X still valid?", "did Y change recently?", or "what's the modern way to do Z?", the card is the right starting point.

For card schema, frontmatter spec, and authoring guidelines see
[knowledge-cards.md](knowledge-cards.md). The installed pack's
`index/knowledge.json` is the source of truth for the current card list.

## The single workflow

```bash
vegastack ask --agent --pack terraform --tf-provider <provider> "<the user's exact phrasing>"
```

The envelope's `knowledge[]` returns every card whose triggers fire (token AND-within, OR-across; or substring `phrase` match). The card body is included inline; cite `authoritative_source` in your reply.

## Card Examples

| id | provider | summary | date |
|---|---|---|---|
| `aws-s3-native-state-locking` | aws | S3 backend supports `use_lockfile = true`; DynamoDB lock table now optional (AWS provider 5.55+ / TF 1.10+). | 2024-11-08 |
| `cloudflare-resource-renames-v5` | cloudflare | CF v5 renamed dozens of resources (`cloudflare_record` → `cloudflare_dns_record`); `terraform state mv` required. | 2024-09-15 |
| `azure-azurerm-v4-renames` | azure | azurerm v4 tightened defaults; renames; `identity {}` no longer accepts empty block. | 2024-08-22 |
| `mongodb-atlas-cluster-vs-advanced` | mongodb-atlas | `mongodbatlas_cluster` deprecated; use `mongodbatlas_advanced_cluster`. | 2024-07-30 |
| `gcp-cloud-run-v2-default` | gcp | Use `google_cloud_run_v2_service` / `_job` for new work; v1 maintenance-only. | 2024-06-12 |
| `datadog-monitor-v2-syntax` | datadog | Tag scoping changed; `host:` is a no-op on serverless; use `service:`. | 2024-05-20 |
| `aws-iam-oidc-github` | aws | AWS trusts GitHub's OIDC JWT directly; `thumbprint_list` accepts a sentinel value. | 2024-04-18 |
| `aws-s3-versioning-split` | aws | Inline `versioning {}` / `lifecycle_rule {}` on `aws_s3_bucket` deprecated; use per-feature resources. | 2024-03-01 |
| `aws-s3-bpa-default-on` | aws | S3 buckets created since Apr 2023 ship Block Public Access on, ACLs off by default. | 2024-02-14 |
| `kubernetes-provider-v2-fields` | kubernetes | Use `_v1`-suffixed versioned aliases; unversioned forms stuck on older API versions. | 2024-02-01 |
| `vault-kv-v2-mount` | vault | KV v2 needs `data/` segment in API path (not resource path); common 404 source on import. | 2024-01-22 |
| `helm-provider-v3` | helm | `name` on `helm_release` is the **release** name, not the chart name; v3 strict-validates. | 2023-12-10 |
| `aws-alb-rename` | aws | `aws_alb*` are aliases of canonical `aws_lb*`; prefer canonical for new code. | 2023-11-04 |
| `aws-ebs-encryption-default` | aws | `encrypted = false` silently overridden when account-default EBS encryption is enabled. | 2023-10-15 |
| `gcp-google-beta-split` | gcp | Some GCP features need `google-beta` provider; others split GA / beta variants. | 2023-09-08 |
| `cloudflare-empty-subcategory` | cloudflare | CF docs lack `subcategory:` frontmatter — alias layer is the only path NL queries hit. | 2023-08-01 |

## When to consult a card vs. a recipe vs. just the manifest

- **Knowledge card** — the *facts* changed (rename, deprecation, new default). Read first when the user asks "is X still valid?" or "what's the modern way?".
- **Recipe** — the *composition* of multiple resources is the question. Read first when the user asks for a stack ("zero-trust app", "GitOps pipeline").
- **Just the manifest** — single-resource queries. The envelope's `files[0].manifest_entry` answers directly.

## Freshness

Cards age. If a card stops boosting eval lift (archetype A12 in `evals/runner.ts`), it's a candidate for retirement. Until then, the dates above are authoritative — when training memory disagrees with a card whose `overrides_training: true`, the card wins.

## Citation

Cite the card by ID: `knowledge: aws-s3-native-state-locking (2024-11-08)`. Always include the `authoritative_source` URL from the card's frontmatter.
