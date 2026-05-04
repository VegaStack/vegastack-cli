# MANIFEST.json schema reference (v0.1)

Terraform ships two manifest layers: a **Terraform pack manifest** at `cli/packs/terraform/MANIFEST.json` and **per-provider manifests** at `cli/packs/terraform/docs/<provider>/MANIFEST.json`. The harness depends on both; the agent queries them through `vegastack ask` / `vegastack search` rather than reading them directly in normal use.

The schema is identified by `manifest_schema_version: 1` on every per-provider manifest. v0.1 restarts numbering from the Python prototype's v4 — there is no migration; this is the first public release.

## Terraform pack manifest (`cli/packs/terraform/MANIFEST.json`)

```json
{
  "format_version": 1,
  "registry_version": "2026.04.28",
  "generated_at": "2026-04-28T17:50:07Z",
  "providers": [
    "1password", "ansible", "auth0", "aws", "azure", "clickhouse",
    "cloudflare", "crowdstrike", "datadog", "digitalocean", "external",
    "gcp", "github", "gitlab", "grafana", "helm", "kubernetes", "local",
    "mongodb-atlas", "netlify", "okta", "pagerduty", "pinecone", "random",
    "redis-cloud", "snowflake", "splunk", "time", "tls", "vault", "vercel"
  ],
  "counts": { "resources": 12450, "data_sources": 1820, "guides": 412 }
}
```

Use this to enumerate providers, confirm a provider exists, and pull `registry_version` for `required_providers` pinning logic.

## Per-provider manifest (`cli/packs/terraform/docs/<provider>/MANIFEST.json`)

Top-level keys (v0.1 schema):

| Key | Type | Purpose |
|---|---|---|
| `manifest_schema_version` | int | Always `1` in v0.1 |
| `provider` | string | Provider name (e.g. `aws`) |
| `registry_version` | string | CalVer; mirrors root catalog |
| `upstream_sha` | string | git SHA from upstream provider docs repo |
| `synced_at` | ISO8601 string | When this manifest was built |
| `resources` | dict | `{resource_name: ManifestResourceEntry}` for every resource |
| `data_sources` | dict | Same shape, for data sources |
| `subcategories` | dict | `{label: [file_paths]}` from upstream `subcategory:` frontmatter |
| `synthetic_subcategories` | dict | Filename-prefix groups for providers whose real subcategories are empty/useless (Cloudflare) |
| `subcategory_useful` | bool | Whether real subcategories are usable; if false, prefer synthetic |
| `subcategory_trust` | dict | `{label: 0..1}` per-subcat trust score (replaces the old binary `subcategory_useful`) |
| `argument_index` | dict | Reverse index `{argname: [files using it]}` |
| `attribute_index` | dict | Same shape, for computed attributes |
| `description_token_index` | dict | Pre-built token reverse index for stage 1f |
| `hcl_references` | dict | `{resource: {references: [...], referenced_by: [...]}}` from upstream HCL examples |
| `example_tokens` | dict | `{token: [files]}` — distinctive tokens in HCL example code blocks |
| `resource_bigrams` | dict | `{resource: [bigrams]}` for typo-fallback matching |
| `guides` | dict | `{guide_id: {file, intent_tags, mentions}}` |
| `recommended_companions` | dict | `{resource: [companion_resources]}` — hand-curated soft requirements |
| `service_aliases` | dict | `{alias: [resources]}` per-provider alias table (externalized — no longer in code) |
| `primary_resources` | dict | `{token: resource_name}` for canonical-multiplier scoring |
| `subcat_keywords` | dict | `{keyword: subcategory_label}` |
| `generic_args_downweight` | dict | `{argname: multiplier ≤1}` (replaces the binary `GENERIC_ARGS` drop set) |

### Resource entry (`ManifestResourceEntry`)

```json
{
  "type": "resource",
  "file": "r/db_instance.html.markdown",
  "subcategory": "RDS (Relational Database)",
  "description": "Provides an RDS instance resource.",
  "deprecated": false,
  "suggested_alternative": null,
  "required_args":  [{"name": "instance_class"}, {"name": "engine"}],
  "optional_args":  [{"name": "allocated_storage", "enum_values": null}],
  "computed_attrs": [{"name": "arn"}, {"name": "endpoint"}],
  "blocks": {
    "s3_import": {
      "nesting": "single",
      "required_args": [{"name": "bucket_name"}, {"name": "ingestion_role"}],
      "optional_args": [{"name": "bucket_prefix"}]
    },
    "restore_to_point_in_time": {
      "nesting": "single",
      "required_args": [],
      "optional_args": [{"name": "restore_time"}, {"name": "use_latest_restorable_time"}]
    }
  },
  "enum_values": {"engine": ["mysql", "postgres", "mariadb", "oracle-se2", "sqlserver-se"]},
  "import_syntax": {
    "command": "terraform import aws_db_instance.example db-name",
    "id_format": "<db_instance_identifier>"
  },
  "recommended_companions": ["aws_db_subnet_group", "aws_security_group", "aws_db_parameter_group", "aws_kms_key"],
  "schema_origin": "sdkv2",
  "sections": {
    "argument_reference": 2172,
    "attributes_reference": 7000,
    "example_usage": 227,
    "import": 7406
  },
  "sha1_prefix": "2ff78bc6"
}
```

### The `blocks: {}` section (new in v0.1)

The single biggest manifest correctness fix in v0.1 is splitting **top-level args** from **per-block args**. Earlier prototypes flattened every "Required" line in the upstream docs into one `required_args` list, which polluted resources like `aws_db_instance` with args from sub-blocks (`s3_import`, `restore_to_point_in_time`, etc.) that aren't valid at the resource's top level.

In v0.1:

- `required_args` and `optional_args` at the top level contain **only** args that go directly on the resource block.
- Each sub-block gets its own entry under `blocks: {}` keyed by the block name (e.g. `s3_import`), with its own `required_args` / `optional_args` and a `nesting` mode (`"single" | "list" | "set" | "map"`).

When generating HCL, write top-level args first; then for each `blocks.<name>` you want to emit, render a nested block with its own args. For HCL like:

```hcl
resource "aws_db_instance" "example" {
  instance_class    = "db.t4g.medium"
  engine            = "postgres"
  allocated_storage = 20

  s3_import {
    bucket_name    = "my-imports"
    bucket_prefix  = "rds/"
    ingestion_role = aws_iam_role.rds_import.arn
    source_engine  = "postgres"
    source_engine_version = "13"
  }
}
```

the manifest tells you `instance_class`/`engine` are top-level required, `allocated_storage` is top-level optional, and `bucket_name`/`ingestion_role` are required *inside the `s3_import` block*.

### `schema_origin`

Each resource carries `"schema_origin": "sdkv2" | "plugin_framework" | "mixed"`. Plugin Framework resources document arguments differently in the upstream docs (different markdown shape); the harness uses `schema_origin` to pick the right parser. You usually don't need to read this field — it's there for tooling that wants to audit doc-shape coverage.

## Useful jq one-liners

```bash
# All required args of a resource (top level only — sub-block args are under .blocks.*)
jq '.resources.aws_db_instance.required_args[].name' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# All sub-block names for a resource
jq '.resources.aws_db_instance.blocks | keys' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# Required args inside a specific sub-block
jq '.resources.aws_db_instance.blocks.s3_import.required_args[].name' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# Is this resource deprecated?
jq '.resources.aws_s3_bucket | {dep: .deprecated, alt: .suggested_alternative}' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# Files where a particular argument appears
jq '.argument_index.health_check' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# Companion resources
jq '.recommended_companions.aws_instance' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# What does this resource refer to in upstream HCL examples?
jq '.hcl_references.aws_lb' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# All resources in a subcategory
jq '.subcategories["RDS (Relational Database)"]' "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"

# All synthetic subcategories (filename prefixes — Cloudflare in particular)
jq '.synthetic_subcategories | keys' "~/.config/vegastack/registry/terraform/docs/cloudflare/MANIFEST.json"

# Guide files with the "migrate" intent
jq '.guides | to_entries | map(select(.value.intent_tags | contains(["migrate"])))' \
   "~/.config/vegastack/registry/terraform/docs/aws/MANIFEST.json"
```

## Validation

Every manifest is checked by the VegaStack Registry sync pipeline against the Registry schema before upload. Any failure during sync demotes the entry to `failed`, and its docs are not pushed to R2, so installed manifests are structurally consistent with the CLI contract.
