---
name: vegastack-audit
description: |
  Production-readiness audit for @vegastack/cli covering 11 categories:
  repo-hygiene, supply-chain, secrets, security, code-quality, code-review,
  test-coverage, cross-platform, performance, docs-and-ux, release-readiness.
  Writes one timestamped report under audits/ and (in standalone mode) opens
  deduped GitHub issues for actionable findings. Designed to be run
  repeatedly and reliably.

  USE THIS SKILL aggressively whenever the user mentions auditing,
  production readiness, OSS-launch readiness, security/vulnerability checks,
  finding bugs, finding stale or unused code, "is this safe to release",
  test-coverage gaps, supply-chain or dependency hygiene, cross-platform
  bugs (Windows/WSL/Alpine), performance regressions in this CLI, doc
  staleness, "audit this PR/branch", or invokes /vegastack-audit. Also
  trigger when /ship runs (it chains this skill in ephemeral mode before
  any release). Trigger even if the user does not say the word "audit" —
  any request that maps to one of the 11 categories above counts.

  DO NOT use for: writing new features; one-off bug investigation (use
  /vegastack-fix instead); user-facing CLI questions about how to USE
  vegastack (use /vegastack).
license: MIT
allowed-tools: Bash(git:*) Bash(gh:*) Bash(npm:*) Bash(npx:*) Bash(node:*) Bash(rg:*) Bash(find:*) Bash(jq:*) Bash(date:*) Bash(mkdir:*) Bash(wc:*) Bash(sort:*) Bash(uniq:*) Bash(diff:*) Bash(sha256sum:*) Bash(shasum:*) Bash(gitleaks:*) Bash(hyperfine:*) Read Grep Glob Write Edit Agent WebSearch
user-invocable: true
argument-hint: "[scope=full|changed] [category=<csv>] [mode=standalone|ephemeral] [--strict-mutation]"
metadata:
  schema_version: "2"
---

# vegastack-audit

Run an end-to-end production-readiness audit of `@vegastack/cli`.

## Preconditions

- Run from the repo root.
- `git`, `node`, `npm`, `gh` (authenticated) on PATH. `gitleaks`, `hyperfine`, `osv-scanner` are recommended; if missing, the affected category records "tool unavailable" instead of skipping silently.
- A clean tree is **not** required — audit runs against the working tree as-is and notes dirty state in the report header.

## Invocation modes

| Invocation | Mode | GH issues | Report file |
|------------|------|-----------|-------------|
| `/vegastack-audit` (default) | standalone | yes (auto-create High+Medium, rollup Low) | committed under `audits/` |
| `/vegastack-audit scope=changed` | standalone | yes | committed under `audits/` |
| Chained from `/ship` | ephemeral | **no** — local report only | committed under `audits/` alongside the release |

## Arguments

- `scope=full` (default) — every file in the repo, every category.
- `scope=changed` — only files modified in the working tree (`git status --porcelain`, both staged and unstaged) **plus** their computed blast radius. Untracked files are included.
- `category=<csv>` — restrict to a subset of the 11 categories (see `references/categories.md`).
- `mode=standalone|ephemeral` — set explicitly when calling from another skill. Default: `standalone`.
- `--strict-mutation` — opt-in: also run stryker for hard mutation evidence on top of the agentic mutation review. Default off.

## Steps

1. **Capture context.**
   - `git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD`, `git status --porcelain`.
   - Note dirty state in the report header. **Do not stash.** Audit runs against the working tree as-is.

2. **Compute target file set.**
   - `scope=full`: all tracked files + all untracked non-ignored files.
   - `scope=changed`: changed files from `git status --porcelain` ∪ blast radius (see `references/blast-radius.md`).

3. **Decide categories.** Default = all 11. If `category=` provided, run only those. See `references/categories.md` for the full checklist per category, including the exact commands and pass/fail criteria.

4. **Allocate audit run filename.**

   ```
   EPOCH=$(date -u +%s)
   ISO=$(date -u +%Y-%m-%dT%H-%M-%SZ)
   FILE="audits/audit-${EPOCH}-${ISO}-${SCOPE}.md"
   ```

   Filename is sortable: epoch prefix guarantees lexicographic = chronological.

5. **Run categories in parallel where independent.** Use the `Agent` tool with subagent type Explore or general-purpose to fan out:
   - Always serial (network/state side-effects): `supply-chain`, `release-readiness`.
   - Parallelizable: every other category, plus the 10 `code-review` slices (see `references/categories.md` §code-review).
   - Each subagent returns a structured Markdown section + a list of findings as JSON-ish blocks for the table.

6. **Aggregate findings into one table.** Schema in `references/report-format.md`. Columns: `ID | Sev | Category | Location | Title | Issue | Status | Verified`. Locations and issues are clickable links.

7. **Redact secrets** in the report body before writing to disk. See `references/anti-bluff.md` §redaction. Pass everything through gitleaks-rule patterns + the project's known token shapes.

8. **Write the single audit report file.** Single file, sectioned by category. No per-category files.

9. **Create GitHub issues** (only when `mode=standalone`):
   - Skip entirely in ephemeral mode.
   - Severity gate: Critical/High/Medium → individual issue; Low → single rollup issue per run; Info → local report only.
   - Dedup: query existing open issues by `(category, file, normalized-title-hash)` before creating. On match, comment "re-detected in audit `<filename>`" and link from the new run's tracking issue. Do not duplicate.
   - Create one **tracking issue** per run titled `Audit <ISO> — <scope>` containing a checklist of child issue refs.
   - Apply native GitHub issue types where configured (Bug/Task) — see `references/gh-issue-flow.md`.
   - Labels (minimal): `audit`, `severity:critical|high|medium|low`, `area:<category>`. No status labels — GitHub's open/closed state is authoritative.
   - Update the report's `Issue` column with the resulting issue URLs.

10. **Print summary** to the user: counts by severity, link to the report file, link to the tracking issue (if standalone).

11. **Anti-bluff verification** of the audit run itself: every finding must cite a specific file:line OR a specific command output. The skill refuses to write a finding with no evidence pointer.

## Hard rules

- **Never auto-fix anything.** This skill detects only. Fixes are the `/vegastack-fix` skill's responsibility.
- **Never push, tag, publish, or open PRs.** Issues only (and only in standalone mode).
- **Never delete or move existing audit reports** under `audits/`. New runs append.
- **Never write secrets** to disk or to GitHub. All output passes through the redaction step.
- **Never mark a finding `verified: completed`.** That status is set only by `/vegastack-fix` after its TDD loop passes.

## References (load on demand)

- `references/categories.md` — the 11 categories: per-category checklists, commands, pass criteria.
- `references/anti-bluff.md` — evidence requirements + secret redaction patterns.
- `references/gh-issue-flow.md` — dedup logic, native issue types, label scheme, tracking-issue template.
- `references/report-format.md` — exact filename rules, table schema, header schema, status vocabulary.

## Quick start

```
# Full audit, current branch, create GH issues
/vegastack-audit

# Only changed files + blast radius, all categories, GH issues
/vegastack-audit scope=changed

# Security + secrets only, full repo
/vegastack-audit scope=full category=security,secrets

# Ephemeral (called by /ship — no GH issues)
/vegastack-audit mode=ephemeral
```
