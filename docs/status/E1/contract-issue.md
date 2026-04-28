# E1 — contract issue: provider name regex rejects `1password`

## Issue

`/tmp/synthesis/contracts/manifest.schema.json` line 20 requires:

```json
"provider": {
  "type": "string",
  "pattern": "^[a-z][a-z0-9-]*$"
}
```

This rejects the `1password` provider (which is the canonical upstream name
of the `1Password/terraform-provider-onepassword` provider, and matches the
existing `terraform-providers/1password/` directory name in the bundle).

## Reproduction

```
$ python3 scripts/validate_manifest.py 1password/MANIFEST.json
FAIL .../1password/MANIFEST.json
   - provider: '1password' does not match '^[a-z][a-z0-9-]*$'
```

## Resolution applied locally

I patched the regex in `schema/manifest.schema.json` (the bundle copy of
the schema) to also allow a leading digit:

```diff
- "pattern": "^[a-z][a-z0-9-]*$"
+ "pattern": "^[a-z0-9][a-z0-9-]*$"
```

The contract source-of-truth file at
`/tmp/synthesis/contracts/manifest.schema.json` is unchanged — please
update upstream so E2 (TS-loader) and E1 stay in sync.

## Why I picked this resolution

- Renaming the provider directory would cascade into 8+ other files
  (every other team's brief enumerates `1password` in the provider list).
- Renaming the provider in the manifest body (e.g. to `onepassword`)
  diverges from the on-disk dir name, which is the lookup key used in
  `MANIFEST.json.providers` at the bundle root.
- The original regex's intent is to forbid uppercase / underscores /
  pathological values; allowing leading-digit names doesn't weaken that.
