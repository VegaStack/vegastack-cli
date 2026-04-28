# S3 Execution Status — 2026-04-28

## Summary

Verified and fixed the TS classifier tiebreaker. Three gaps found between S2's bundle changes and P1's TS classifier. All fixed. All 355 tests pass.

---

## §1 — distinctiveTokensFor() field name verification

**Status: Already correct — no fix needed.**

`distinctiveTokensFor()` in `src/lib/discover/manifest.ts` already reads `manifest.distinctive_tokens` (snake_case), matching the JSON field name S2 emitted. The `ProviderManifest` TypeScript interface also already declared `distinctive_tokens?: string[]`.

The fallback chain is: explicit `distinctive_tokens` array (S2-shipped) → derivation from `primary_resources` + `service_aliases` + resource-name prefixes.

MongoDB-Atlas bundle confirms 15 tokens: `['atlas', 'mongodbatlas', 'cloud_backup', 'access_list', 'backup_snapshot', ...]`

---

## §2 — Root cause of "tune Atlas cluster cost" ProviderUndetected

Three gaps found between P1's classifier and the bundle:

### Gap 1: "atlas" not in DEFAULT_SERVICE_ALIASES
`detectProvider()` is called before any provider's manifest is known, using only `DEFAULT_SERVICE_ALIASES`. "atlas" was absent → mongodb-atlas scored 0 → no candidates → tiebreaker never fired.

**Fix:** Added `["atlas", "mongodb-atlas"]` to `DEFAULT_SERVICE_ALIASES` in `src/lib/discover/constants.ts`. "Atlas" is unambiguously MongoDB Atlas in the Terraform ecosystem.

Also added `["elasticache", "aws"]` for the same reason.

### Gap 2: Manifest service_aliases not reaching detectProvider
`buildDistinctiveTokensByProvider()` in `index.ts` loaded `distinctive_tokens` but didn't load `service_aliases` from each provider's manifest into the alias table passed to `detectProvider()`. The constant's comment said "The bundle's per-provider MANIFEST.json `service_aliases` adds to this" but the code never did this.

**Fix:** Replaced `buildDistinctiveTokensByProvider()` with `buildProviderDetectionData()` in `src/lib/discover/index.ts`. The new function returns both `distinctiveTokensByProvider` AND `serviceAliases` (DEFAULT_SERVICE_ALIASES merged with manifest keys), both passed to `detectProvider()`.

### Gap 3: Concept-alias phrases not used for provider detection
S2 added phrase-matching from `aliases.yaml` to Python's `discover.py` as a detection layer. In the TS harness, `loadAliases()` was only called POST-detection (after the provider was known). So "M40 instance backup" and "online archive policy" returned `ProviderUndetected` even though `mongodb-atlas/aliases.yaml` had matching phrases.

**Fix:** Added `detectProviderFromAliasFiles()` in `src/lib/discover/index.ts` — scans all providers' `aliases.yaml` files for phrase matches when `detectProvider()` fails or is ambiguous. Score 0.65 (above alias 0.6, below substring 0.9). Only overrides when classifier found nothing or the alias-detected provider is within the ambiguous candidate set.

---

## §3 — Per-prompt classification results (§3 of task spec)

| Prompt | Expected | Got | Confidence | Pass |
|---|---|---|---|---|
| tune Atlas cluster cost | mongodb-atlas | mongodb-atlas | 0.60 | PASS |
| snowflake warehouse for analytics | snowflake | snowflake | 1.00 | PASS |
| Cloudflare D1 database | cloudflare | cloudflare | 1.00 | PASS |
| AWS RDS Postgres encrypted | aws | aws | 1.00 | PASS |
| K8s deployment with liveness probe | kubernetes | kubernetes | 0.60 | PASS |

Additional cases from §2:

| Prompt | Expected | Got | Confidence | Pass |
|---|---|---|---|---|
| M40 instance backup | mongodb-atlas | mongodb-atlas | 0.65 | PASS |
| online archive policy | mongodb-atlas | mongodb-atlas | 0.65 | PASS |
| snowflake warehouse cost | snowflake | snowflake | 1.00 | PASS |
| elasticache cluster failover | aws | aws | 0.60 | PASS |
| kubernetes cluster service | NOT mongodb-atlas | kubernetes | 1.00 | PASS |

---

## §4 — Manifest cache invalidation

`loadManifest()` uses mtime-based caching (`CACHE` map keyed by absolute path). When S2 re-emitted MANIFEST.json files, their mtime changed → cache miss on first read → new content loaded automatically. No manual intervention required. `clearManifestCache()` is exported for test isolation.

The new `buildProviderDetectionData()` function loads manifests via `loadManifest()` so it benefits from the same mtime cache.

---

## §5 — New integration test

**File:** `tests/integration/classifier-distinctive-tokens.test.ts`

10 tests, all using REAL bundle at `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers`:

- 3 MongoDB Atlas C6 cases (tune Atlas cluster, M40 instance, online archive)
- 1 Snowflake warehouse
- 1 AWS elasticache (NOT mongodb-atlas)
- 1 Kubernetes cluster negative case
- 4 §3 regression checks

Each failure message identifies which side (bundle or TS classifier) caused it.

---

## Verification exit codes

| Command | Exit code |
|---|---|
| `npm run build` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0 (355 passed, 10 new) |
| `npm run lint` | 0 |

---

## Files modified

- `src/lib/discover/constants.ts` — added `["atlas", "mongodb-atlas"]` and `["elasticache", "aws"]` to DEFAULT_SERVICE_ALIASES
- `src/lib/discover/index.ts` — imported `DEFAULT_SERVICE_ALIASES`; replaced `buildDistinctiveTokensByProvider` with `buildProviderDetectionData` (adds serviceAliases output); added `detectProviderFromAliasFiles` pre-detection function; updated `detectProvider` call site to pass `serviceAliases` and add concept-alias fallback

## Files added

- `tests/integration/classifier-distinctive-tokens.test.ts` — 10 integration tests using real bundle

---

## Drift between Python discover.py and TS classifier

| Capability | Python discover.py | TS classifier (pre-S3) | TS classifier (post-S3) |
|---|---|---|---|
| Canonical name detection | YES | YES | YES |
| Service alias (simple tokens) | YES | YES (DEFAULT_SERVICE_ALIASES) | YES (+ atlas, elasticache) |
| Manifest service_aliases in detection | YES | NO | YES (buildProviderDetectionData) |
| Concept-alias phrase detection | YES (discover.py §3) | NO | YES (detectProviderFromAliasFiles) |
| distinctive_tokens tiebreaker | YES (discover.py §4) | YES (but never fired) | YES (fires now that baseline scores exist) |

All four detection layers now parity with Python's discover.py.
