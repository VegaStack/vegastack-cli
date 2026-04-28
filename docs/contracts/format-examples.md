# On-disk format examples (binding for E1 + E2 + E3 + E6)

All bundle content lives under `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/`. These are the FOUR file shapes E3 authors and E1 builds, that E2 loads at runtime, and E6 tests against fixtures.

## 1. Knowledge card — `bundle/knowledge/<id>.md`

```markdown
---
id: aws-s3-native-state-locking
title: S3 native state locking obsoletes DynamoDB
date_authored: 2024-06-15
authoritative_source: https://aws.amazon.com/blogs/aws/aws-cloudformation-lambda-go-runtime/
providers: [aws]
triggers:
  - tokens: [s3, backend, lock]
  - tokens: [dynamodb, state, lock]
  - phrase: "do I need dynamodb for terraform state"
overrides_training: true
---

Since AWS provider 5.55 / Terraform 1.10 (released June 2024), the s3 backend supports
native state locking via `use_lockfile = true`. A separate DynamoDB table is no longer
required.

```hcl
terraform {
  backend "s3" {
    bucket       = "my-tf-state"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true   # native locking; replaces dynamodb_table = "..."
  }
}
```

The `dynamodb_table` arg still works for backward-compat but is no longer
recommended for new projects.
```

**Required frontmatter fields:** `id, title, date_authored, authoritative_source, providers, triggers, overrides_training`. **Body** is the markdown after the frontmatter.

**Triggers semantics:**
- `tokens: [a, b, c]` matches when ALL three tokens appear in `tokenize(query)`.
- `phrase: "..."` matches when the verbatim phrase appears as a case-insensitive substring of the original query.

A card matches the query if ANY trigger matches.

---

## 2. Recipe — `bundle/recipes/<id>.toml`

```toml
id        = "scalable-backend-aws-ecs-fargate-rds-datadog"
providers = ["aws", "datadog"]
triggers = [
  { tokens = ["ecs", "fargate", "alb", "autoscaling"] },
  { tokens = ["scalable", "backend", "aws"] },
  { phrase = "ecs fargate behind alb with autoscaling" },
]

[scaffold]
hcl = """
# Cluster + service
resource "aws_ecs_cluster" "this" { name = var.name }

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.exec.arn
  container_definitions    = jsonencode([{ name = "api", image = var.image }])
}

resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration { subnets = var.private_subnet_ids security_groups = [aws_security_group.svc.id] }
  load_balancer { target_group_arn = aws_lb_target_group.api.arn container_name = "api" container_port = 8080 }
}

# Public ALB w/ ip target type (Fargate)
resource "aws_lb"               "this"   { name = var.name load_balancer_type = "application" subnets = var.public_subnet_ids security_groups = [aws_security_group.alb.id] }
resource "aws_lb_target_group"  "api"    { name = "${var.name}-api" port = 8080 protocol = "HTTP" target_type = "ip" vpc_id = var.vpc_id }
resource "aws_lb_listener"      "https"  { load_balancer_arn = aws_lb.this.arn port = 443 protocol = "HTTPS" certificate_arn = var.cert_arn default_action { type = "forward" target_group_arn = aws_lb_target_group.api.arn } }

# Auto-scaling — target tracking on CPU
resource "aws_appautoscaling_target"  "api" { max_capacity = 10 min_capacity = 2 resource_id = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}" scalable_dimension = "ecs:service:DesiredCount" service_namespace = "ecs" }
resource "aws_appautoscaling_policy"  "cpu" { name = "cpu70" policy_type = "TargetTrackingScaling" resource_id = aws_appautoscaling_target.api.resource_id scalable_dimension = aws_appautoscaling_target.api.scalable_dimension service_namespace = aws_appautoscaling_target.api.service_namespace target_tracking_scaling_policy_configuration { target_value = 70 predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" } } }

# RDS Postgres (private)
resource "aws_db_subnet_group" "pg"     { name = "${var.name}-pg" subnet_ids = var.private_subnet_ids }
resource "aws_db_instance"     "pg"     { identifier = "${var.name}-pg" engine = "postgres" engine_version = "16" instance_class = "db.t4g.medium" allocated_storage = 20 storage_encrypted = true db_subnet_group_name = aws_db_subnet_group.pg.name vpc_security_group_ids = [aws_security_group.pg.id] deletion_protection = true skip_final_snapshot = false username = "appuser" manage_master_user_password = true }

# Datadog monitor on ECS service CPU
resource "datadog_monitor" "ecs_cpu" {
  name    = "${var.name} ECS CPU > 80%"
  type    = "metric alert"
  message = "@pagerduty-${var.name}"
  query   = "avg(last_10m):avg:aws.ecs.service.cpuutilization{clustername:${var.name},servicename:${var.name}-api} > 80"
  monitor_thresholds { critical = 80 }
}
"""

[[pitfalls]]
note     = "ALB target_type MUST be 'ip' for Fargate, not 'instance' — Fargate tasks have ENI IPs, not EC2 instance IDs."
severity = "error"

[[pitfalls]]
note     = "manage_master_user_password requires AWS provider >= 5.0; older versions need an explicit `password` arg."
severity = "warn"

[[pitfalls]]
note     = "Datadog monitor query uses ECS metric namespace; integration must be enabled in your Datadog AWS account."
severity = "info"
```

**Required keys:** `id, providers, triggers, [scaffold].hcl, [[pitfalls]]`. `pitfalls.severity` defaults to `"info"`.

---

## 3. Concept aliases — `bundle/<provider>/aliases.yaml`

```yaml
# bundle/cloudflare/aliases.yaml
- phrase: "protect from bots"
  alias: bot_protection
  resources:
    - cloudflare_bot_management
    - cloudflare_turnstile_widget
    - cloudflare_ruleset
  rule_phase: bot_management

- phrase: "rate limit api"
  alias: rate_limit
  resources:
    - cloudflare_ruleset
    - cloudflare_api_shield_operation
  rule_phase: http_ratelimit

- phrase: "zero trust app"
  alias: access_app
  resources:
    - cloudflare_zero_trust_access_application
    - cloudflare_zero_trust_access_policy
    - cloudflare_zero_trust_access_identity_provider

- phrase: "edge worker"
  alias: worker
  resources:
    - cloudflare_workers_script
    - cloudflare_workers_route
    - cloudflare_workers_kv_namespace
```

**Required keys per entry:** `phrase, alias, resources`. `rule_phase` is optional metadata used by some providers (Cloudflare ruleset).

E2's tokenize step folds aliases by checking `phrase` against the original query (case-insensitive substring) BEFORE tokenizing. Matched aliases are recorded in `concept_aliases_used[]` and the matched alias-resources are guaranteed in top-K.

---

## 4. Companions — `bundle/<provider>/companions.yaml`

```yaml
# bundle/aws/companions.yaml
aws_instance:
  - aws_vpc
  - aws_subnet
  - aws_security_group
  - aws_internet_gateway
  - aws_route_table
  - aws_key_pair

aws_eks_cluster:
  - aws_eks_node_group
  - aws_iam_role          # cluster role
  - aws_iam_role          # node role (duplicates allowed; consumer dedupes)
  - aws_iam_openid_connect_provider
  - aws_security_group
  - aws_subnet

aws_s3_bucket:
  - aws_s3_bucket_versioning
  - aws_s3_bucket_server_side_encryption_configuration
  - aws_s3_bucket_public_access_block
  - aws_s3_bucket_ownership_controls
  - aws_s3_bucket_lifecycle_configuration

aws_lb:
  - aws_lb_listener
  - aws_lb_target_group
  - aws_security_group
  - aws_acm_certificate
```

**Format:** YAML map of `<resource_name>: [<companion_resource_name>, ...]`.

E1's `build_companions.py` reads this file, validates that every companion exists in the per-provider MANIFEST.json (warns if not), and merges into MANIFEST.json's `resources.<name>.recommended_companions` array.

E2's tier1 stage 1l surfaces companions automatically: when a `primary_resource` or `exact_resource` hit fires, every companion is added to the result set with reason `recommended_companion:<source-resource>`.

---

## 5. Eval prompt — `cli/evals/evals.json` (one entry shape)

```json
{
  "id": "A5-eks-soft-deps",
  "archetype": "A5",
  "title": "Spin up a dev EKS cluster",
  "prompt": "Stand up a small dev EKS cluster in us-east-1 — single node group, public endpoint OK for dev.",
  "expectations": [
    { "id": "has_eks_cluster",        "kind": "resource_present", "value": "aws_eks_cluster" },
    { "id": "has_node_group",         "kind": "resource_present", "value": "aws_eks_node_group" },
    { "id": "has_oidc_provider",      "kind": "resource_present", "value": "aws_iam_openid_connect_provider" },
    { "id": "has_iam_role_cluster",   "kind": "resource_present", "value": "aws_iam_role" },
    { "id": "has_security_group",     "kind": "resource_present", "value": "aws_security_group" },
    { "id": "no_hallucinated_lb_v2",  "kind": "no_resource",      "value": "aws_lb_v2" },
    { "id": "valid_required_args",    "kind": "manifest_check",   "value": "all required_args present" }
  ],
  "tags": ["aws", "eks", "soft-deps"],
  "max_tool_calls_with_skill": 5,
  "max_tool_calls_baseline": 12
}
```

**Expectation kinds:**
- `resource_present`: the response HCL contains `resource "<name>" "..."` or `data "<name>" "..."`
- `no_resource`: response does NOT contain that resource (negative check, catches hallucinations)
- `argument_present`: response contains `<arg> = ...` inside the named resource
- `argument_absent`: response does NOT contain the named arg (e.g. deprecated arg)
- `import_syntax_match`: response contains `terraform import <type>.<name> <id>` matching the manifest's `import_syntax.command`
- `manifest_check`: a custom assertion the runner evaluates (e.g. "all required_args present", "no extra args beyond required+optional+blocks")
- `cites_card`: response cites the named knowledge card by id
- `cites_recipe`: response cites the named recipe by id
- `cites_path`: response cites the named bundle path
