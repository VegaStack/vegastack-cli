# P5 — regressions found

5 prompts regressed in the 76-prompt re-run vs the E9 baseline. Net per-prompt diff is still net-positive (+7 full-pass, −1 zero-pass) but these regressions are real, reproducible, and root-caused below.

| Prompt id | BEFORE | AFTER | Δ | Root cause |
|---|---|---|---|---|
| `E9-A4-k8s-v1-suffix` | 0.667 | 0.333 | −0.334 | Migration card `kubernetes-provider-v2-fields` no longer fires on the new stem-aware matcher path because the trigger uses `tokens: ["v1"]` and stemming strips the trailing digit-1 in some edge cases. Top-1 file unchanged (`config_map.md`). The `cites_card` expectation flipped from pass to fail. |
| `E9-A5-clickhouse-soft-deps` | 0.667 | 0.333 | −0.334 | Auto-merge re-routed from the previous `aws+clickhouse` ambiguous-merge envelope to a unioned `aws,clickhouse` ok envelope. The new top-15 surfaces `clickhouse_service.md` (good — `has_service` passes) but displaces `aws_vpc_endpoint` (`has_vpce` was passing before, now fails). |
| `E9-A7-pinecone-vault-1password` | 0.667 | 0.333 | −0.334 | Auto-merge dropped vault from the candidate list. Investigating: `1password vault secret` triggers `PROVIDER_CONTEXT_EXCLUSIONS["1password"]` which drops vault. Now `has_vault` fails because `vault_kv_secret_v2.md` isn't in the merged file list. The pre-P1 ambiguous re-run had explicitly re-queried `--provider vault`, so vault was getting unioned in. The new auto-merge respects exclusions, which is technically correct but loses the cross-provider topology this prompt expects. |
| `E9-A7-vercel-cloudflare-workers-ab` | 0.333 | 0.000 | −0.333 | Auto-merge top-15 now spread across 3 providers (cloudflare,netlify,vercel) means each gets ~5 slots; both `vercel_project.md` and `netlify_dns_record.md` now rank below 15 since `cloudflare_worker.md` swept the top of cloudflare's slice. |
| `E9-A7-auth0-action-external-claim` | 0.667 | 0.333 | −0.334 | Same pattern as above: auto-merge spread across `auth0,vault` with auth0's worker.md and token.html.md eating both top-2 slots; `vault_kv_secret_v2` falls past position 15. |

## Pattern

Four of the five regressions trace to the same root cause: **auto-merge respects `--max 15` as a global cap, not a per-provider quota**. When 2-3 providers union into one envelope, the cap is shared. The biggest provider (often AWS or cloudflare) wins more slots, displacing the expected minor-provider resources.

Pre-P1, the runner's `merged_envelope()` Python workaround re-ran each provider independently with a fresh `--max 15` and unioned the file lists. That gave each provider 15 slots, so the union was up to 45 unique paths. The Python scorer then checked `top_k=15` on the union — but since the union preserved the source ordering per-provider, expected minor-provider resources usually surfaced.

Post-P1, the CLI's native `mergeOkEnvelopes()` correctly normalizes scores across providers and applies `--max 15` once. This is a more honest cross-provider ranking, but it loses the resources that were "free" under the per-provider re-query trick.

## Severity assessment

These are **regressions in the eval harness's emergent behavior**, not regressions in the CLI's correctness. The CLI returns more accurate cross-provider envelopes (one normalized score table vs three independent ones). The evals were tuned against the previous behavior and now expose a pre-existing gap: the union of "best-15-from-each-provider" is what consumers actually want for topology questions, but `--max 15` global isn't that.

**Suggested fix for v0.1.2:** when `merged_from_providers.length >= 2`, allocate `--max` proportionally to the number of source providers (e.g. `Math.ceil(max / providers.length)` per-provider before the global cap). 30 minutes of work in `mergeOkEnvelopes()`.

## D1 killer-card sanity (no regression)

`vega tf "S3 backend state locking DynamoDB"` still cites `aws-s3-native-state-locking`. The stem-aware matcher (`stem("locking") == "lock"`) keeps this firing.

## Generator round-trip (no regression)

`npm run generate-skill:check` exits 0 — committed SKILL.md matches the template render byte-for-byte. All 9 referenced files exist on disk. Word count 825 (≤900 cap).

## Apps stayed clean

`apps/mcp` 19/19 tests passed. `apps/dashboard` 9/9 tests passed. No build/lint regressions in either.

## Audit issue (not a fix-it)

`apps/mcp/src/lib/types.ts` (the hand-mirrored copy of `discover-types.ts`) does NOT yet declare the new `merged_from_providers?: string[]` field on `DiscoverOk`. At runtime this is harmless (JSON pass-through, extra fields are not stripped); but the TypeScript surface in `apps/mcp` is now drifted from `docs/contracts/discover-types.ts` and `src/lib/discover/types.ts`. Any MCP tool that does `Object.keys(envelope)` and types itself off `DiscoverOk` will lose the field for type-checking purposes. Recommend mirroring the field into `apps/mcp/src/lib/types.ts` in v0.1.2 or replacing the copy with a re-export per its own header comment.

`apps/dashboard/src/lib/parse-report.ts` re-exports from `docs/contracts/eval-report.ts` — a separate contract from `discover-types.ts`. No coupling, no leakage. Clean.
