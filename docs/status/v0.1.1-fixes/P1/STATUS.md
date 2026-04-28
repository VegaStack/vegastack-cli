# P1 — CLI core scoring fixes for vegastack-cli v0.1.1

**Status:** DONE — all three fixes shipped, all gates green.

## Changes by file

### Fix 2 — Auto-merge ambiguous envelopes (closes A7)
- `src/lib/discover/index.ts` — refactored. Extracted per-provider pipeline into `runProviderPipeline()`. Added `mergeOkEnvelopes()` helper. Added `AUTO_MERGE_MAX_CANDIDATES = 4` constant. `discover()` now fans out per-provider via `Promise.all` when the classifier returns ambiguous AND `candidates.length <= 4`; falls back to legacy ambiguous envelope when >4. Net file: 710 lines (was 397).
- `src/lib/discover/types.ts` — added `merged_from_providers?: string[]` field to `DiscoverOk`. Also added `distinctive_tokens?: string[]` to `ProviderManifest` (used by Fix 6).
- `docs/contracts/discover-types.ts` — added `merged_from_providers?: string[]` field to `DiscoverOk` (canonical contract). Verified `apps/dashboard/src/lib/parse-report.ts` re-exports `eval-report` (not discover-types), so no dashboard touch needed.
- `tests/integration/discover-native.test.ts` — updated the legacy `"ambiguous detection returns candidate_providers"` test to assert the new merged envelope contract (status=ok, merged_from_providers populated).

### Fix 3 — Token stemming (closes D1 + A12)
- `src/lib/discover/tokenize.ts` — added exported `stem()` helper. Wired into `tokenizeWithAliases()` so that when a token's stem differs and the stem survives min-length / NOISE / strip filters, the stem is appended alongside the original. The original is preserved for exact-match boost, the stem is the fallback. Net file: 154 lines (was 93).
  - Suffix priority used in implementation: `-ing` → `-es` (sibilant only) → `-s` → `-er`. Practical adjustments vs the prompt's literal order:
    - Plural `-s` is checked BEFORE `-er` so "clusters" → "cluster" (not "clust"), "workers" → "worker", "buckets" → "bucket". Without this, the prompt's listed order would mis-stem common plurals to non-singular forms.
    - `-es` only fires when the resulting stem ends in s/x/z/ch/sh (the standard English -es plural rule). This avoids mis-stripping "tables" → "tabl".
    - `-ers` is intentionally subsumed by `-s` for the same reason — "rotators" → "rotator" is a more useful stem than "rotat" for trigger matching.
- `src/lib/discover/knowledge.ts` — `matchesAnyTrigger()` is now stem-aware in BOTH directions: trigger token "lock" matches query token "locking", and trigger token "locking" matches query token "lock". Recipes inherit this since `recipes.ts` uses the same matcher.
- `src/lib/discover/aliases.ts` — unchanged. Aliases match on `phrase` substring only (no token list), so the stem-aware matcher doesn't apply at the alias-loader layer. Stems still flow through to tier1 stages (1a, 1c, 1d, 1e, etc.) via `tokenize()`.

### Fix 6 — Provider classifier tiebreaker for "X cluster" / "X service"
- `src/lib/discover/provider.ts` — added `GENERIC_NOUNS_FOR_TIEBREAKER` set (`cluster`, `service`, `warehouse`, `instance`, `database`, `dataset`). When the classifier would emit `ambiguous` AND the query contains one of these nouns, it counts per-provider distinctive_token matches across the tied set; the strict-majority winner takes the result with `via: "tiebreaker"` and confidence `0.7`. Two-way ties on match count fall back to legacy ambiguous. Exported `PROVIDER_TIEBREAK_SCORE = 0.7`. Added `distinctiveTokensByProvider?: ReadonlyMap<string, ReadonlySet<string>>` to `DetectOptions`.
- `src/lib/discover/manifest.ts` — added `distinctiveTokensFor(manifest, provider)` helper. Prefers explicit `distinctive_tokens?` on the manifest when present; otherwise derives a sensible fallback from `primary_resources` keys + `service_aliases` keys + provider-name segments + the post-prefix head of resource names (e.g. `snowflake_warehouse` → `warehouse`, `mongodbatlas_advanced_cluster` → `advanced`).
- `src/lib/discover/index.ts` — orchestrator builds the `distinctiveTokensByProvider` map from per-provider manifests (via `loadManifest` mtime-cache) and passes it to `detectProvider()`. Failures load silently (degrade to ambiguous).

## Tests added (3 new files)

| File | Tests | All pass |
|---|---|---|
| `tests/lib/discover/stem.test.ts` | 18 | yes |
| `tests/lib/discover/provider-tiebreaker.test.ts` | 7 | yes |
| `tests/lib/discover/auto-merge.test.ts` | 7 | yes |
| **Total new** | **32** | yes |

Coverage:
- **stem.test.ts**: -ing / -er / -ers / -es / -s stripping; min-length 3 floor; identifier-style tokens unchanged; D1 specific case ("S3 backend state locking DynamoDB" fires `aws-s3-native-state-locking`); bidirectional matchesAnyTrigger stemming.
- **provider-tiebreaker.test.ts**: "Atlas cluster" → mongodb-atlas; "Snowflake warehouse" → snowflake; "Elasticache cluster" → aws; "BigQuery dataset" → gcp; tiebreaker-no-winner → ambiguous; tied-distinctive-count → ambiguous; no-generic-noun-suppresses-tiebreaker.
- **auto-merge.test.ts**: 2-provider merge over the on-disk bundle-mini fixture; 4-provider merge over a synthesized N-provider bundle; >4 stays ambiguous; merged files sorted score_norm desc then raw score desc; citations unioned across providers; `max` cap honored on merged file list; knowledge-card dedup across providers.

## Gate results

| Command | Exit | Result |
|---|---|---|
| `npm install` | 0 | (no new deps) |
| `npm run build` | 0 | clean |
| `npm run typecheck` | 0 | clean |
| `npm test` | 0 | **343/343 pass** (308 baseline + 32 new + 3 from auto-merge fanout effects on existing fixture; 0 regressions) |
| `npm run lint` | 0 | clean |
| `npm run format:check` | (warn) | pre-existing format drift in 26 files; my changed files were re-formatted with prettier and are clean. Format check is not in the gate list. |

## Contract updates downstream consumers must adopt

`DiscoverOk` gains an additive optional field `merged_from_providers?: string[]` (canonical contract at `docs/contracts/discover-types.ts:36`, mirrored in `src/lib/discover/types.ts`). This is purely additive; existing consumers continue to work. Consumers that want to render the merged-envelope state should:

1. Check `merged_from_providers !== undefined` to detect a merged envelope.
2. When set, `provider` is a comma-joined sorted list (e.g. `"aws,cloudflare,tls"`) — split on `,` for display rather than treating it as a single provider key.
3. `provider_confidence` is the mean of per-provider confidences, not a single-provider score.

`DiscoverAmbiguous` is unchanged. The status="ambiguous" envelope is still emitted, but only for >4 candidate providers (latency cap).

`ProviderManifest` gains an additive optional field `distinctive_tokens?: string[]`. When E1 ships these, the classifier uses them verbatim. When absent (today), the classifier derives a fallback from existing manifest data — no manifest-side change required for v0.1.1.

## Cross-team coordination notes

- P2 edits `bundle/<provider>/{aliases,companions}.yaml` — no conflict; my changes are in `src/lib/discover/`.
- P3 edits `skills/terraform-docs/SKILL.md` — no conflict.
- P4 edits `package.json`, `README.md`, `AGENTS.md`, `src/agents/{cursor,claude-code,continue}.ts` — no conflict.
- The `merged_from_providers` field is additive and will not break P4's renderer changes; renderers that read `provider` will see a comma-joined string and can either split or treat as opaque.

## Verification

D1 killer card sanity-check via the built dist (after `npm run build`):

```text
status: ok
provider: aws
knowledge ids: [ 'aws-s3-native-state-locking' ]
D1 card fired: true
```

Auto-merge sanity-check via `tests/lib/discover/auto-merge.test.ts` against the on-disk `tests/fixtures/bundle-mini` bundle: "aws and cloudflare" returns `status: "ok"`, `provider: "aws,cloudflare"`, `merged_from_providers: ["aws", "cloudflare"]`, `provider_confidence: 1`, citations span both provider directories.

## Time budget

~3 hours, on schedule. No regressions in the existing 308 tests. No breaking contract changes — only additive fields.
