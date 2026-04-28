# P5 — v0.1.1 reliability re-audit

**Date:** 2026-04-28 · **Auditor:** P5 (independent verifier)
**Scope:** verify P1-P4's 12 fixes don't regress; measure actual lift on the E9 76-prompt cross-provider eval; mark each S2 §7 success criterion ✅/❌; flag regressions.

---

## §1 Verdict

🟡 **MOSTLY GREEN** — all 6 build/test/lint/pack gates pass clean across all three workspaces; the 76-prompt eval rose from 0.623 → 0.678 mean (+8.8% relative, +7 full-pass prompts); BUT 3 of 6 S2 §7 success criteria missed (#4 bottom-5 mean, #5 cloudflare-workers-d1-r2, #6 Atlas-cluster classifier), and 5 prompts regressed under the new auto-merge `--max` allocation.

The misses are all **classifier-side / ranking-side**, not bundle-content-side. P2's bundle data is correct; P3's SKILL.md round-trips; P4's distribution surface is clean. The gaps are in P1's classifier (no upstream fix for "atlas" alone) and in `mergeOkEnvelopes()`'s `--max` cap (shared globally rather than allocated per-provider).

The +0.055 mean lift is real and reproducible. The harness is shippable as v0.1.1 if "honest 8.8% improvement on the long tail" is acceptable; if the §7 success-criterion list was a hard gate, two more days of work close items #4 and #6.

---

## §2 Build / typecheck / lint / test gates (all green)

| Workspace | install | build | typecheck | lint | test | result |
|---|---|---|---|---|---|---|
| repo root | 0 | 0 | 0 | 0 | 0 | **343 / 343 tests** in 39 files |
| `apps/mcp` | 0 | 0 | (n/a — build typechecks) | (n/a) | 0 | **19 / 19 tests** in 5 files |
| `apps/dashboard` | 0 | 0 | (n/a — build typechecks) | (n/a) | 0 | **9 / 9 tests** in 1 file |

Total: **371 tests pass / 0 fail / 0 skip / 0 flaky** across 3 workspaces. P1 reported 343/343 on root (matches); P3 reported 329/329 (matches the pre-P1 count given P1 added 32 new + 3 fixture-affected). The current 343 count == P1's reported count, so P3+P4's additions are all already counted in P1's 343.

`npm install` on root emits a benign warning ("vega install: WARN bundle install failed: HTTP 404 Not Found") — the postinstall tries to fetch the v0.1.0 bundle tarball from GitHub releases, which doesn't exist for the workspace install. CLI install itself succeeded ("CLI is still installed"). Not a regression.

`npm run generate-skill:check` exits 0 — committed `skills/terraform-docs/SKILL.md` matches the template render byte-for-byte. SKILL.md word count: **825** (≤900 cap, P3 reported 825 — matches).

`npm pack --dry-run --json` reports **104 files** (P4 reported 104 — matches). Top-level entries: `.claude-plugin · AGENTS.md · CLAUDE.md · CONTEXT.md · LICENSE · README.md · cursor-rule.mdc · dist · gemini-extension.json · npm · package.json · skills`. No leakage from `apps/`, `tests/`, `evals/`, `docs/planning/`, `docs/status/`.

`package.json#keywords` has **20 entries** (P4 reported 19 — actual is 20: 10 original + 10 new including `aider`). All 20 names are intact. README has both the "Install via skill registry" block AND the "How this differs from `hashicorp/agent-skills`" positioning table.

All 9 references files referenced by SKILL.md exist on disk: `concept-aliases.md · discover-cli.md · eval-baseline.md · import.md · knowledge-cards.md · manifest-schema.md · migrations.md · recent-changes.md · recipes.md · troubleshooting.md` (10 actually — 9 referenced + `knowledge-cards.md` reachable via cross-link).

---

## §3 Eval re-run — 76 prompts (BEFORE → AFTER)

Used the existing E9 Python runner verbatim (`/tmp/exec-status/E9/run_evals.py`) with output paths repointed to `/tmp/exec-status/P5/`. Same `--max 15`, same scoring, same `merged_envelope()` ambiguous-fanout fallback (which now mostly short-circuits since the CLI auto-merges natively).

| Metric | Before | After | Δ |
|---|---|---|---|
| Mean manifest_score | 0.623 | **0.678** | +0.055 (+8.8% rel) |
| Full-pass (=1.0) | 32/76 | **39/76** | +7 |
| Zero-pass (=0.0) | 12/76 | **11/76** | −1 |
| Provider undetected | (E9 didn't separately track) | 5/76 | — |
| Knowledge-card hit rate | (varies by re-runner) | 2/7 (28.6%) | — |

**Per-archetype lift (top movers):**
- A6 (single-prov topology): **0.536 → 0.774** (+0.238) — companions YAML extension working
- A1 (single resource): **0.579 → 0.711** (+0.132) — clickhouse/crowdstrike/redis-cloud aliases firing
- A10 (CI/CD): 0.500 → 0.667 (+0.167)
- A7 (cross-prov topology): **0.434 → 0.446** (+0.012) — auto-merge produces correct routing but `--max` cap displaces minor-provider resources; well below ~0.7 target
- A4: 0.792 → 0.708 (−0.083) — k8s-v1 migration card stopped firing (regression, see §5)
- A5: 0.667 → 0.583 (−0.084) — clickhouse soft-deps got displaced by auto-merge (regression, see §5)

---

## §4 S2 §7 success criteria

| # | Criterion | Verdict | Actual |
|---|---|---|---|
| 1 | keywords + install one-liners + SKILL.md surfaces | ✅ MET | 20 keywords, README install block present, frontmatter has `tags`/`codex`/`compatibility` |
| 2 | tls-acm-cloudflare returns merged envelope (no ambiguous) | ✅ MET | `status: ok`, `provider: aws,cloudflare,tls`, `merged_from_providers: [aws, cloudflare, tls]` |
| 3 | "S3 backend state locking DynamoDB" cites `aws-s3-native-state-locking` | ✅ MET | `knowledge_ids: ['aws-s3-native-state-locking']` |
| 4 | bottom-5 provider mean ≥ 0.55 | ❌ MISSED | 0.165 → **0.299** (only crowdstrike moved; local/tls/mongodb-atlas/cloudflare unchanged) |
| 5 | A6 cloudflare-workers-d1-r2 AND snowflake-warehouse-rbac both ≥ 0.75 | ❌ PARTIAL | snowflake-warehouse-rbac=1.000 ✅; cloudflare-workers-d1-r2=**0.333** ❌ |
| 6 | "tune Atlas cluster cost" returns `mongodbatlas_advanced_cluster` rank 1 | ❌ MISSED | `status: error`, `code: ProviderUndetected` |

3/6 met, 1/6 partial, 2/6 missed. Detailed breakdown in `success-criteria.md`.

### Why #4 and #6 missed: the same root cause

P2 inlined `service_aliases.atlas_cluster → [mongodbatlas_advanced_cluster, mongodbatlas_cluster]` into `mongodb-atlas/MANIFEST.json`. P1 added a tiebreaker that fires when ≥2 providers tie on the candidate ranking. Neither closes the gap where the literal token "atlas" is the *only* routing signal. `detectProvider("tune Atlas cluster cost")` returns `score: 0` (no canonical/substring/alias match), so `discover()` emits `ProviderUndetected` before tier1-alias matching ever runs. Same story for `local_file` (token "local" anti-detected) and `tls_self_signed_cert` (the prompt mentions `*.vegastack.local` which routes to `local`, not `tls`).

### Why #5's cloudflare-workers-d1-r2 missed

The aliases ARE firing (`concept_aliases_used` shows `edge worker → worker`, `d1 database → d1`, `r2 bucket → r2`) and the companions are correctly inlined into MANIFEST. But the top-15 file list returned by tier1 has `cloudflare_workers_*` resources sweeping positions 1-10; `cloudflare_d1_database` and `cloudflare_r2_bucket` rank below 15. This is a tier1 ranking gap, not a bundle-content gap.

---

## §5 Regressions

Five prompts regressed: `E9-A4-k8s-v1-suffix · E9-A5-clickhouse-soft-deps · E9-A7-pinecone-vault-1password · E9-A7-vercel-cloudflare-workers-ab · E9-A7-auth0-action-external-claim`. Net per-prompt is still positive (+7 full-pass, −1 zero-pass), but these are real, reproducible regressions traceable to:

1. **Auto-merge `--max` cap shared globally** (4 of 5 regressions): when 2-3 providers union into one envelope, the `--max 15` cap is shared across them. The biggest provider sweeps the top slots, displacing expected minor-provider resources. Pre-P1 the runner re-ran each provider separately with a fresh `--max 15`, so each provider effectively got 15 slots. Post-P1's native auto-merge is more honest about cross-provider ranking but loses resources that were "free" under the per-provider re-query trick.

2. **Stem-aware matcher edge case** (`E9-A4-k8s-v1-suffix`): the migration card uses `tokens: ["v1"]` and the new bidirectional stemmer in `matchesAnyTrigger()` may strip a trailing "1" in some edge conditions. Worth verifying — could be a one-line fix in `stem()`'s digit-handling branch.

Suggested fix for v0.1.2 (30 min): in `mergeOkEnvelopes()`, when `merged_from_providers.length >= 2`, allocate `Math.ceil(max / providers.length)` per-provider before applying the global `--max` cap. This restores the per-provider quota that the eval implicitly relied on, without losing the cross-provider score normalization.

Full root-cause table in `regressions.md`.

---

## §6 Contracts and downstream consumers

- ✅ `docs/contracts/discover-types.ts:37` declares `merged_from_providers?: string[]`
- ✅ `src/lib/discover/types.ts:37` declares `merged_from_providers?: string[]`
- ⚠️ `apps/mcp/src/lib/types.ts` does NOT declare `merged_from_providers` on `DiscoverOk`. **Audit issue, not a fix-it for me.** At runtime this is harmless (JSON pass-through tolerates extra fields); the file's own header comment says "MIRROR of /tmp/synthesis/contracts/discover-types.ts — DO NOT diverge ... When E2 lands the canonical types in `src/lib/discover/types.ts` and exports them, replace this file with a re-export." E2 has landed the types; the replacement is overdue. Won't break MCP envelope responses but the field will be missing from any TS-typed handler. Recommend mirroring (5 min) before tagging v0.1.2.
- ✅ `apps/dashboard/src/lib/parse-report.ts` re-exports from `docs/contracts/eval-report.ts` — separate contract, no coupling to discover-types. Clean.

---

## §7 Honest dashboard note

Per FINAL-VERDICT U6, the dashboard's `+47%` headline is fixture-derived (not measured). My re-run produces the FIRST objective harness-side delta number for v0.1.1: **+8.8% relative on mean manifest_score, +7 full-pass prompts (32 → 39), 5 regressions identified and root-caused.** Any external lift claim should cite this number and the methodology (76-prompt cross-provider eval, manifest-side scoring, top_k=15) — not the fixture's `+47%`.

---

## §8 Recommendation

**Tag v0.1.1 if** the team accepts that:
- 3/6 §7 success criteria missed (#4 bottom-5 mean, #5 cloudflare-d1-r2, #6 Atlas classifier)
- 5 prompts regressed (4 from auto-merge `--max` allocation, 1 from stem edge case)
- Net lift is real but smaller than projected (+0.055 vs implied ~0.1+ from the four projected wins)

**Hold v0.1.1 if** any of those §7 items is a marketing-relevant claim. The fixes are ~1 day of focused work:
- Allocate `--max` per-provider in `mergeOkEnvelopes()` — closes 4 of 5 regressions, recovers projected A7 lift
- Add `["atlas", "mongodb-atlas"]` and similar bundle-MANIFEST → DEFAULT_SERVICE_ALIASES seeding — closes #4 and #6
- Boost alias-promoted resources in tier1 ranking (or raise `--max` for topology queries) — closes #5

The current state is **shippable but smaller than the plan promised**. The plan's success criteria were aggressive; the actual implementation closed the parts that were unambiguous bundle-content-or-ranking work and stopped short on the parts that needed deeper classifier surgery.

🟡 **MOSTLY GREEN — recommend ship as v0.1.1, defer items 4/5/6 to v0.1.2 with regression-fix bundle (1 day).**
