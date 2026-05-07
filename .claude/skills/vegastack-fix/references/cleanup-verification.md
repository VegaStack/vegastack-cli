# Cleanup-Verification Subagent (Round-N+1 probe)

After a parallel-fix batch lands and individual issues are closed, spawn
**one final "cleanup-verification" subagent** before declaring the rollup
done. This pattern emerged from the 2026-05-07 audit drainage and proved
high-leverage: the subagent confirmed 11 findings were already-fixed by
adjacent work and identified 14 honest deferrals, leaving zero findings
in ambiguous-status.

## When to spawn

After every `/vegastack-fix --parallel` batch that targets a rollup issue
(#82, #83, or any equivalent), or any time more than 5 findings were
batch-resolved.

## Prompt template

```
/vegastack-fix subagent — cleanup-verification probe for rollup #<N>.

Working dir: /Users/mk/projects/vegastack-cli. Worktree:

  git worktree add /tmp/wt-cleanup-<N> fix/cleanup-<N>
  cd /tmp/wt-cleanup-<N>

Output: /tmp/cleanup-<N>/result.json + evidence.md.

## Mission

Read audits/<latest-audit-report>.md cover-to-cover. For every finding
the previous batch did NOT resolve (cross-reference against `git log
--oneline -200` and the rollup issue body's "✅ fixed" list):

For each remaining finding:
  - If the cited code at file:LINE has been changed by a recent commit
    (not necessarily the fix-issue commit) AND the symptom is gone →
    record `already_fixed: true` with attribution to the closing commit.
  - If the finding is a real bug AND a fix exists in <30 LOC → write a
    focused failing test, apply, verify. Commit on the cleanup branch.
  - If the finding requires multi-day work, design review, or is an
    audit false-positive → record `skipped: true` with one of:
      reason: needs_design | multi_day_refactor | audit_says_dont_fix |
              behavior_change_needs_signoff
    Do NOT half-attempt.

Honesty mandate: leave only items that genuinely need a maintainer's
design call.

## Result.json

{
  "rollup_issue": <N>,
  "branch": "fix/cleanup-<N>",
  "fixes_completed": [...],
  "fixes_already_fixed": [{"finding": "...", "closing_commit": "<sha>"}],
  "fixes_skipped": [{"finding": "...", "reason": "..."}],
  "all_guardrails_passed": true,
  "evidence_path": "/tmp/cleanup-<N>/evidence.md"
}

Return: 3-line summary with counts.
```

## Why this works

- **Verification ≠ fixing.** The subagent's main output is *attribution*,
  not patches. Most rollup remainders are addressable by acknowledging
  prior work.
- **Forces honest deferrals.** Without this probe, "remaining" items get
  silently re-attempted by the next session, often producing brittle
  fixes. With it, deferrals are documented up-front.
- **Cheap.** ~5 min subagent, no merge required if it produces only the
  result.json + evidence.md (no commits). The orchestrator updates the
  rollup issue body with the dispositions.

## Orchestrator handling

After the cleanup subagent returns:

1. Read `/tmp/cleanup-<N>/result.json`.
2. Update the rollup issue (#82/#83) body to reflect the new dispositions:
   - Move `already_fixed` items into a "verified-already-fixed" section
   - Move `skipped` items into a "honest deferrals" section with reason
   - Move newly-completed items into "✅ fixed in cleanup pass"
3. If `fixes_completed` had any commits, merge the cleanup branch into
   develop with the same integration-verify dance as a normal subagent.
4. If only documentation changes (result.json with all `already_fixed` /
   `skipped`), no merge needed — just edit the rollup body.

## Closing decision

Once the cleanup subagent has run and the rollup body reflects the final
state:
- If 0 actionable items remain → close the rollup with reason
  `not_planned` and a comment summarizing dispositions, OR
- Leave open as living tracker if the maintainer prefers backlog
  visibility.

The 2026-05-07 audit closed both rollups (#82 and #83) as `not_planned`
after the round-4 cleanup confirmed no actionable items remained.
