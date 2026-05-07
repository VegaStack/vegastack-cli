# GitHub Issue Flow

Issues are the audit's source of truth. Local report = dashboard/index.

## Severity gate

| Severity | Action |
|---|---|
| Critical | Individual issue, immediately, mention `@maintainer` in body. |
| High | Individual issue. |
| Medium | Individual issue. |
| Low | Aggregate into one rollup issue per audit run titled `Audit <ISO> — polish`. |
| Info | Local report only, no GitHub issue. |

## Native issue types

Discover org issue types once per run:

```bash
gh api graphql -H "GraphQL-Features: issue_types" -f query='
  query { organization(login: "vegastack") {
    issueTypes(first: 20) { nodes { id name description } }
  } }
'
```

Map by category:

| Category | Preferred type |
|---|---|
| security, secrets, supply-chain | `Bug` (high-severity treated as such) |
| code-review, code-quality, performance | `Bug` (when Sev≥Med), `Task` (when Sev=Low) |
| repo-hygiene, docs-and-ux, cross-platform, release-readiness, test-coverage | `Task` |

Set type via `updateIssue` GraphQL mutation with `issueTypeId`. If the org has no issue types configured, fall back to label `audit` only.

## Labels (minimal)

- `audit` — created by audit skill (filterable distinguisher)
- `severity:critical|high|medium|low`
- `area:repo-hygiene|supply-chain|secrets|security|code-quality|code-review|test-coverage|cross-platform|performance|docs-and-ux|release-readiness`

**No status labels.** GitHub's open/closed/closed-not-planned state is authoritative.

## Dedup

Before creating any issue:

1. Build a normalized key: `sha256(category + file_path + canonical_title)`.
   - Canonical title strips line numbers, hashes, dates, version strings, ANSI codes.
2. Search open issues with that key as a hidden marker:

   ```bash
   gh issue list --label audit --state open --search "in:body \"audit-key:$KEY\"" --json number,title,url
   ```

3. If a match is found:
   - **Do not create** a new issue.
   - Comment on the existing issue: `Re-detected in audit \`<filename>\` (<run-tracking-issue-link>).`
   - In the new run's report, link to the existing issue's URL.
4. Otherwise, create a new issue and embed `<!-- audit-key:$KEY -->` in the body.

## Tracking issue (one per run)

Open at the start of the run (in standalone mode only):

```
Title: Audit YYYY-MM-DDTHH-MM-SSZ — <scope>
Labels: audit
Type: Task
Body:
  Audit run report: audits/audit-<epoch>-<iso>-<scope>.md
  Branch: <branch>@<sha>
  Started: <iso>
  Scope: <full|changed|category=...>

  ## Findings checklist
  - [ ] #<n> — <title>
  - [ ] #<n> — <title>
  ...

  Closes when all child issues are closed.
```

Children link back to tracking with `Tracking: #<n>` line in their body.

## Body template (per finding)

```
<!-- audit-key:$KEY -->
**Severity:** high
**Category:** security
**Detected by:** audit run `audits/audit-1746587415-2026-05-07T03-13-35Z-full.md`
**Tracking:** #142
**Branch:** develop @ <sha>

## Where
`src/lib/managed-tools.ts:142`

## What
<one-paragraph description, redacted>

## Evidence
<command + redacted output, OR link to file>

## Suggested fix
<one paragraph from subagent's fix_hint>

## Suggested test
<test file/case from subagent's test_hint>

## Blast radius (initial guess)
<files/symbols list>

---
This issue will be closed automatically by `/vegastack-fix` once the
TDD-verified fix lands. Verification evidence will be appended as a comment
before closure.
```

## Auto-close (fix skill responsibility)

The fix skill closes via `gh issue close <n> --reason completed --comment "<evidence-block>"`. Wontfix is human-driven (`gh issue close <n> --reason "not planned"`).

## Rate-limit etiquette

- Batch reads via `gh api graphql` where possible.
- Always include the dedup search before any create call.
- Apply `audit` label first; let label-driven workflows (if any) handle downstream notifications instead of @-mentioning broadly.

## Ephemeral mode

When `mode=ephemeral` (chained from `/ship`):
- **Skip every step in this file.**
- Do not query GitHub, do not create issues, do not need a network connection.
- The local report still lists findings; the chained fix skill reads them by ID directly from the file.
