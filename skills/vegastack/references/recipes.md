# Recipes (v0.1)

Recipes are **multi-provider topologies** — patterns where the right answer spans two or more providers and the hard part is composing them correctly. In the Registry architecture, recipe-like routing evidence belongs in pack indexes and Terraform-specific generated metadata.

## File schema

```toml
id          = "scalable-backend-aws-ecs-fargate-rds-datadog"   # globally unique, kebab-case
providers   = ["aws", "datadog"]                                # sorted alphabetically
triggers    = [
  { tokens = ["ecs", "fargate", "alb", "autoscaling"] },
  { tokens = ["scalable", "backend", "aws"] },
  { phrase = "scalable backend on AWS" },
]

[scaffold]
hcl = """
resource "aws_ecs_cluster" "this" { name = var.name }
resource "aws_ecs_task_definition" "app" {
  family                = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode          = "awsvpc"
  cpu                   = 512
  memory                = 1024
  ...
}
... (full per-provider HCL) ...
"""

[[pitfalls]]
note     = "ALB target_type must be 'ip' for Fargate, not 'instance'."
severity = "error"

[[pitfalls]]
note     = "Datadog monitor scoping shifted in monitor-v2 — the `host:` tag is a no-op on Fargate; use `service:` instead."
severity = "warn"
```

`triggers[]` semantics match knowledge-card triggers (any-fires, AND within `tokens`, substring for `phrase`). Recipes also fire when the query mentions ≥2 of the recipe's `providers[]` explicitly.

## Recipe examples

The Terraform Registry pack includes generated recipe metadata in its installed
indexes. Use the installed pack as the source of truth; the rows below are
examples that eval prompts may reference.

| id | providers | one-line summary |
|---|---|---|
| `zero-trust-cloudflare-aws-okta` | `aws`, `cloudflare`, `okta` | CF Access in front of an internal ALB, authed via Okta SAML. |
| `scalable-backend-aws-ecs-fargate-rds-datadog` | `aws`, `datadog` | ECS Fargate behind an ALB w/ autoscaling + RDS + a Datadog CPU monitor. |
| `github-oidc-to-aws-deploy-role` | `aws`, `github` | GitHub Actions OIDC → AWS deploy role with sub-claim restriction (no static keys). |
| `gke-cloudflare-dns-and-waf` | `cloudflare`, `gcp` | GKE app exposed via a CF DNS record + WAF ruleset. |
| `eks-with-irsa-and-alb-controller` | `aws`, `helm` | EKS + IRSA + helm-installed AWS Load Balancer Controller. |
| `serverless-webhook-aws-lambda-apigw-ddb` | `aws` | Lambda + API Gateway v2 + DynamoDB for webhook ingest. |
| `gitops-atlantis-on-eks` | `aws`, `github`, `helm` | Atlantis on EKS for a Terraform monorepo (PR-driven plan/apply). |
| `vercel-deploy-with-neon-and-datadog` | `vercel`, `datadog` | Vercel project + Datadog synthetics. (Neon backlogged until provider matures.) |
| `mongo-atlas-aws-privatelink` | `aws`, `mongodb-atlas` | Atlas cluster reached via PrivateLink from a VPC. |
| `observability-grafana-cloud-dashboards-as-code` | `grafana`, `pagerduty` | Dashboards committed to Grafana Cloud; alerts route to PagerDuty. |

The Registry owns recipe metadata and matching evidence. The CLI returns matching recipes or recipe-like results in `recipes[]` when a pack provides them.

## How recipes land in the response

The `recipes[]` array contains every recipe whose triggers fired, sorted by:

1. Number of `providers[]` overlapping with detected/forced providers, descending.
2. Trigger specificity (longer token lists first).

Each `RecipeMatch` mirrors the TOML plus a `scaffold_hcl: string` field with the full HCL fragment. **Read the recipe before writing HCL** — it gives you the resource list per provider, the order to declare them in, and the pitfall notes.

## Composing HCL from a recipe

1. Read `scaffold_hcl` end to end. The full fragment is a starting point — substitute the user's actual values (zone IDs, account IDs, hostnames, region) for the `var.*` placeholders.
2. Resolve any per-resource gaps with one `vegastack ask --agent --pack terraform --tf-provider <p> "<resource_name>"` per gap. The recipe doesn't restate the full `manifest_entry` for each resource; it assumes you'll pull those separately when needed.
3. Honor each pitfall. `severity: "error"` means the HCL won't apply; `severity: "warn"` means it'll apply but the user will hit confusion later.
4. Cite the recipe ID in your reply alongside the per-resource citations.

## Authoring guidelines

- **One topology per recipe.** A recipe that does "scalable backend + observability + zero trust" is three recipes. Composability beats completeness.
- **`providers[]` lists every provider whose resources appear in `scaffold_hcl`.** The matcher uses this for sorting and for the multi-provider ambiguous-response surface.
- **`scaffold_hcl` should be self-contained** — variables declared, providers blocks present (or a comment indicating the user supplies them), examples runnable in isolation after substitution.
- **`pitfalls[]` should be the things the maintainer learned the hard way.** Generic advice ("pin your provider versions") doesn't belong; topology-specific gotchas do.
- **Recipes can reference knowledge cards** in their pitfalls (`note: "see knowledge card 'aws-s3-versioning-split' for the deprecation context"`). The harness doesn't auto-link them; the agent reads both arrays.
