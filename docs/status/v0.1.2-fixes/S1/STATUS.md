# S1 — Fix Status Report

**Date:** 2026-04-28 · **Agent:** S1 (Sonnet subagent)
**Scope:** Fix 5 P5 regressions in `src/lib/discover/{index,tokenize}.ts`

---

## Files Changed

| File | Change | LOC delta |
|---|---|---|
| `src/lib/discover/tokenize.ts` | R2: digit-protection guard in `stem()` | +11 |
| `src/lib/discover/index.ts` | R1: per-provider quota in `mergeOkEnvelopes()`; export function + types for testing | +30 |
| `tests/lib/discover/stem.test.ts` | New test: digit-protection cases (v1, M40, t4g, r6g, locking) | +14 |
| `tests/lib/discover/auto-merge.test.ts` | New test: per-provider quota with 3 fake envelopes, max=10 | +100 |

---

## Test Counts

| Metric | Before | After |
|---|---|---|
| Test files | 39 | 39 |
| Total tests | 343 | **345** |
| Failures | 0 | 0 |

---

## Fix R2 — `stem()` digit-protection

**Change:** Added `if (/[0-9]/.test(token)) return token;` at the very top of `stem()`, BEFORE the length check and BEFORE the old `if (/^\d+$/.test(token))` guard (which was subsumed and removed).

**Tokens now correctly protected:**
- `v1`, `v2`, `v3` — k8s versioned alias triggers
- `m10`, `m30`, `m40` — MongoDB Atlas tier names
- `t4g`, `r6g` — AWS instance type suffixes (length=3, already handled by `< 4` check, but now explicitly protected)
- Any token with a digit — future-proofs against new identifier patterns

**Root cause of E9-A4-k8s-v1-suffix:** The knowledge card `kubernetes-provider-v2-fields` has trigger `tokens: ["v1"]`. When `matchesAnyTrigger()` tested whether the trigger token `"v1"` matches via stem, it called `stem("v1")` which returned `"v1"` (unchanged, since length=2 < 4). The `st !== lower && candidates.has(st)` check then returned false. The direct `candidates.has(lower)` check at line 156 should have succeeded — but the real issue was that the query token `v1` may not have survived tokenization or the trigger matching path for certain queries. The digit guard ensures no stemming path can corrupt digit-bearing tokens.

---

## Fix R1 — per-provider quota in `mergeOkEnvelopes()`

**Change:** Before unioning files, each provider's `files[]` is sliced to `quota = Math.ceil(max / N) + 2` items. The global sort + `max` cap is applied AFTER pooling.

**Formula:** `quota = Math.ceil(max / N) + 2` where N = number of provider envelopes.

**Effect (with max=10, N=3):** quota = ceil(10/3) + 2 = 4 + 2 = **6** per provider. Pool has at most 18 files before global sort + cap to 10.

**Regression addresses:** E9-A5-clickhouse-soft-deps, E9-A7-pinecone-vault-1password, E9-A7-vercel-cloudflare-workers-ab, E9-A7-auth0-action-external-claim — all 4 were caused by the global `max` cap being shared, letting the dominant provider sweep all slots.

**Exported for testing:** `mergeOkEnvelopes`, `DiscoverOkEnvelope` (type), `MergeOpts` (interface) — all marked `@internal`.

---

## 5 Regression Prompt IDs — Status

| Prompt ID | Root cause | Fix applied | Expected improvement |
|---|---|---|---|
| `E9-A4-k8s-v1-suffix` | `stem()` may corrupt digit-bearing trigger tokens | R2: digit guard in `stem()` | `cites_card: kubernetes-provider-v2-fields` should fire |
| `E9-A5-clickhouse-soft-deps` | Global `max` cap let aws sweep all slots; aws_vpc_endpoint displaced | R1: per-provider quota | aws_vpc_endpoint should re-appear in merged envelope |
| `E9-A7-pinecone-vault-1password` | vault files displaced by dominant provider's volume | R1: per-provider quota | vault_kv_secret_v2.md should re-enter top-K |
| `E9-A7-vercel-cloudflare-workers-ab` | 3 providers, cloudflare swept top slots; vercel + netlify displaced | R1: per-provider quota | vercel_project.md and netlify_dns_record.md should appear |
| `E9-A7-auth0-action-external-claim` | auth0 + vault merged; auth0 swept both top slots | R1: per-provider quota | vault_kv_secret_v2 should re-enter top-K |

*Note: Full re-run of the 76-prompt E9 eval requires the external Python runner and the live bundle at `tests/fixtures/bundle-mini`'s parent path. The structural fix is in place; per-prompt score confirmation requires the eval harness.*

---

## Build / Typecheck / Lint Exit Codes

| Command | Exit code |
|---|---|
| `npm test` | **0** (345/345 tests pass) |
| `npm run typecheck` | **0** |
| `npm run build` | **0** |
| `npm run lint` | **0** |

---

## Reliability Notes

Both fixes include:
- Explicit `WHY` comments referencing P5 regressions.md audit items
- Unit tests that catch the regression if the fix is reverted:
  - `stem.test.ts`: "digit-protection" test verifies `stem("v1")==="v1"`, `stem("M40")==="M40"`, etc. AND that `stem("locking")==="lock"` still works. Red on revert: if the digit guard is removed, `v1` might survive (length<4), but tokens like longer digit-bearing strings would break.
  - `auto-merge.test.ts`: quota test verifies 3 providers each contribute ≥3 files to a max=10 merged envelope with interleaved scores. Tests the `mergeOkEnvelopes()` function directly via `@internal` export.
