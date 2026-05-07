---
name: vegastack-fix
description: |
  Validate-then-fix loop for @vegastack/cli findings with strict anti-bluff
  TDD enforcement. Accepts a finding ID from a local audit report, a GitHub
  issue URL/number, or a free-text bug; reproduces with a failing test,
  maps blast radius via grep + ts-morph, applies a minimal fix, runs full
  verification (suite, coverage non-regression, type/lint/format, audit
  re-run, repro re-run, agentic mutation review), posts evidence to the GH
  issue, and auto-closes. Supports --auto, --dry-run, --strict-mutation, and
  batch mode (sev=high|critical).

  USE THIS SKILL aggressively whenever the user wants to fix, resolve,
  reproduce, debug, or verify a fix for any reported bug, regression,
  vulnerability, security finding, audit finding, GitHub issue, or stale
  reference in this repo — including pasting a GH issue URL or saying
  things like "fix #143", "address F-007", "I got a bug report from a
  user", "reproduce this", "verify the fix doesn't break anything", or
  invoking /vegastack-fix. Also trigger when /ship runs (it chains this
  skill after /vegastack-audit). Trigger even when the user does not say
  "fix" — phrases like "make this issue go away", "patch this", "this is
  broken in v0.1.x" all count.

  DO NOT use for: writing new features (no failing-bug exists); broad
  audits (use /vegastack-audit); user-facing CLI questions about how to
  USE vegastack (use /vegastack).
license: MIT
allowed-tools: Bash(git:*) Bash(gh:*) Bash(npm:*) Bash(npx:*) Bash(node:*) Bash(rg:*) Bash(find:*) Bash(jq:*) Bash(date:*) Bash(diff:*) Bash(sha256sum:*) Bash(shasum:*) Bash(tsx:*) Read Grep Glob Write Edit Agent WebSearch
user-invocable: true
argument-hint: "<finding-id|gh-issue-url|gh-issue-number|free-text|all sev=high> [--auto] [--strict-mutation] [--dry-run]"
metadata:
  schema_version: "2"
---

# vegastack-fix

Validate, fix, and prove a fix with anti-bluff TDD.

## Preconditions

- Run from repo root. `git`, `node`, `npm`, `gh` (authenticated, write scope) on PATH.
- Working tree may be dirty; the skill records `INITIAL_SHA` and refuses to fix if unrelated edits are mixed into the fix's BLAST scope (rule #10).
- For ad-hoc free-text bugs without a GH issue, the user must file the issue first OR pass `--dry-run` (steps 1–4 only).

## Inputs (any one)

| Input | Example |
|---|---|
| Local finding ID | `F-007` (skill locates the most recent `audits/audit-*.md` containing it) |
| GitHub issue URL | `https://github.com/vegastack/vegastack-cli/issues/143` |
| GitHub issue number | `#143` |
| Free-text bug | `"vegastack init crashes on Windows when path has spaces"` |
| Batch | `all sev=high` (only operates on open issues with label `audit` and matching severity) |

## Flags

- `--auto` — proceed through all 9 steps without pausing for review at the PLAN gate. Default: pauses at PLAN.
- `--strict-mutation` — also run stryker on touched files in addition to agentic mutation review.
- `--dry-run` — execute steps 1–4 only (CONFIRM, REPRODUCE, BLAST, PLAN). No production code edits.
- `--parallel` — when given multiple issues, fan them out as parallel Opus subagents (one branch each), then run an integration verify on the merged HEAD before posting evidence or closing any issue. Off by default. Auto-degrades to sequential if the eligibility check fails (file overlap, design-call markers, batch size <2). See `references/batch-orchestration.md` for the full spec, eligibility rules, failure recovery, and caveats.
- `--resume` — when an earlier `--parallel` run was interrupted, resume from `/tmp/orchestrator-state.json` instead of re-spawning subagents that already finished.

## The 9-step TDD loop

See `references/tdd-loop.md` for the full specification. Summary:

1. **CONFIRM** — fetch issue / read finding row, restate the bug, classify severity if missing, apply labels (for outsider issues), comment triage on GH.
2. **REPRODUCE** — write a failing test that exercises the symptom; commit the test as `test(<area>): reproduce <issue-ref>`. Capture the **RED commit SHA**. Run the test — it must fail with the symptom from the report.
3. **BLAST** — map blast radius. See `references/blast-radius.md`. Grep first; AST confirmation pass with `ts-morph` for symbol-precise references; output a list of files + tests + docs that touch the changed area. Each non-test file must be either: (a) included in the fix, or (b) annotated "unaffected because <reason>".
4. **PLAN** — write a fix proposal as a comment on the GH issue (or in the report's verification log if ephemeral). Include: chosen approach, alternatives considered, blast-radius map, expected test list. **Pause for review unless `--auto`.**
5. **FIX** — apply the minimal patch. No drive-by refactors. Commit as `fix(<area>): <short> (<issue-ref>)`. Capture the **GREEN commit SHA**.
6. **VERIFY** — the previously-failing test now passes. Then run the full gate:
   - `npm test` (suite green)
   - `npx vitest run --coverage` (coverage non-regression on touched files)
   - `npm run typecheck`
   - `npm run lint`
   - `npm run format:check`
   - Re-run the **originating audit category** (`/vegastack-audit scope=changed category=<cat>`) — finding must no longer appear.
   - Re-run the **originating repro command** from the issue — symptom must be gone.
7. **MUTATE** — agentic mutation review on touched files. See `references/tdd-loop.md` §mutate. Generate ≥8 semantic mutants; each mutant must be killed by the test suite. Surviving mutants → add tests, then re-mutate. With `--strict-mutation`, also run stryker.
8. **EVIDENCE** — post the evidence comment on the GH issue. Template in `references/evidence-comment.md`. Includes RED SHA, GREEN SHA, test names, coverage delta, mutation summary, repro command, list of mutants and outcomes.
9. **STATUS** — close the issue with reason `completed`. Update the report row: `Status: closed`, `Verified: completed`. Append entry to `## Verification log` section of the report.

## Anti-bluff hard rules (load `references/anti-bluff.md`)

The skill MUST refuse to advance past VERIFY if any of the following is true:

1. RED commit SHA not present in `git log` before the GREEN commit SHA.
2. The reproducing test was deleted, skipped, marked `.only`, `.skip`, `xit`, `it.todo`, or had its assertions weakened between RED and GREEN.
3. Coverage on a touched file dropped (line OR branch).
4. Any of typecheck/lint/format failed.
5. The originating audit category re-detects the finding.
6. Any tracked test file was deleted.
7. The blast-radius list contains files that have neither a test exercising the change nor a written justification.
8. A mutant in MUTATE survived without a follow-up test added.
9. The report-row hash at fix-end differs from any expected change scope (only `Status` and `Verified` columns may change; see `references/report-format.md` in the audit skill).
10. The fix touched files outside the blast-radius map without re-running BLAST.
11. The repro command from the GH issue body still exhibits the original symptom.
12. The PR description lacks a "How to manually re-verify" section with copy-paste commands.

If any guardrail trips, the skill stops, writes a status comment to the GH issue ("Verification failed: <rule>"), and **does not close the issue**. Manual review required.

## Ad-hoc outsider issues

When given a GH issue not labeled `audit`:

1. Run triage first (CONFIRM step extended): classify severity using the audit-skill rubric, set the `severity:*` and `area:*` labels, set issue type if org has them, add a triage comment with classification rationale.
2. Then proceed normally through the 9 steps.
3. Reply to the original reporter on issue close with the evidence summary.

## Batch mode

`/vegastack-fix #65 #68 #69 …` or `/vegastack-fix all sev=high`:

- Lists target issues (explicit list or matching the severity selector).
- Confirms with user before proceeding (unless `--auto`).
- **Default:** runs the 9-step loop sequentially per issue. Safest — guardrails are guaranteed to apply against current HEAD.
- **With `--parallel`:** fans out as Opus subagents, one per issue, each on its own branch. After all return, runs an integration verify on the merged HEAD before posting evidence or closing any issue. See `references/batch-orchestration.md`.
- Each fix is its own commit on its own branch; the skill does not push.

The audit skill emits a `## Recommended fix batches` table (see `vegastack-audit/references/fix-grouping.md`) that pre-computes which batches are parallel-eligible. Use it to pick batch sizes that match how the issues actually interact.

## Ephemeral mode (chained from /ship)

When invoked from `/ship`:

- Source of findings is the local report file passed by `/ship` (no GH).
- Issue creation/closure steps become local report-row updates only.
- Evidence is appended to the report's `## Verification log` instead of GH.
- All other guardrails apply identically.

## Hard rules

- **Never push to remote, never tag, never publish.** This skill creates local commits and PRs only via `gh pr create` (and only if the user explicitly requests). Default: leaves commits on a fix branch for the user to push.
- **Never edit historical commits** (no `--amend`, no rebase that touches non-top-of-branch commits).
- **Never disable a guardrail** to make a fix pass. If a rule trips, the human decides.

## References (load on demand)

- `references/tdd-loop.md` — full 9-step spec including agentic mutation testing detail.
- `references/blast-radius.md` — grep + ts-morph methodology.
- `references/anti-bluff.md` — the 12 hard rules in detail.
- `references/evidence-comment.md` — GH comment template + report verification-log template.
- `references/batch-orchestration.md` — `--parallel` orchestration: eligibility check, subagent contract, integration verify, failure recovery. Read this before passing `--parallel` to a batch.
- `references/cleanup-verification.md` — round-N+1 cleanup-verification subagent template. Spawn after every parallel-fix batch that targets a rollup issue to confirm dispositions and avoid half-attempted fixes in the next round.

## Quick start

```
/vegastack-fix F-007                       # finding from latest audit report
/vegastack-fix #143                        # GH issue
/vegastack-fix https://github.com/vegastack/vegastack-cli/issues/207
/vegastack-fix all sev=high                # batch, sequential
/vegastack-fix #65 #68 #69 #71             # explicit batch, sequential
/vegastack-fix #65 #68 #69 #71 --parallel  # explicit batch, fan out as Opus subagents
/vegastack-fix F-007 --auto                # skip the PLAN review pause
/vegastack-fix F-007 --dry-run             # only steps 1–4
/vegastack-fix F-007 --strict-mutation     # add stryker on top of agentic review
/vegastack-fix --parallel --resume         # continue an interrupted parallel batch
```

The audit skill's `## Recommended fix batches` table (in the tracking issue
and the local report) shows pre-computed batches with `Parallel-OK` flags —
copy a row's command directly.
