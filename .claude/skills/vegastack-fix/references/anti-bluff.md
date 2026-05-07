# Anti-Bluff: 12 Hard Rules

The fix skill MUST NOT advance past VERIFY (step 6) if any rule trips. On
trip: stop, write a status comment to the GH issue ("Verification failed:
<rule>"), do not close, surface to user.

---

### 1. Red-before-green commit ordering

`RED_SHA` (failing test) must exist in `git log` strictly before `GREEN_SHA` (fix).

```bash
git rev-list --topo-order $RED_SHA..$GREEN_SHA   # must list at least RED_SHA's child(ren)
git merge-base --is-ancestor $RED_SHA $GREEN_SHA  # must succeed
```

Failure mode: skill tried to backfill a test after the fix.

### 2. No test deletions/skips/`.only`

Diff `tests/` between `INITIAL_SHA` and `HEAD`:

```bash
git diff $INITIAL_SHA HEAD -- tests/ | rg "^-.*\b(it\.only|describe\.only|it\.skip|describe\.skip|xit|xdescribe|it\.todo)\b" \
  || git diff $INITIAL_SHA HEAD -- tests/ | rg "^-\s*it\(|^-\s*test\(|^-\s*describe\("
```

If any deleted test (`-` lines) or any newly-introduced `.only`/`.skip` → trip.

### 3. Coverage non-regression on touched files

Per-file line and branch coverage at `GREEN_SHA` must be ≥ at `RED_SHA` for every file in BLAST `target` + `direct_callers`. Use vitest JSON coverage reporter and diff numerically.

### 4. Type / lint / format clean

```bash
npm run typecheck && npm run lint && npm run format:check
```

All three must exit 0. No `// @ts-ignore` or `eslint-disable` introduced in the fix unless the PLAN comment explicitly justified it.

### 5. Originating audit category re-run is clean

Run `/vegastack-audit scope=changed category=<cat> mode=ephemeral`. Grep the resulting report for the original finding's normalized title hash. Must not appear.

### 6. Reproducer command is clean

The exact command from the GH issue body's "Repro" section, when re-run, must produce output that does NOT match the symptom. Skill captures both outputs and diffs.

### 7. Blast radius coverage

Every file in `direct_callers` must satisfy ONE of:
- has a test that exercises the changed behavior (test name cited), or
- carries a written justification "unaffected because <reason>" in the PLAN.

### 8. No surviving mutants

After step 7, every file touched in step 5 has 0 surviving mutants across ≥8 attempts. Surviving mutants must have been killed by tests added in step 7 (and committed). If a file is "trivial" (<4 plausible mutants), the user must confirm before proceeding.

### 9. Report-row tamper detection

Hash the finding's row in the audit report at fix-start (after CONFIRM):

```bash
sha256sum <(grep "^| F-007 |" audits/audit-*.md | head -1)
```

Allow only `Status` and `Verified` columns to differ at fix-end. Any other change to that row = tamper. The skill compares the structural hash (everything except those two cells).

### 10. Out-of-scope file edits

If `git diff $RED_SHA HEAD --name-only` includes any file NOT in the BLAST map → trip. Re-run BLAST or restrict the fix.

### 11. Repro-command output stability

Run the repro command from the issue 3 times in a row. All three must produce equivalent (symptom-gone) output. Catches flaky fixes.

### 12. PR description completeness

If the fix produces a PR (via `gh pr create`), the description MUST include a `## How to manually re-verify` section with copy-paste commands. The skill template enforces this; if the user edits it out, the skill warns.

---

## Stop / no-stop matrix

| Trip | Skill action |
|---|---|
| 1, 2, 9 | Critical — refuse to close issue, comment on GH, exit 2 |
| 3, 4, 5, 6, 8, 10, 11 | Refuse VERIFY, request re-fix, leave issue open |
| 7 | Refuse PLAN; re-run BLAST |
| 12 | Block PR create until description fixed |

---

## Tooling

- `git rev-list`, `git merge-base`, `git diff` — commit-order rules.
- `vitest --coverage --reporter=json` — coverage rules.
- `gh issue` / `gh pr` — comment + close + create.
- `sha256sum` (Linux) / `shasum -a 256` (macOS) — hash rules. The skill detects platform.

## Why these and not "fewer"

Each rule maps to a real failure mode observed in agentic codegen:
- Rule 1: writing the test after the fix and pretending it was TDD.
- Rule 2: deleting/skipping the failing test instead of fixing the code.
- Rule 3: fixing a bug in a way that tanks coverage by branching around the bad path.
- Rule 5: claiming a finding is fixed when only a symptom moved.
- Rule 6: claiming the user's repro now works when only an internal test does.
- Rule 8: tests that pass but assert nothing meaningful (mutation-blind).
- Rule 9: edits to the report to hide regressions.
- Rule 10: drive-by changes that smuggle unrelated edits into a fix PR.
- Rule 11: flaky fix that works once.
- Rule 12: "trust me" PRs that reviewers can't independently verify.

Removing any rule re-opens its corresponding failure mode.
