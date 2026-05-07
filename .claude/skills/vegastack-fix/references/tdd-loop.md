# 9-Step TDD Loop — Specification

Every step is mandatory. The skill cannot skip; it can only stop on guardrail trip.

---

## Step 1 — CONFIRM

**Goal:** restate the bug in your own words and gate the loop on having actionable input.

Actions:
- Resolve input: finding ID → load row from latest matching report; GH ref → `gh issue view <n> --json title,body,labels,state,url,author`; free-text → require user to file a GH issue first OR proceed in `--dry-run` only.
- Re-read evidence. If evidence is missing/insufficient → ask user to expand the issue body before proceeding.
- For outsider issues (no `audit` label): classify severity using audit-skill rubric, set `severity:*` and `area:*` labels, set issue type, post a triage comment.
- Capture: `ISSUE_REF`, `INITIAL_SHA = git rev-parse HEAD`, `BRANCH_BASE = $(git rev-parse --abbrev-ref HEAD)`.

Exit: structured CONFIRM record (issue ref, severity, category, restated symptom, repro command).

---

## Step 2 — REPRODUCE  (TDD red)

**Goal:** prove the bug with a failing test in a real commit before any production code change.

Actions:
- Identify or create the right test file under `tests/`. Match the project layout (e.g. `tests/lib/foo.test.ts` for `src/lib/foo.ts`).
- Write a test that:
  - Imports the real module (no mocks of the unit under test).
  - Invokes the path that triggers the symptom from the issue.
  - Asserts the **expected correct behavior** (not "throws" — assert what should be true).
- Run the test: it MUST fail with output that matches the symptom in the issue. If it passes, the test is wrong — rewrite.
- Commit:
  ```
  git add tests/<path>.test.ts
  git commit -m "test(<area>): reproduce <issue-ref> (failing)"
  ```
- Record `RED_SHA = git rev-parse HEAD`.

Guardrail: `RED_SHA` must be a real commit (not staged, not stashed). Anti-bluff rule #1.

---

## Step 3 — BLAST  (impact map)

See `blast-radius.md` for methodology.

Output of this step is a structured map:

```
target: <file/symbol>
direct_callers: [<file:line>, ...]
transitive_callers: [<file:line>, ...]
tests_touching: [<file>, ...]
docs_touching: [<file>, ...]
config_touching: [<file>, ...]
unaffected_with_reason: [{file: <f>, reason: <one-line>}]
```

Two-pass:
1. Fast grep pass (`rg -t ts <symbol>`) — wide net.
2. AST confirmation pass with `ts-morph` (`npx tsx scripts/blast.ts <symbol>` or invoked inline) — drops false positives, adds transitive references.

If the map is empty → suspicious. The skill must re-run with broader query and explain in PLAN.

---

## Step 4 — PLAN  (review gate)

Write a comment on the GH issue (or report verification log if ephemeral):

```
## Plan
**Root cause:** <one paragraph>
**Approach:** <one paragraph>
**Alternatives considered:** <bulleted, with reasons rejected>
**Blast radius:**
  Direct callers: <list>
  Transitive callers: <list>
  Tests to add/modify: <list>
  Docs to update: <list>
  Unaffected (justified): <list with reasons>
**Risk:** <low|med|high> — <why>
**Reverse plan:** <how to revert if shipped fix is wrong>
```

If `--auto` is not set: pause and ask the user "Approve plan? [y/n/edit]". Wait for explicit approval.

Default behavior: pause. `/ship` ephemeral mode passes `--auto` only when the originating audit was opened by the same maintainer in the same session.

---

## Step 5 — FIX

**Goal:** apply the minimal patch.

Rules:
- Touch only files in the BLAST map's "direct_callers", "target", or "tests/docs_touching" lists.
- No drive-by refactors. No reformatting unrelated code.
- No new dependencies unless explicitly part of the plan and approved.
- Update docs/help text if the fix changes user-visible behavior.
- Commit:
  ```
  git add <files>
  git commit -m "fix(<area>): <short imperative> (<issue-ref>)"
  ```
- Record `GREEN_SHA = git rev-parse HEAD`.

Guardrail: if the staged diff includes files outside the BLAST map → stop, re-run BLAST.

---

## Step 6 — VERIFY

Run the full gate. Each must pass independently.

```bash
# 6a — the originally-failing test now passes
npx vitest run <test-file>

# 6b — full suite
npm test

# 6c — coverage non-regression
npx vitest run --coverage
# compare per-file line/branch on touched files vs RED_SHA baseline
git stash && git checkout $RED_SHA -- src/  # baseline
npx vitest run --coverage --reporter=json > /tmp/cov-red.json
git checkout $GREEN_SHA -- src/ && git stash pop
npx vitest run --coverage --reporter=json > /tmp/cov-green.json
# (skill diffs the two; touched files must not regress)

# 6d — type/lint/format
npm run typecheck
npm run lint
npm run format:check

# 6e — re-run originating audit category
/vegastack-audit scope=changed category=<cat> mode=ephemeral
# (skill greps the resulting report for the original finding fingerprint;
#  must not appear)

# 6f — re-run the issue's repro command
<exact command from issue>
# expect: symptom gone
```

Any failure → stop, report which gate, do not advance.

---

## Step 7 — MUTATE  (agentic mutation review)

Default = agentic; `--strict-mutation` adds stryker.

### Agentic loop

For each file touched in step 5 (production code only, not tests):

1. Read the file + its tests.
2. Generate ≥ **8 semantic mutants**. Mutants are deliberate, plausible-looking edits that change behavior:
   - Flip boolean operators (`&&` ↔ `||`, `===` ↔ `!==`)
   - Swap branch bodies in if/else
   - Drop a guard clause
   - Change a constant by 1 or to 0/empty
   - Weaken a regex (replace `^…$` with `.+`, drop a character class)
   - Return early before a side effect
   - No-op a method call that has a side effect
   - Swap a parameter in an internal call
   - Return the wrong success/error value type
3. For each mutant: apply via `Edit`, run the targeted tests, record kill (test failed) or survive (suite still green), revert.
4. **Surviving mutants → write a test that kills it**, commit it as `test(<area>): kill mutant <n> (<issue-ref>)`, repeat.
5. Loop exits when 0 mutants survive across N≥8 attempts on each touched file.

If fewer than 4 mutants are plausible for a file (truly trivial code), record `mutation_coverage: trivial` with the reasoning. Anti-bluff rule: this self-flag is reviewed by the user before proceeding — stop and ask.

### Strict mode

`--strict-mutation` additionally runs `npx stryker run` scoped to touched files via `mutate: [<files>]` in stryker config. Score must be ≥ baseline (or ≥75% on first run).

### Output

Mutation summary block (goes into evidence comment):

```
File: src/lib/foo.ts
Mutants generated: 11
Killed by existing tests: 9
Survived → fixed by new tests: 2 (commits: <sha1>, <sha2>)
Final survivors: 0
```

---

## Step 8 — EVIDENCE

Post the evidence comment on the GH issue. Template in `evidence-comment.md`. Includes:

- RED_SHA → GREEN_SHA (linked)
- Final commit list
- Test names that prove the fix
- Coverage delta on touched files
- Mutation summary per file
- Original repro command + its now-clean output
- Audit re-run output (no finding)
- "How to manually re-verify" copy-paste block

In ephemeral mode: append to the report's `## Verification log` instead.

---

## Step 9 — STATUS

- `gh issue close <n> --reason completed --comment "<evidence summary or link>"`
- Edit the report row (only `Status` and `Verified` columns):
  - `Status: closed`
  - `Verified: completed`
- Append `Verification log` entry referencing the finding ID, GREEN_SHA, evidence comment URL.
- Print summary to user: "Fixed F-NNN / #N. Branch: <branch>. Commits: <list>. Push when ready."

The skill does not push. The user's release workflow (or `/ship`) handles push/publish.
