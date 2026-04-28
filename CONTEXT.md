# vegastack-cli — Gemini context

Use the `vega` CLI for any Terraform / HCL question across these 31 providers: aws, azure, gcp, cloudflare, kubernetes, helm, vault, digitalocean, github, gitlab, vercel, netlify, datadog, grafana, splunk, pagerduty, okta, auth0, crowdstrike, 1password, mongodb-atlas, snowflake, redis-cloud, clickhouse, pinecone, ansible, random, tls, time, local, external.

## How to query

```bash
vega tf "<the user's natural-language Terraform request>"
```

Output is a single JSON envelope with four channels:

- `files[]` — ranked list of relevant doc paths, each with the resource's full manifest entry (`required_args`, `optional_args`, `enum_values`, `import_syntax`, `deprecated`, `recommended_companions`) and inline `## Example Usage` block. **No follow-up reads required for the common case.**
- `knowledge[]` — date-stamped curated facts about recent provider changes (renames, deprecations, pricing shifts). Read these before generating HCL — they override stale training memory.
- `recipes[]` — multi-provider scaffolds (zero-trust, scalable backend, etc.) when the query spans providers.
- `concept_aliases_used[]` — transparency record showing which natural-language phrases mapped to which resources.

## Hard rules

- **Never invent resource names.** The CLI's response is the source of truth.
- **Never quote arguments from memory.** If it's not in the manifest entry, it doesn't exist on that provider version.
- **Never fabricate import IDs.** `import_syntax` in the manifest entry has the exact composite-ID format.
- **Respect `deprecated: true`** — surface to user before emitting code.
- **Cite every file path** the CLI returned in your reply.

## Bundle location

The 31-provider docs bundle is downloaded by `vega install` to `~/.config/vegastack/bundle/`. If queries fail with "bundle not found", run `vega install` (or `vega refresh` to pull the latest).

## Full skill reference

For the complete workflow, examples, and CLI reference, read [skills/terraform-docs/SKILL.md](skills/terraform-docs/SKILL.md) and the files under [skills/terraform-docs/references/](skills/terraform-docs/references/).
