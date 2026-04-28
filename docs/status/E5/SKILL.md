---
name: terraform-docs
description: |
  Use when the user asks to write, debug, import, or migrate Terraform / HCL,
  or names any cloud / SaaS provider in a "deploy / provision / configure"
  context. Provides per-resource argument schemas, import-ID formats,
  deprecation flags, recent-change knowledge cards, cross-provider recipes,
  and recommended-companion expansion — all from a local doc bundle, no
  network calls. Triggers on "create a <resource>", "import <resource>",
  "what arguments does X accept", "is <resource> deprecated", "set up
  <multi-service stack>", and `*.tf`/`*.hcl` file edits.

  Do NOT use for: pure shell / bash / Python questions; non-IaC cloud
  questions ("what's the cheapest EC2 size?"); CDK / Pulumi / Crossplane
  (different DSLs); Terraform Cloud workspace administration (separate API).
license: MIT
compatibility: Claude Code, Codex CLI, Cursor, Gemini, Continue, Aider
allowed-tools: Bash(vega:*) Bash(jq:*) Read Grep Glob
metadata:
  homepage: https://github.com/vegastack/vegastack-cli
  schema_version: "1"
  bundle_version: "dev"
  providers_count: "31"
---

# Terraform Providers Kit — v0.1

You have local, deterministic, read-only access to up-to-date documentation for 31 Terraform providers (1Password, Ansible, Auth0, AWS, Azure, ClickHouse, Cloudflare, CrowdStrike, Datadog, DigitalOcean, External, GCP, GitHub, GitLab, Grafana, Helm, Kubernetes, Local, MongoDB Atlas, Netlify, Okta, PagerDuty, Pinecone, Random, Redis Cloud, Snowflake, Splunk, Time, TLS, Vault, Vercel), plus a four-channel enrichment layer (recent-change knowledge cards, cross-provider recipes, concept aliases for natural-language queries, and recommended-companion graphs). Treat these files as ground truth and prefer them over training memory — provider schemas change frequently, services get renamed, arguments get deprecated, and recommended patterns shift.

## Why this skill exists

Coding agents are good at composing HCL but bad at remembering exact resource names, argument lists, enum values, import-ID formats, and which patterns are still recommended this year vs. last year. Web search is slow and noisy; MCP servers add a network hop you don't need; just guessing produces HCL that fails `terraform plan`. This skill removes those failure modes. The bundled docs are the same upstream markdown files that power `registry.terraform.io`, mirrored daily by `bundle/scripts/sync_docs.sh`. On top of those raw docs, a deterministic harness gives you O(1) lookups for resource metadata, soft-dependency expansion, and ranked discovery from natural-language queries. There's no model and no embeddings inside the harness — answers are reproducible and citable.

## The single command

```bash
vega tf "<the user's request, in natural language>"
```

`vega` is the bundled CLI (npm: `@vegastack/cli`, bin: `vega`). It auto-resolves the docs bundle (downloaded by `vega install` to `~/.config/vegastack/bundle/`), auto-detects which provider the query belongs to, and returns one JSON envelope on stdout. **The response is enriched**: top-K results in `files[]` arrive with the resource's full manifest entry inline (no follow-up `jq` calls needed) and the `## Example Usage` block inline (no follow-up `grep` calls needed). One tool call per task in the common case.

If the user names two or more providers explicitly ("EKS plus Cloudflare DNS"), invoke `vega tf` once per provider with `--provider <name>`. Recipes (channel 2) are the multi-provider escape hatch and surface in the same JSON envelope.

## Mental model: four channels in one envelope

`vega tf` returns one JSON object on stdout. Read its four arrays in this order:

| Channel | Purpose | When you read it |
|---|---|---|
| `knowledge[]` | Date-stamped, hand-curated cards capturing recent changes (renames, deprecations, pricing shifts, native-feature replacements) | **First** — these override stale training memory when `overrides_training: true` |
| `recipes[]` | Cross-provider patterns (zero-trust, scalable backend, GKE+Cloudflare, GitHub Actions → EKS) with composable HCL fragments | When the user prompt spans multiple providers or names a known topology |
| `files[]` | Ranked list of resource / data-source / guide markdown files most relevant to the query, **each with `manifest_entry` and `example_usage` inline** | Always — your primary working set |
| `concept_aliases_used[]` | Transparency record: which natural-language phrases mapped to which resource sets | Cite alongside the resources, so the user understands the mapping |

Side-channel arrays (`knowledge`, `recipes`, `concept_aliases_used`) may be empty — the curated content base grows over time. `files[]` is always populated for valid queries. Treat empty side-channels as "no curated content for this yet, fall back to `files[]` entirely."

## Core workflow (3 steps)

### 1. One discover call

```bash
vega tf "<user's request>" --max 10
```

The default `--max 10` keeps the response under ~50 KB. Lower it (`--max 5`) for tight contexts, raise it (`--max 20`) when surveying a broad topology.

### 2. Read the envelope in order

For each channel, in the order in the table above. The `files[]` entries already contain everything you need to write HCL — `manifest_entry.required_args`, `optional_args`, `computed_attrs`, sub-block args under `manifest_entry.blocks`, `enum_values`, `import_syntax`, `deprecated`, `recommended_companions`, plus the inline `example_usage` block. **You should rarely need a follow-up tool call.**

### 3. Cite every artifact you used

End your reply with the `citations[]` array verbatim — it lists the relative file paths under the bundle, plus any knowledge-card IDs and recipe IDs.

## When you DO need follow-up calls

The enriched response covers ~95% of single-task queries. Three cases need more work:

- **Broad survey** — if the user wants every match ("list all Cloudflare DDoS-related resources"), `--max 20` raises the cap. If you still need every match, fall back to `jq`:
  ```bash
  jq '.resources | keys[] | select(test("ddos|rate_limit"))' "$VEGA_BUNDLE/cloudflare/MANIFEST.json"
  ```
  `$VEGA_BUNDLE` is set by `vega tf` in the environment of any tool it spawns. Otherwise it's `~/.config/vegastack/bundle/`.

- **Companion-of-companion expansion** — `recommended_companions` for a top-K resource is in the response, but if you want the companion's *companions* in turn, run another `vega tf --provider <p> "<companion-name>"` query. Cheap, one round-trip.

- **Reading prose around examples** — if the inline `example_usage` block is truncated or the corner case isn't covered, read the original markdown:
  ```bash
  grep -A 60 '## Example Usage' "$VEGA_BUNDLE/aws/r/lb_listener.html.markdown"
  ```

## Reading the JSON envelope (v0.1 shape)

```json
{
  "status": "ok",
  "query": "S3 bucket with versioning",
  "provider": "aws",
  "provider_confidence": 1.0,
  "tokens": ["s3", "bucket", "versioning"],
  "tiers_used": ["manifest", "knowledge"],
  "schema_version": 1,
  "bundle_version": "dev",
  "files": [
    {
      "path": "/.../aws/r/s3_bucket.html.markdown",
      "score": 360.0,
      "score_norm": 92,
      "tier": "manifest",
      "reasons": ["primary_resource:aws_s3_bucket"],
      "manifest_entry": {
        "type": "resource",
        "subcategory": "S3 (Simple Storage)",
        "deprecated": false,
        "required_args": [{"name": "bucket"}],
        "optional_args": [{"name": "force_destroy"}],
        "computed_attrs": [{"name": "arn"}],
        "blocks": {
          "lifecycle_rule": {
            "nesting": "list",
            "required_args": [{"name": "id"}],
            "optional_args": [{"name": "enabled"}]
          }
        },
        "enum_values": {},
        "import_syntax": {"command": "terraform import aws_s3_bucket.example my-bucket", "id_format": "<bucket_name>"},
        "recommended_companions": ["aws_s3_bucket_versioning", "aws_s3_bucket_server_side_encryption_configuration"],
        "schema_origin": "sdkv2",
        "sections": {"argument_reference": 2172, "example_usage": 227},
        "sha1_prefix": "2ff78bc6"
      },
      "example_usage": "```terraform\nresource \"aws_s3_bucket\" \"example\" { bucket = \"my-tf-test-bucket\" }\n```"
    }
  ],
  "knowledge": [
    {
      "id": "aws-s3-versioning-split",
      "title": "Inline versioning is deprecated; use the per-feature resource",
      "date_authored": "2024-03-01",
      "authoritative_source": "https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning",
      "providers": ["aws"],
      "overrides_training": true,
      "body": "..."
    }
  ],
  "recipes": [],
  "concept_aliases_used": [],
  "citations": [
    "aws/r/s3_bucket.html.markdown",
    "aws/r/s3_bucket_versioning.html.markdown",
    "knowledge/aws-s3-versioning-split.md"
  ],
  "count": 2
}
```

Note the v0.1-specific fields: `schema_version: 1` (the v0.1 envelope restarts numbering from the Python prototype's v4), `provider_confidence` (0..1, see the ambiguous case below), `score_norm` (0..100, per-provider normalized — use this rather than the raw `score`), `bundle_version` (CalVer e.g. `2026.04.28`, from `bundle/MANIFEST.json`), and `manifest_entry.blocks` (sub-block arg lists kept separate from top-level `required_args`/`optional_args`, so e.g. `aws_db_instance.required_args` no longer over-includes args from the `s3_import` block).

`status: "ambiguous"` happens when `best_provider − second_best < 0.2`. Read `candidate_providers` and `recipes` (recipes that span the candidate set still surface) and ask the user, or run `vega tf --provider <each>` once per candidate. `status: "error"` with `code: "BundleMissing"` means run `vega install`; `code: "ProviderUnknown"` means re-tokenize with the user's help.

## Five worked examples

Each example cites at least one real on-disk artifact (a knowledge card id, a recipe id, or a concept-alias entry) so the eval suite can assert it.

### Example 1 — Recent change overrides training (knowledge card `aws-s3-native-state-locking`)

```bash
vega tf "S3 backend state locking dynamodb"
```

The envelope's `knowledge[]` includes `aws-s3-native-state-locking`. Read its body **before writing HCL.** As of AWS provider 5.55 / Terraform 1.10, the s3 backend supports native state locking via `use_lockfile = true`; DynamoDB is optional. If your training said otherwise, the card overrides your training (`overrides_training: true`). Cite the card's `authoritative_source` in your reply.

### Example 2 — Implicit dependencies (companions for `aws_instance`)

```bash
vega tf "EC2 instance for dev environment"
```

`files[0].manifest_entry.recommended_companions` returns `["aws_vpc", "aws_subnet", "aws_security_group", "aws_internet_gateway", "aws_route_table", "aws_key_pair"]`. Each companion also appears in `files[]` (top-K is widened to include them automatically). A bare `aws_instance` block is almost never what the user wants — surface the companion stack and ask whether they have an existing VPC to import via a `data` source instead.

### Example 3 — Conceptual / NL query (concept alias `cloudflare/bot_protection`)

```bash
vega tf "protect cloudflare app from bots and scraping"
```

`concept_aliases_used[]` records `{phrase: "protect from bots", provider: "cloudflare", matched_alias: "bot_protection", resources: [...]}`. Cloudflare's upstream docs have empty `subcategory:` frontmatter, so a literal grep for "bots" misses; the alias layer fixes it. Surface the matched phrase in your reply: "interpreting 'protect from bots' as Cloudflare bot management — using `cloudflare_bot_management`, `cloudflare_turnstile_widget`."

### Example 4 — Multi-provider topology (recipe `zero-trust-cloudflare-aws-okta`)

```bash
vega tf "zero-trust internal app cloudflare access aws alb okta"
```

`recipes[]` contains `zero-trust-cloudflare-aws-okta` with `scaffold_hcl` + `pitfalls`. Read the recipe first — it gives you the resource list per provider, the order to declare them in, and known pitfalls (e.g. ALB SG must allow Cloudflare's IP ranges only, not `0.0.0.0/0`). The `scaffold_hcl` block is a templated starting point; substitute the user's actual values (zone IDs, account IDs, hostnames) and run additional `vega tf --provider <p>` calls only for resources the recipe doesn't fully spell out.

### Example 5 — Importing an existing resource (manifest `import_syntax`)

```bash
vega tf "import existing cloudflare DNS record"
```

`files[0].manifest_entry.import_syntax` returns `{command: "terraform import cloudflare_dns_record.example <zone_id>/<dns_record_id>", id_format: "<zone_id>/<dns_record_id>"}`. Use the `command` line verbatim — composite IDs are easy to get wrong. The companion knowledge card `cloudflare-resource-renames-v5` (in `knowledge[]`) reminds you that `cloudflare_record` was renamed to `cloudflare_dns_record` in CF provider v5 (Sep 2024); state migration is required for older configs.

## Guardrails

These are failure modes that produce broken HCL or wrong advice. Each one exists because real users hit each of these.

- **Never invent resource names.** If a name doesn't appear in `files[].manifest_entry`, it does not exist on this provider at the synced version. Re-run `vega tf` with a different phrasing instead of mutating the name (`aws_lb_v2`, `aws_load_balancer`, etc. are common hallucinations — none are real).
- **Never quote arguments from memory.** If an argument is not in `manifest_entry.required_args`, `optional_args`, `computed_attrs`, or `blocks.*.{required,optional}_args`, it does not exist. AWS in particular renames arguments between provider versions; what you learned in training may be gone.
- **Never fabricate import IDs.** Every importable resource has `manifest_entry.import_syntax`. Use `command` verbatim. Composite IDs (`zone_id/record_id`, `region:name`, `<account>/<role>`) are easy to get wrong and produce silent confusion.
- **Respect deprecation.** If `manifest_entry.deprecated: true`, tell the user *before* writing code. Surface `suggested_alternative` if the manifest provides one.
- **Honor knowledge-card timestamps over training.** When `knowledge[]` entries set `overrides_training: true`, the cards represent post-training-cutoff facts the maintainers explicitly verified. Trust them; cite their `authoritative_source`.
- **One provider per `vega tf` call.** Cross-provider queries need separate calls (or a recipe). The manifest and scoring are provider-scoped by design.
- **Never auto-modify the index.** The bundle is read-only. Don't write to `~/.config/vegastack/bundle/` from within a tool call. If something seems missing, run `vega doctor`; if the bundle is stale, run `vega install` (the user does this, not you).
- **Never `grep -r` the whole bundle.** It's ~9,000 files. Scope to a provider directory; `vega tf` already does this internally.

## Performance notes

Typical `vega tf` query (Tier 1, manifest only) returns in <150 ms warm cache, including manifest_entry + example_usage enrichment. Tier 2 (grep fallback, with `ripgrep` when available) takes 30–200 ms. The bundle on disk is ~100 MB; reads are local-disk fast. Fewer tool calls = lower agent token spend — the enriched response is sized to keep most tasks at 1–2 tool calls instead of 8–15.

## Reference files (read on demand)

The skill body above covers the common case. For edge cases and full reference, read these only when needed:

- [references/discover-cli.md](references/discover-cli.md) — full `vega tf` flag reference, output schema, every Tier-1 stage, scoring weights, ambiguity handling
- [references/manifest-schema.md](references/manifest-schema.md) — every field in the per-provider and root `MANIFEST.json` (v1), with examples, including the new `blocks: {}` section
- [references/knowledge-cards.md](references/knowledge-cards.md) — knowledge-card schema and the full inventory of 16 cards with id+triggers+summary
- [references/recipes.md](references/recipes.md) — recipe schema and the full inventory of 10 recipes
- [references/concept-aliases.md](references/concept-aliases.md) — per-provider table of 28 aliases (4 providers)
- [references/eval-baseline.md](references/eval-baseline.md) — methodology for the published lift numbers
- [references/troubleshooting.md](references/troubleshooting.md) — common failure modes and the `vega doctor` matrix
