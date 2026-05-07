# Audit Reports

This folder stores production-readiness audit reports for `@vegastack/cli`.
Reports are written by the [`/vegastack-audit`](../.claude/skills/vegastack-audit/SKILL.md) skill
and updated by the [`/vegastack-fix`](../.claude/skills/vegastack-fix/SKILL.md) skill.

## File naming

```
audit-<EPOCH>-<ISO>-<SCOPE>.md

EPOCH = Unix epoch seconds at run start (10 digits, sortable prefix)
ISO   = UTC timestamp YYYY-MM-DDTHH-MM-SSZ (colon-free for FS portability)
SCOPE = full | changed | <hyphen-joined category names>
```

Examples:
- `audit-1746587415-2026-05-07T03-13-35Z-full.md`
- `audit-1746601234-2026-05-07T07-00-34Z-changed.md`
- `audit-1746609999-2026-05-07T09-26-39Z-security-secrets.md`

The epoch prefix means `ls audits/` (and the GitHub repo file list) sorts
chronologically without any extra tooling.

## Source of truth

GitHub Issues are the source of truth for actionable findings. The local
report is the **dashboard/index** — it links to the GitHub issue per finding
in its `Issue` column.

| Mode | Trigger | GitHub issues | Local report |
|---|---|---|---|
| Standalone | `/vegastack-audit` invoked directly | Created (deduped) | Committed |
| Ephemeral | Chained from `/ship` | **Not created** | Committed |

## Report contents

Every report contains:

1. **Header** — branch, commit SHA, tree state, scope, mode, tracking issue link, duration, redaction count, tooling versions.
2. **Summary** — finding counts by severity.
3. **Findings table** — one row per finding: `ID | Sev | Category | Location | Title | Issue | Status | Verified`.
4. **Per-category sections** — one H2 per category that ran, with commands run + narrative observations.
5. **Run integrity footer** — SHA-256 of the report (post-redaction), subagent durations.
6. **Verification log** (appended by `/vegastack-fix`) — TDD-verified fix evidence per closed finding.

See [`.claude/skills/vegastack-audit/references/report-format.md`](../.claude/skills/vegastack-audit/references/report-format.md) for the exact schema.

## Secret redaction

Every report passes through gitleaks-style redaction before being written to
disk **and** before being posted to GitHub. Patterns and verification rules
are documented in [`.claude/skills/vegastack-audit/references/anti-bluff.md`](../.claude/skills/vegastack-audit/references/anti-bluff.md).

If a redacted report still trips gitleaks on a post-write scan, the run aborts
and the user is asked to investigate before any commit or push.

## Why audits are committed

Committing reports preserves audit history alongside the code, so a contributor
reviewing the repo can see what was checked, when, and by whom — without
requiring GitHub access. Releases never trigger on docs-only changes (the
release workflow respects changesets), so audit commits don't bump versions.

## Status & verified vocabulary

- **Status** mirrors GitHub state: `open`, `closed` (reason: completed), `closed-wontfix` (reason: not planned). In ephemeral mode where there's no issue: `local` until fixed, `fixed` after.
- **Verified**: `pending` (TDD loop not yet run), `completed` (anti-bluff loop passed; evidence committed), `n/a` (for `closed-wontfix` and Info-level findings).

Only `/vegastack-fix` can set `Verified: completed`.

## Related skills

- [`/vegastack-audit`](../.claude/skills/vegastack-audit/SKILL.md) — runs audits, writes reports, opens GitHub issues.
- [`/vegastack-fix`](../.claude/skills/vegastack-fix/SKILL.md) — TDD-verifies fixes, posts evidence, closes issues.
- [`/ship`](../.claude/skills/ship/SKILL.md) — runs the chain (audit → fix → release) under the maintainer release gate.
