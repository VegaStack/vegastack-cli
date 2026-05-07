# Audit Report Format

One file per run. Lives at `audits/audit-<epoch>-<iso>-<scope>.md`. Committed.

## Filename rules

```
audits/audit-<EPOCH>-<ISO>-<SCOPE>.md

EPOCH = `date -u +%s`              (10 digits, sortable prefix)
ISO   = `date -u +%Y-%m-%dT%H-%M-%SZ`   (UTC, colon-free for FS portability)
SCOPE = full | changed | <comma-joined categories with hyphens>
```

Examples:
- `audits/audit-1746587415-2026-05-07T03-13-35Z-full.md`
- `audits/audit-1746601234-2026-05-07T07-00-34Z-changed.md`
- `audits/audit-1746609999-2026-05-07T09-26-39Z-security-secrets.md`

The epoch prefix means `ls audits/` lists chronologically. GitHub's repo file list sorts the same way.

## Header schema

The H1 heading is for humans — use a readable timestamp with colons and a UTC
suffix. The filename and `Run ID` retain the colon-free form for filesystem
portability. Both refer to the same run.

```markdown
# Audit Report — Wed 7 May 2026, 03:13:35 UTC · scope: full
**Run ID:** `audit-<epoch>-<iso>-<scope>`
**Branch:** `<branch>` @ `<short-sha>` ([compare](<repo-url>/commit/<sha>))
**Tree state:** `<clean|dirty (N files)>`
**Scope:** `<full|changed>` · **Categories:** `<list>`
**Mode:** `<standalone|ephemeral>`
**Tracking issue:** [#<n>](<url>) (omitted in ephemeral mode)
**Duration:** `<H:MM:SS>`
**Redactions:** `<count>`
**Tooling:** node `<v>`, npm `<v>`, gitleaks `<v>`, gh `<v>`

## Summary
| Critical | High | Medium | Low | Info |
|---|---|---|---|---|
|  0  |  2  |  7  |  14 |  22 |

## Dirty files (if any)
- `src/foo.ts`
- `src/bar.ts`
```

## Findings table

Top-level table (after summary). One row per finding, ordered by severity desc then category.

```markdown
## Findings
| ID | Sev | Category | Location | Title | Issue | Status | Verified |
|----|-----|----------|----------|-------|-------|--------|----------|
| F-001 | High | security | [src/lib/managed-tools.ts:142](../src/lib/managed-tools.ts#L142) | Missing sig verification on cloudflared download | [#143](https://github.com/vegastack/vegastack-cli/issues/143) | open | pending |
| F-002 | High | code-review/cli | [src/commands/init.ts:88](../src/commands/init.ts#L88) | Path traversal via --project-dir | [#144](https://github.com/vegastack/vegastack-cli/issues/144) | closed | completed |
| F-003 | Medium | docs-and-ux | [README.md:120](../README.md#L120) | Stale `vegastack secrets` reference | [#145](https://github.com/vegastack/vegastack-cli/issues/145) | closed-wontfix | n/a |
| F-004 | Low | test-coverage | `src/lib/discover/intents.ts` | Branch coverage 64% | [rollup #146](https://github.com/vegastack/vegastack-cli/issues/146) | open | pending |
```

## Column vocabulary

- **ID** — `F-NNN`, sequential within the file. Stable for the life of the file.
- **Sev** — `Critical` / `High` / `Medium` / `Low` / `Info`.
- **Category** — one of the 11. Code-review findings carry a `code-review/<slice>` suffix.
- **Location** — `[file:line](relative-link#Lline)` clickable. Use `\`file\`` only when no specific line.
- **Title** — ≤80 chars, imperative, action-oriented.
- **Issue** — `[#N](url)` clickable. `—` if Info-only (no issue). `—` in ephemeral mode.
- **Status** — mirror of GitHub state:
  - `open` (default for new findings)
  - `closed` (closed with reason `completed`)
  - `closed-wontfix` (closed with reason `not planned`)
  - In ephemeral mode where there's no issue: `local` until fixed, then `fixed`.
- **Verified** — TDD-verification status set by `/vegastack-fix`:
  - `pending` — not yet attempted
  - `completed` — anti-bluff loop passed; evidence committed
  - `n/a` — for `closed-wontfix` and `Info`

## Per-category sections

After the table, one H2 per category that ran:

```markdown
## repo-hygiene
**Findings here:** F-003

<commands run, redacted output, narrative observations>

## supply-chain
**Findings here:** (none)

<commands run, narrative>

...
```

If a category had no findings, still include the section to confirm it ran.

## Footer: anti-bluff metadata

```markdown
---
## Run integrity
- Report SHA-256: <hash>            (computed after redaction, before commit)
- Audit-skill version: <skill schema version>
- Subagent count: <n>
- Subagent durations: { code-review: { cli: 4m12s, agents: 2m41s, ... } }
```

The fix skill recomputes the row hash at fix-start and fix-end to detect tampering.

## Updating an existing report (rare)

Reports are append-only after commit. The fix skill **may**:

- Update `Status` and `Verified` columns of a row (these reflect external state).
- Append a `## Verification log` section at the bottom referencing finding IDs and evidence commit SHAs.

The fix skill **must not**:

- Edit a finding's title, severity, location, or evidence text.
- Reorder rows.
- Remove rows (use `closed-wontfix` status instead).

## Cross-run linking

When a finding is re-detected (dedup hit) in a later run, the new run's row in its report links to the **original issue**, not a new one. The new report's narrative section should note: "F-007 → re-detected from `<original-report-filename>` F-002 (#143)."
