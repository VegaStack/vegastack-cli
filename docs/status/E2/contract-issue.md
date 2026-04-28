# E2 contract issue: bundle MANIFEST.json missing v0.1 fields

Date: 2026-04-28

## Issue

Per brief, the per-provider `MANIFEST.json` is supposed to carry these new
fields in v0.1 (E1 scope, schema v1):

- `primary_resources: Record<string, string>`
- `subcat_keywords: Record<string, string>`
- `service_aliases: Record<string, string[]>`
- `recommended_companions` ON the per-resource entries
- `schema_origin`, `blocks`, `recommended_companions` ON the resource entry
- `manifest_schema_version: 1`

The aws/MANIFEST.json present at
`/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/aws/MANIFEST.json`
currently has:
  argument_index, attribute_index, bundle_version, data_sources,
  description_token_index, example_tokens, generic_args_downweight, guides,
  hcl_references, manifest_schema_version, provider, resource_bigrams,
  resources, subcategories, subcategory_useful, synced_at, synthetic_subcategories

It is MISSING:
  primary_resources, subcat_keywords, service_aliases

And per-resource entries are missing:
  blocks, recommended_companions, schema_origin

## Mitigation in E2

Per the protocol rule "code defensively (treat missing fields as empty
arrays/maps)" we:

1. Treat all missing manifest fields as empty (`?? {}`).
2. Synthesize `recommended_companions: []`, `blocks: {}`, `schema_origin: "sdkv2"`
   defaults inside `enrich.ts:normalizeManifestEntry` so the public envelope
   still satisfies the discriminated-union contract.
3. Service-alias detection in `provider.ts` falls back to `DEFAULT_SERVICE_ALIASES`
   in `constants.ts` when the bundle hasn't shipped per-provider tables yet.

## Impact on tests

Two integration tests in `tests/integration/discover-native.test.ts` rely on
the manifest having `primary_resources` (`s3 -> aws_s3_bucket`,
`ec2 -> aws_instance`). They still pass once E1 ships the new fields.

These tests fail today — NOT because of E2 code, but because the bundle is
running against the v0.1 contract before E1 has shipped. The TODO list:

- Once E1 lands, re-run `npx vitest run` and these should pass without any
  E2 code change.

## Action requested

E1: please emit `primary_resources`, `subcat_keywords`, `service_aliases`,
`recommended_companions` (per-resource), `blocks`, `schema_origin` in the
per-provider MANIFEST.json under
`/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/<provider>/MANIFEST.json`.
The shape is locked by `/tmp/synthesis/contracts/manifest.schema.json`.
