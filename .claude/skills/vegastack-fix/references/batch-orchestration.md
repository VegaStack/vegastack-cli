# Batch Orchestration — Parallel Subagent Fixes

This reference defines how `/vegastack-fix --parallel` runs multiple fixes
concurrently using Opus subagents while preserving every anti-bluff
guardrail.

> **Default is sequential.** Parallel is opt-in via `--parallel`. The skill
> uses parallel only when the audit's `parallel_eligible` flag is true for
> the batch (see `vegastack-audit/references/fix-grouping.md`). Even with
> `--parallel`, the skill auto-degrades to sequential if it detects file
> overlap that the audit missed.

## Why parallel

A run of 5 small isolated fixes takes ~50 min sequentially (each fix runs
its own test suite + mutation review). Parallel with 5 Opus subagents finishes
in ~12 min (max-of-each, plus ~3 min orchestrator overhead). Roughly 4× speedup.

The win grows with batch size and per-fix duration. For mechanical 1-line
fixes the win is small (test runtime dominates). For medium fixes touching
larger files it's significant.

## What stays the same

Every one of the **12 anti-bluff guardrails** still applies. The only
differences vs sequential mode are mechanical:

- Each subagent runs steps 1–7 of the TDD loop on its own branch.
- Steps 8 (EVIDENCE) and 9 (STATUS) are **owned by the orchestrator**, not
  the subagent. Subagents prepare the evidence comment but do NOT post it.
- After all subagents return, the orchestrator runs an **integration verify**
  on the merged HEAD before posting any evidence or closing any issue.

## Eligibility check (run before spawning anything)

The orchestrator MUST verify eligibility even when `--parallel` is passed:

```
parallel_eligible(batch) =
  ALL pairs (a, b) in batch:
    files_touched(a) ∩ files_touched(b) == ∅      AND
    symbols_touched(a) ∩ symbols_touched(b) == ∅
                                                    AND
  ALL issues in batch are tagged mechanical OR small (per audit grouping)
                                                    AND
  ALL issues have no "design review required" marker
                                                    AND
  batch size ≥ 2
```

Where `files_touched(x)` and `symbols_touched(x)` come from re-running BLAST
(grep + ts-morph) for each issue against current HEAD — not the audit's
cached values, because code may have shifted since.

If eligibility fails, fall back to sequential mode for the whole batch and
print the reason.

## Subagent contract

Each subagent receives:

1. **Issue reference** (`#NN` or finding ID).
2. **Branch name** (`fix/audit-NN-<slug>`), pre-created off current `develop` HEAD.
3. **Base SHA** of `develop` at orchestration-start (for `git merge-base` checks).
4. **Output paths** for evidence-prep:
   - `/tmp/fix-NN/evidence-comment.md` — the evidence body (NOT POSTED yet).
   - `/tmp/fix-NN/result.json` — structured result for orchestrator.
5. **Instruction** to run steps 1–7 (CONFIRM → MUTATE) of the TDD loop only.
   **Do NOT post the evidence comment.** **Do NOT close the issue.**
6. **MANDATORY worktree** (post-2026-05-07 lesson). The orchestrator pre-creates a worktree at `/tmp/wt-fix-NN/` and the subagent's prompt instructs it to `cd /tmp/wt-fix-NN/` for all work. Without a worktree, sibling subagents in the same canonical repo flap branches via shared `cwd` and corrupt each other's commits. Worktree usage is no longer optional.
7. **MANDATORY repo-relative paths in characterization fixtures** (post-2026-05-07 lesson). When a subagent generates a baseline JSON for a refactor pin, the script must store paths as `path.relative(REPO_ROOT, abs)` rather than the absolute path. Otherwise the fixture is non-portable across worktrees and breaks at integration-time. Reference: `tests/fixtures/discover/orchestrator-baseline.json` was generated against `/private/tmp/wt-round4-S/...` and failed when run from the canonical `/Users/mk/projects/vegastack-cli/...`. Always store + compare relative.
8. **Honest deferral mandate.** The subagent must mark `skipped: true` with `reason: <one of: needs_design | already_fixed | multi_day_refactor | audit_says_dont_fix>` for any finding it cannot reliably fix. **No half-attempts.** Honest skips are infinitely preferable to brittle fixes that pass only the subagent's own tests.

Subagent return contract (`result.json`):

```json
{
  "issue": 65,
  "branch": "fix/audit-65-preview-shell-injection",
  "red_sha": "abc1234",
  "green_sha": "def5678",
  "additional_commits": ["aaa1111"],
  "files_touched": ["src/commands/preview.ts", "tests/commands/preview.test.ts"],
  "symbols_touched": ["spawnPreview", "detectDevCommand"],
  "tests_added": ["tests/commands/preview-injection.test.ts"],
  "all_guardrails_passed": true,
  "guardrail_failures": [],
  "verify_gate": {
    "test_pass": true,
    "typecheck": true,
    "lint": true,
    "format": true,
    "coverage_delta_files": {"src/commands/preview.ts": {"line": "+0.4%", "branch": "+1.1%"}},
    "audit_recheck_passed": true,
    "repro_clean_runs": 3
  },
  "mutation": {
    "files": {
      "src/commands/preview.ts": {"generated": 8, "killed_existing": 6, "killed_new_tests": 2, "survived": 0}
    }
  },
  "evidence_path": "/tmp/fix-65/evidence-comment.md"
}
```

If `all_guardrails_passed` is false, the subagent must populate
`guardrail_failures` with the rule numbers tripped (1–12 from `anti-bluff.md`)
and a one-line reason each. Do NOT mark guardrails passed if any failed —
the orchestrator's integration step depends on this honesty.

## Orchestrator workflow

```
1. PRE-FLIGHT
   - Compute parallel_eligible(batch). If false → sequential fallback. Stop.
   - Capture BASE_SHA = git rev-parse HEAD.
   - Create one branch per issue: fix/audit-NN-<slug> off BASE_SHA.
   - mkdir /tmp/fix-NN/ for each.

2. FAN OUT
   - Spawn N subagents in a single message (parallel), each with:
     - subagent_type: general-purpose
     - run_in_background: true
     - prompt: per-issue contract above
   - Cap N at 6 by default to avoid GH-API rate-limit hits.
   - Track subagent IDs in /tmp/orchestrator-state.json.

3. COLLECT
   - Wait for all N notifications.
   - Read each result.json. Discard subagents whose all_guardrails_passed=false
     (they failed; their branch stays as-is for human inspection).
   - Build merge_set = subagents that passed.

4. INTEGRATION MERGE (sequential, one branch at a time)
   - For each branch in merge_set, ordered by issue number ascending:
     a. git checkout integration && git merge --no-ff <branch>
     b. If conflict → abort merge, keep INTEGRATION_HEAD at last-known-good,
        record conflict in /tmp/orchestrator-state.json. Move on.
     c. Run integration verify gate (next step).
     d. If integration verify fails → revert this merge, keep last-known-good,
        mark issue as "merged-but-broke-integration" for human review.
     e. If passes → keep merge.

5. INTEGRATION VERIFY (run after every merge)
   - npm test                              (full suite — must pass)
   - npm run typecheck                     (must pass)
   - npm run lint                          (must pass)
   - npm run format:check                  (must pass)
   - **Auto-fix step (post-2026-05-07 lesson):** if `format:check` warns
     about new test files added by subagents, run `npm run format` and
     commit the fixup as `style: prettier-format follow-up`. Don't let
     format warnings cascade into the next merge.
   - **Lint auto-fix:** same — if eslint flags trivial issues
     (`no-unused-vars`, `prefer-nullish-coalescing`, `no-undef NodeJS`),
     fix them in a `chore: lint cleanup` commit so the integration
     branch stays green.
   - For each issue in this and previous merges:
     - Re-run the originating audit category check (cheap version: rerun the
       repro command from the issue body)
     - Re-run mutation review on each touched file (subagent's mutants list,
       reapply each, confirm killed)

6. POST EVIDENCE + CLOSE
   For each issue whose merge was kept AND integration verify passed:
     a. Read /tmp/fix-NN/evidence-comment.md.
     b. Append an "## Integration verify" section noting the integration
        SHA and that the fix coexists cleanly with the rest of the batch.
     c. gh issue comment <NN> --body-file ...
     d. gh issue close <NN> --reason completed
   For each issue that failed integration:
     a. gh issue comment <NN> with "## ⚠️ Integration failure" details.
     b. Leave issue OPEN. Branch survives at fix/audit-NN-<slug> for inspection.

7. SUMMARIZE
   - Print to user: closed-N-of-M, branch names that need attention,
     integration HEAD SHA. The integration branch is left for the human
     to review and either fast-forward develop to OR cherry-pick from.
```

## Failure modes and recovery

| Failure | Behavior | Recovery |
|---|---|---|
| Subagent times out | Treated as "not passed". Branch left in-place. | Re-run `/vegastack-fix #NN` solo. |
| Subagent's `result.json` malformed | Treated as "not passed". | Same. |
| Two subagents accidentally touch the same file (eligibility check missed something) | Caught at integration merge → conflict → both branches preserved, neither closed. | Run sequentially, fix the harder one first. |
| Integration verify fails *after* a merge | That merge is reverted; integration HEAD stays at last-known-good. | Subagent's branch survives for inspection. Human decides whether to redo or drop. |
| Mutation re-run on integration fails for a previously-passing fix | The fix that introduced the regression is reverted (most recent merge). | Investigate why mutation passed per-branch but failed combined. |
| GH API rate limit during close | Orchestrator queues remaining gh actions and retries after 60s. | Auto. |
| Orchestrator itself crashes mid-batch | `/tmp/orchestrator-state.json` records progress. Re-run picks up where it left off. | Re-invoke `/vegastack-fix --parallel --resume`. |

## Hard rules

- **Subagents NEVER post evidence comments.** Only the orchestrator posts.
- **Subagents NEVER close issues.** Only the orchestrator closes.
- **Subagents NEVER touch `develop` directly.** Always work on their fix branch.
- **Orchestrator NEVER pushes** unless the user explicitly says so. The
  integration branch stays local. The user reviews + pushes manually.
- **Integration verify re-runs mutation review on touched files.** A mutant
  that survived per-branch but is killed at integration is fine. A mutant
  that was killed per-branch but survives at integration is a regression
  and the responsible merge is reverted.

## When `--parallel` is the wrong choice

- Batch is genuinely sequential (file overlap, design dependency).
- Working from a slow network where GH API calls dominate runtime — parallel
  helps test time, not API time.
- You actually want to review each PLAN comment before the FIX lands.
  `--parallel` implies `--auto` (no human gate). For batches where you want
  per-fix review, run sequentially.
- The audit found low confidence in the batch (e.g., several `MISMATCH`
  entries clustered together) — sequential gives better visibility.

## Worked example

```
$ /vegastack-fix #65 #68 #69 #71 #73 #74 #79 #80 --parallel

[orchestrator] Eligibility check on 8 issues...
[orchestrator]   files_touched union has no overlaps ✓
[orchestrator]   all 8 tagged small or mechanical ✓
[orchestrator]   no design-review markers ✓
[orchestrator]   eligible — proceeding parallel
[orchestrator] Capturing BASE_SHA = a1ff2c0...
[orchestrator] Creating 8 branches: fix/audit-65, fix/audit-68, ..., fix/audit-80
[orchestrator] Spawning 6 subagents (cap=6); queueing 2 more
[orchestrator]   subagent #65 ... in progress
[orchestrator]   subagent #68 ... in progress
[orchestrator]   ...
[orchestrator] All 6 returned. Spawning queued #79, #80.
[orchestrator] All 8 returned. 7 passed, 1 failed (#71 — guardrail #8 mutation survived).
[orchestrator] Building integration branch from 7 passed...
[orchestrator]   merge fix/audit-65 → integration: clean. integration verify... passed.
[orchestrator]   merge fix/audit-68 → integration: clean. integration verify... passed.
[orchestrator]   ...
[orchestrator]   merge fix/audit-79 → integration: CONFLICT in package-lock.json. Aborted.
[orchestrator]   integration HEAD held at fix/audit-74 SHA xyz789
[orchestrator] Posting evidence + closing 6 issues...
[orchestrator]   #65 closed ✓
[orchestrator]   #68 closed ✓
[orchestrator]   ... 6 closed.
[orchestrator]   #71 commented "subagent guardrail failure" — kept open
[orchestrator]   #79 commented "integration conflict on package-lock.json" — kept open
[orchestrator] DONE. Closed 6 of 8.
[orchestrator] Branches surviving for inspection: fix/audit-71, fix/audit-79
[orchestrator] Integration HEAD: xyz789 (local, not pushed)
[orchestrator] Wall clock: 14 min (vs ~50 min sequential — 3.6× faster)
```

## Caveats reminder

This is a force multiplier with sharp edges. Read the table in the user's
question that originally listed the caveats — they all still apply. The
ones most likely to bite:

- **GH API rate limits** at 8+ parallel subagents on a busy repo.
- **Tests touching shared global state** (singletons, env vars, file system
  fixtures) can pass per-branch but fail combined. Integration verify catches
  this — but only after merging.
- **Cost.** N parallel Opus subagents = N× tokens compared to sequential.
  For mechanical fixes this is wasteful. For medium fixes with significant
  thinking time, the wall-clock win usually justifies the cost.
- **Determinism.** Two parallel subagents on similar issues might produce
  cosmetically different fixes. Code review the integration branch before
  pushing.
