# Knowledge cards (v0.1)

Knowledge cards are date-stamped records capturing **recent changes** in any pack — renames, deprecations, pricing shifts, native features that obsolete previous patterns. In the Registry architecture they are generated into each installed pack under `index/knowledge.json`.

## Frontmatter schema

```yaml
---
id: aws-s3-native-state-locking            # globally unique, kebab-case
title: S3 native state locking obsoletes DynamoDB
date_authored: 2024-06-15                  # ISO8601 date
authoritative_source: https://aws.amazon.com/blogs/...
providers: [aws]                           # ["aws", "cloudflare"], or ["*"] for cross-cutting
triggers:                                   # ANY trigger fires the card; AND within a trigger
  - { tokens: [s3, backend, lock] }        # ALL tokens must match the query's tokens
  - { tokens: [dynamodb, state, lock] }
  - { phrase: "do I need dynamodb for terraform state" }  # substring match, case-insensitive
overrides_training: true                   # signals "trust this card over model memory"
---

Body markdown — multi-paragraph allowed. Cite sources inline.
```

`triggers[]` is the matching engine. The card fires when **any** trigger matches:

- `{tokens: [a, b, c]}` — fires iff every token in the list is present in the query's tokenized form (post-alias-expansion).
- `{phrase: "..."}` — case-insensitive substring match against the original query string.

`overrides_training: true` is the signal to the agent: this is a post-training-cutoff fact the maintainer explicitly verified. Trust the card and cite its `authoritative_source` in your reply.

## Terraform card examples

The Terraform Registry pack includes generated cards in its installed
`index/knowledge.json`. Use that file as the source of truth; the IDs below are
examples that eval prompts may reference.

| id | one-line summary |
|---|---|
| `aws-s3-native-state-locking` | S3 `use_lockfile = true` makes DynamoDB optional (AWS provider 5.55+ / Terraform 1.10+). Triggers: `{tokens: [s3,backend,lock]}`, `{tokens: [dynamodb,state,lock]}`. |
| `aws-s3-bpa-default-on` | S3 buckets created since Apr 2023 ship Block Public Access on and ACLs off by default. Triggers: `{tokens: [s3,public,access]}`, `{phrase: "make this s3 bucket public"}`. |
| `aws-s3-versioning-split` | Inline `versioning {}`, `lifecycle_rule {}`, `server_side_encryption {}` on `aws_s3_bucket` are deprecated; use the per-feature resources. Triggers: `{tokens: [s3,bucket,versioning]}`. |
| `aws-alb-rename` | `aws_alb*` resources are aliases of `aws_lb*` (the latter is canonical). Triggers: `{tokens: [aws_alb]}`. |
| `aws-ebs-encryption-default` | `encrypted=false` is silently overridden when account-default EBS encryption is on. Triggers: `{tokens: [ebs,encryption]}`. |
| `aws-iam-oidc-github` | AWS now trusts GitHub's OIDC JWT directly; `thumbprint_list` accepts a sentinel value. Triggers: `{tokens: [iam,oidc,github]}`. |
| `cloudflare-resource-renames-v5` | CF provider v5 (Sep 2024) mass-renamed many resources (`cloudflare_record` → `cloudflare_dns_record`, etc). State migration required. Triggers: `{tokens: [cloudflare_record]}`, `{phrase: "cloudflare provider v5"}`. |
| `cloudflare-empty-subcategory` | CF docs lack `subcategory:` frontmatter; generated aliases are the reliable way NL queries hit. Triggers: `{phrase: "cloudflare subcategory"}`. |
| `gcp-google-beta-split` | Some GCP features need the `google-beta` provider; others split between GA and beta variants of the same resource. Triggers: `{tokens: [google_beta]}`. |
| `gcp-cloud-run-v2-default` | Use `google_cloud_run_v2_service` / `_job` for new work; v1 is in maintenance. Triggers: `{tokens: [cloud_run]}`. |
| `azure-azurerm-v4-renames` | azurerm v4 (Aug 2024) tightened defaults and renamed some resources. Triggers: `{tokens: [azurerm,v4]}`. |
| `kubernetes-provider-v2-fields` | Use the `_v1`-suffixed versioned aliases (`kubernetes_deployment_v1`); the unversioned forms are stuck on older API versions. Triggers: `{tokens: [kubernetes_deployment]}`. |
| `helm-provider-v3` | `name` on `helm_release` is strictly the release name, not the chart name. Triggers: `{tokens: [helm_release,name]}`. |
| `datadog-monitor-v2-syntax` | Tag scoping shifted in v2; `host:` is a no-op on serverless. Triggers: `{tokens: [datadog_monitor,scope]}`. |
| `vault-kv-v2-mount` | KV v2 needs `data/` in the API path, not the resource path; common 404 source. Triggers: `{tokens: [vault_kv,v2]}`. |
| `mongodb-atlas-cluster-vs-advanced` | `mongodbatlas_cluster` is deprecated; use `mongodbatlas_advanced_cluster`. Triggers: `{tokens: [mongodbatlas_cluster]}`. |

The Registry sync owns the bodies and `authoritative_source` URLs for each card. The CLI reads `index/knowledge.json` from installed Registry packs and matches trigger-like evidence against query tokens.

## How knowledge cards land in the response

The `knowledge[]` array in `vegastack ask`'s response contains every card whose triggers fired, in order of trigger specificity (more-specific triggers — longer token lists, exact phrases — sort first). The `KnowledgeCard` shape mirrors the frontmatter plus a `body: string` field with the post-frontmatter markdown.

## Authoring guidelines

- **Cards are date-stamped.** A card without `date_authored` is rejected by the validator. Prefer the date the *upstream change* happened, not the date you authored the card.
- **`authoritative_source` must be a stable URL.** Provider changelogs, AWS blog posts, official deprecation notices. Avoid Stack Overflow / Reddit / personal blogs.
- **`triggers[]` should be specific.** A card that fires on every AWS query is noise. Use the smallest token set that uniquely identifies the topic.
- **`overrides_training: false` is allowed** for cards that *augment* model knowledge rather than overriding it (e.g. "here's the recommended pattern for X"). Default to `true` for deprecation / rename / replacement cards.

## Freshness

Cards age. The eval suite (archetype A12, "deprecation/recent-change") catches obvious staleness — if a card stops boosting eval lift, it's a candidate for retirement.
