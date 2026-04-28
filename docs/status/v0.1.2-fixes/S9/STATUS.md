# S9 — v0.1.0 Final Audit (FINAL)

**Date:** 2026-04-28 · **Auditor:** S9 (independent verifier)
**Scope:** Re-run E9 76-prompt eval against the post-S8 tree; verify all 9
P5 success criteria; hunt for new regressions S8 may have introduced;
emit ship/hold verdict for v0.1.0 (the project's first ship).

---

## §1 Verdict (TL;DR)

🟢 **READY TO TAG v0.1.0** — 5 of 9 success criteria fully met
(was 4 in S7); 1 PARTIAL; 3 MISSED; 1 NEW regression (bounded);
NO new code-side blockers. The 3 misses are:

- **#1 PARTIAL** — 1 P5 regression open (k8s-v1-suffix at 0.000)
  diagnosed as **bundle-side** (untriggerable card phrasing,
  documented in §6 below); plus 1 NEW S8-introduced bounded
  regression (clickhouse-soft-deps 0.667→0.333, top1 still passes)
- **#2 MISSED** — bottom-5 mean 0.300 (target ≥0.55), pulled down by
  the same kubernetes/cloudflare-d1-r2 misses
- **#4 MISSED** — cloudflare-workers-d1-r2 still 0.333 (S6 boost not
  enough)
- **#7 MISSED** — `--brief` 32%–50% on real bundle vs aspirational ≤25%
  (documentation fix, not a code fix)

None of these block ship. **#5 (A7 cross-prov topology)** flipped from
MISSED → MET — the entire S8 architectural intent. Cumulative E9→S9
mean lift is **+0.165 (+26.5% relative)**, the largest delta any audit
has measured.

---

## §2 Build / Test / Lint Gates

| Workspace | install | build | typecheck | lint | tests | result |
|---|---|---|---|---|---|---|
| repo root | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **398/398** (46 files) |
| apps/mcp | exit 0 | exit 0 | (build typechecks) | (no lint) | exit 0 | **19/19** (5 files) |
| apps/dashboard | exit 0 | exit 0 | (build typechecks) | (no lint) | exit 0 | **9/9** (1 file) |
| bundle pytest | — | — | — | — | exit 0 | **27/27** (2 modules) |

**Total: 453 tests pass · 0 fail · 0 skip · 0 flake.** Test count up from
S7's 435 (+18, all from S8's two new test files). Raw output:
`/tmp/exec-status/S9/test-output.log`.

The `vegastack install: WARN bundle install failed: HTTP 404 Not Found` on
root install is benign — the postinstall hook tries to fetch the v0.1.0
bundle tarball from GitHub releases, which doesn't exist yet (because
v0.1.0 has not been tagged). `CLI is still installed`. Will resolve
itself the moment the release is cut.

---

## §3 Eval — 76 prompts (E9 → P5 → S7 → S9)

| Metric | E9 | P5 | S7 | **S9** | Δ vs S7 | Δ vs E9 |
|---|---|---|---|---|---|---|
| Mean manifest_score | 0.623 | 0.678 | 0.713 | **0.788** | **+0.075** | **+0.165** |
| Full-pass (=1.0) | 32/76 | 39/76 | 42/76 | **47/76** | **+5** | **+15** |
| Zero-pass (=0.0) | 12/76 | 11/76 | 9/76 | **5/76** | **−4** | **−7** |
| A7 cross-prov mean | 0.434 | 0.446 | 0.423 | **0.643** | **+0.220** | +0.209 |

Per-archetype highlights:
- **A7 (cross-prov topology): 0.423 → 0.643 (+0.220)** — biggest single
  delta in any audit; directly attributable to S8's
  `detectMultiProviderPhrasing()` heuristic.
- **A1 (single-resource): 0.763 → 0.921 (+0.158)** — three previously-zero
  prompts now full-pass (helm-cert-manager, tls-self-signed, time-rotating)
  because S8 surfaced their providers via the multi-provider detect on
  topology queries that include them.
- A5 (soft-deps): 0.667 → 0.583 (−0.083) — clickhouse-soft-deps
  regression (see §5).
- All other archetypes: unchanged from S7.

Per-provider highlights (full table in `provider-scorecard-after.md`):
- **tls: 0.125 → 0.875 (+0.750)** — tls-self-signed went from 0 to full.
- **time: 0.000 → 1.000 (+1.000)** — time-rotating went from 0 to full.
- **digitalocean: 0.666 → 1.000 (+0.334)** — do-app-cf-dns full-pass.
- **vault: 0.750 → 1.000 (+0.250)** — vault-dynamic-postgres-on-k8s full.
- **clickhouse: 0.834 → 0.666 (−0.167)** — the one regression.
- kubernetes: still 0.000 (k8s-v1-suffix bundle issue).

---

## §4 Nine P5 Success Criteria — full audit

(Detailed evidence in `success-criteria.md`.)

| # | Criterion | S7 | S9 | Δ |
|---|---|---|---|---|
| 1 | All P5 regressions resolved | ❌ MISSED | 🟡 PARTIAL | improved |
| 2 | Bottom-5 provider mean ≥ 0.55 | 🟡 PARTIAL (0.515) | ❌ MISSED (0.300) | worse* |
| 3 | "tune Atlas cluster cost" rank 1 | ✅ MET | ✅ MET | held |
| 4 | cloudflare-workers-d1-r2 ≥ 0.66 | ❌ MISSED (0.333) | ❌ MISSED (0.333) | held |
| 5 | A7 cross-prov mean ≥ 0.55 | ❌ MISSED (0.423) | ✅ **MET (0.643)** | **fixed** |
| 6 | apps/mcp re-export from contract | ✅ MET | ✅ MET | held |
| 7 | --brief ≤ 25% full envelope | 🟡 PARTIAL | ❌ MISSED | worse (doc) |
| 8 | All 398+ tests pass | ✅ MET (380) | ✅ MET (398) | +18 tests |
| 9 | Build/typecheck/lint clean | ✅ MET | ✅ MET | held |

**Score: 5 MET / 1 PARTIAL / 3 MISSED** (was 4/2/3 at S7).

\* Bottom-5 set shifted: S7's bottom-5 mean was computed using S7's
bottom-5 providers (which included different providers); using **S9's
bottom-5 set** (kubernetes, github, cloudflare, auth0, azure) the same
set scored S7=0.300, S9=0.300 — unchanged on a like-for-like basis. The
"worse" delta is artefactual; the underlying weak providers are the
same and their scores are identical.

---

## §5 New regressions hunt (the load-bearing audit step)

Ran ALL 76 prompts; for every prompt where S7 reported a higher
manifest_score than S9, flagged as candidate new regression.

**Result: 1 new regression** (full detail in `regressions.md`):

### E9-A5-clickhouse-soft-deps: 0.667 → 0.333

Prompt: "We need a ClickHouse Cloud service plus a private endpoint
reachable from our AWS VPC vpc-0abc12345 — wire the whole thing."

S8's `detectMultiProviderPhrasing()` correctly identifies "clickhouse",
"private endpoint", and "AWS VPC" as separate provider mentions and
merges aws+azure+clickhouse. The phrase "private endpoint" matches
azure's concept-alias for `azure_private_endpoint` (97.5 score), which
sweeps the top slots and displaces the expected
`clickhouse_private_endpoint_registration` and `aws_vpc_endpoint` past
the `--max 15` cap.

`clickhouse_service` (the primary expectation) still passes — only the
two soft-dependency expectations get dropped. Severity: bounded.

**Fix candidates (NOT applied — auditor role only):**
- (a) Gate concept-alias-only providers out of multi-provider detect
  (require canonical/substring/service-alias for any provider added to
  the merged set).
- (b) Per-provider `--max` allocation in `mergeOkEnvelopes()` (originally
  P5 R6 recommendation, only partially implemented in S1).

**Verification of S7-high prompts:** all 50 of S7's `≥0.667` prompts
were re-checked. **49 of 50 still ≥0.667 in S9.** The single regression
is exactly the one above.

**5 anti-regression cases** (S8's verification list): ALL HELD.

**5 random spot-checks (seed=42):** ALL UNCHANGED.

---

## §6 k8s-v1-suffix follow-up — S8's diagnosis verified CORRECT

Read `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/knowledge/kubernetes-provider-v2-fields.md`:

```yaml
triggers:
  - tokens: [kubernetes_deployment, kubernetes_deployment_v1]
  - tokens: [kubernetes, _v1, suffix]
  - phrase: "kubernetes_deployment vs kubernetes_deployment_v1"
```

Eval prompt: "Our codebase still uses kubernetes_deployment,
kubernetes_service, kubernetes_config_map. Migrate to the recommended
**_v1 suffixed** resources."

Token analysis:
- Trigger 1 needs both `kubernetes_deployment` AND
  `kubernetes_deployment_v1`. Query has the former (✓), NOT the latter
  (the user wrote the unsuffixed form — that's the whole point of the
  migration query). **Untriggerable.**
- Trigger 2 needs `kubernetes` AND `_v1` AND `suffix`. Query has `_v1`
  (✓ via "_v1 suffixed"); does NOT have a bare `kubernetes` token (it has
  `kubernetes_deployment`, `kubernetes_service`, etc., which tokenize as
  one underscored token each); has `suffixed`, not `suffix` (the
  stemmer has no `-ed` rule). **Untriggerable.**
- Trigger 3 phrase: not in query.

S8's diagnosis is **CORRECT**. The TS matcher is verified-correct via
S8's 4 new unit tests in `v1-suffix-match.test.ts`. The fix is
**bundle-side**: change card triggers to one of:
- `phrase: "_v1 suffixed"` (matches the actual query), or
- `tokens: [kubernetes_deployment, _v1]` (drop the impossible
  `kubernetes_deployment_v1` requirement), or
- add `-ed` rule to TS `stem()` (more invasive, touches tokenization
  semantics; rejected by S8).

This is a **content-side follow-up for v0.1.0.1**, not a code blocker
for v0.1.0. Recommend filing as one bundle-card edit.

---

## §7 Token-cost — `--brief` real-bundle measurement

(Detail in `token-cost.md`.)

| Query | full | brief | ratio |
|---|---|---|---|
| "S3 bucket with versioning" | 43,648 | 14,147 | **32.4%** |
| "Cloudflare Workers with D1 + R2" | 35,121 | 13,564 | **38.6%** |
| "tls cert with cloudflare and acm" | 24,385 | 12,290 | **50.4%** |

Range: **32%–50%**. The original ≤25% target was set against fixture
envelopes; real-bundle floor is dominated by per-file metadata that
brief mode can't strip without breaking downstream consumers.
Recommend documenting **30%–50% as the v0.1.0 reality**.

E3 auto `--top 1` short-circuit firing: **0/76 (0%)** — same as S7.

---

## §8 Reliability assessment

- 0 build warnings added vs S7
- All 4 workspaces' gates exit 0
- Test count UP +18 (380 → 398) — all from S8's 2 new test files
  (multi-provider-phrasing.test.ts + v1-suffix-match.test.ts), zero
  tests deleted
- Net regression: 1 prompt (clickhouse-soft-deps), bounded — top1
  expectation still passes
- Net improvement: +9 prompts moved up at least one expectation worth
  (full list in `regressions.md` §5)
- Architectural intent (A7 cross-prov topology working) achieved with
  measurable +0.220 archetype lift

---

## §9 Honest dashboard note

Per FINAL-VERDICT U6, the dashboard's `+47%` headline is fixture-derived.
This S9 audit is the **authoritative number for v0.1.0 ship**:

> **Cumulative E9 → v0.1.0 lift: +0.165 mean manifest_score
> (+26.5% relative), +15 full-pass prompts (32 → 47), −7 zero-pass
> (12 → 5).**

Any external lift claim should cite this number and the methodology
(76-prompt cross-provider eval, manifest-side scoring with
expectation-based check, top_k=15, real bundle, real CLI).

---

## §10 Final recommendation

🟢 **READY TO TAG v0.1.0.**

Rationale:
1. Net lift is the largest of any audit cycle (+0.075 vs S7,
   +0.165 vs E9).
2. The single new regression (clickhouse-soft-deps) is bounded — the
   primary expectation still passes — and has a clear fix-forward path.
3. The remaining open k8s-v1-suffix issue is bundle-side (one card
   edit) and does not block the code release.
4. All 453 tests across 4 workspaces pass clean.
5. The headline architectural goal (A7 cross-prov topology ≥0.55)
   was hit with margin (0.643 vs 0.55 target).
6. The 3 missed criteria are all known shape-of-work issues
   (#2 weak-provider tail, #4 d1/r2 ranking, #7 brief documentation),
   none of which affect correctness or stability.

**Follow-ups for v0.1.0.1 (NOT blockers):**
- Bundle: edit `kubernetes-provider-v2-fields.md` triggers to match
  actual query phrasing (one card-content fix).
- Code: gate concept-alias-only providers out of
  `detectMultiProviderPhrasing()` to fix clickhouse-soft-deps; OR
  implement per-provider `--max` allocation in `mergeOkEnvelopes()`.
- Code: boost companion-resource ranking further so cloudflare D1+R2
  reach top-10.
- Doc: update README/CLAUDE.md to state `--brief` compresses to
  30%–50% on real bundle (not ≤25%).

🟢 **READY TO TAG v0.1.0**
