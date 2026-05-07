# Evidence Comment Template

Posted on the GitHub issue at step 8 (EVIDENCE), immediately before issue close.
In ephemeral mode, appended to the report's `## Verification log` instead.

All snippets below pass through the redactor (same patterns as audit skill's `anti-bluff.md` §redaction).

## GitHub comment template

```markdown
## ✅ TDD-Verified Fix

**Fix branch:** `<branch>`
**Red commit:** [`<RED_SHA_short>`](<repo>/commit/<RED_SHA>) — failing test that reproduces this issue
**Green commit:** [`<GREEN_SHA_short>`](<repo>/commit/<GREEN_SHA>) — minimal fix
**Additional commits:** <list of test-adding commits from MUTATE step>

### Reproducing test
- `tests/<path>.test.ts` → `<test name verbatim>`
- Output at RED: <one-line summary, redacted>
- Output at GREEN: passes

### Verification gate
| Gate | Result |
|---|---|
| Originally-failing test now passes | ✅ |
| Full suite (`npm test`) | ✅ <N tests, M ms> |
| Coverage non-regression on touched files | ✅ <line: +Δ%, branch: +Δ%> |
| Typecheck (`npm run typecheck`) | ✅ |
| Lint (`npm run lint`) | ✅ |
| Format (`npm run format:check`) | ✅ |
| Audit re-run (category=<cat>) — finding gone | ✅ |
| Issue repro command — symptom gone | ✅ (3 consecutive runs) |

### Mutation review (agentic)
| File | Generated | Killed by existing | Killed by new tests | Survived |
|---|---|---|---|---|
| `src/lib/foo.ts` | 11 | 9 | 2 | 0 |
| `src/lib/bar.ts` | 8 | 8 | 0 | 0 |

<Optional: stryker section if --strict-mutation>

### Blast radius (final)
- Direct callers updated: <list>
- Direct callers verified unaffected: <list with reasons>
- Tests added/modified: <list>
- Docs updated: <list>

### Original repro command
```
<exact command from issue body>
```
Output (redacted, 3 runs identical):
```
<output excerpt>
```

### How to manually re-verify
```bash
git fetch origin <branch>
git switch <branch>
npm ci
<original repro command>          # symptom should be gone
npx vitest run <test-file>        # should pass
npm test                          # full suite green
```

### Anti-bluff guardrails
All 12 rules passed. See [`.claude/skills/vegastack-fix/references/anti-bluff.md`](../.claude/skills/vegastack-fix/references/anti-bluff.md).

---
*Closed automatically by `/vegastack-fix`. If something looks wrong with the verification, reopen the issue and ping the maintainer.*
```

## Local report verification-log entry (ephemeral mode)

Appended at the bottom of `audits/audit-<run>.md`:

```markdown
## Verification log

### F-007 — `<title>` — verified <ISO>
- Red: `<RED_SHA>`
- Green: `<GREEN_SHA>`
- Test: `tests/<path>.test.ts > <test name>`
- Coverage delta on touched files: line +Δ%, branch +Δ%
- Mutation: `src/lib/foo.ts` 11 generated / 0 survived
- Repro command output: clean (3/3)
- Audit re-run (category=`<cat>`): finding absent

### F-009 — `<title>` — verified <ISO>
...
```

## Triage comment template (for outsider issues, posted at step 1)

```markdown
## Triage

Thanks for filing this. Classifying for our audit/fix workflow:

- **Severity:** <critical|high|medium|low>
- **Category:** <one of 11>
- **Area:** `area:<category>` label applied
- **Type:** <Bug|Task> (GitHub issue type set)
- **Reproducible:** <yes|no — if no, requesting more info>
- **Fix planned:** running `/vegastack-fix #<n>` now / queued for next batch

Will post a Plan comment shortly with the proposed approach + blast radius.
You'll get a final verification comment with TDD evidence before this closes.
```

## Plan comment template (step 4)

See `tdd-loop.md` §4 for the structure. Always posted as its own comment so it's distinguishable from the evidence comment.

## Failure-mode comments

When a guardrail trips, the skill posts:

```markdown
## ⚠️ Verification failed

Rule **#<N> — <name>** tripped during verification.

<details>
<summary>Detail</summary>

<command output, redacted>
</details>

The fix has NOT been merged and this issue remains open. Manual review needed.

Branch left at `<branch>` for inspection. To retry: `/vegastack-fix #<this>`.
```
