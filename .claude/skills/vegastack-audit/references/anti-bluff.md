# Anti-Bluff: Evidence Requirements & Redaction

This skill must never claim a finding without proof, and never write a secret to disk or to GitHub.

## Evidence rules (audit-time)

Every finding row in the report must carry **at least one** of:

1. **File pointer** — `path/to/file.ts:LINE` that the auditor can click and confirm.
2. **Command output** — the exact command and its (redacted) output, captured inline in the category section.
3. **External reference** — a CVE, advisory URL, RFC, or doc link the finding depends on.

Findings without evidence are **dropped**, not weakened. The skill must not write a finding it cannot back up.

## Severity-evidence map

| Sev | Min evidence |
|---|---|
| Critical | File pointer + reproducer command + external reference |
| High | File pointer + reproducer command |
| Medium | File pointer **or** command output |
| Low | File pointer or pattern match excerpt |
| Info | Observation note acceptable |

## Subagent contract

When the audit skill spawns subagents (parallel `code-review` slices, etc.), each must return findings as structured blocks:

```
- id: <stable-hash>
  sev: critical|high|medium|low|info
  category: <one of the 11>
  location: <file:line OR n/a>
  title: <≤80 chars, imperative>
  evidence: <multi-line, redacted>
  blast_hint: <files/symbols likely affected>
  fix_hint: <one-paragraph suggestion>
  test_hint: <name of test file/case that should exist>
```

The aggregator drops blocks that fail the evidence rule before computing the table.

## Secret redaction

Run every report body and every GitHub-bound payload through this redactor before persisting/posting.

### Patterns to redact

1. **gitleaks rules** — invoke gitleaks against the rendered text and replace matches with `<REDACTED:rule-id>`.
2. **Token shapes** (regex):
   - `ghp_[A-Za-z0-9]{36,}`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*` → GitHub tokens
   - `xox[baprs]-[A-Za-z0-9-]{10,}` → Slack
   - `AKIA[0-9A-Z]{16}` → AWS access key id
   - `(?i)aws_secret[_-]?access[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}` → AWS secret
   - `eyJ[A-Za-z0-9_=-]+\.eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]*` → JWT
   - `-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----` → private keys
   - `[A-Za-z0-9_-]{40,}\.apps\.googleusercontent\.com` → Google OAuth
   - `npm_[A-Za-z0-9]{36}` → npm token
3. **Path normalization** — replace `$HOME` and absolute home paths with `~`.
4. **Env-var values** when names match `(?i)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTH)`.

### Redaction sentinel

Replace with `<REDACTED:rule-id>` so reviewers know something was redacted but not what. Counts go in the report header as `Redactions: <n>`.

### Verification

After write, re-run gitleaks against the produced report file. If any rule fires → abort, do not commit, surface to user with file path. (The audit run is then incomplete; user must investigate.)

## Audit-run integrity

The skill records, in the report header:

- branch + commit SHA
- working-tree dirty/clean
- list of dirty files (paths only, no contents)
- redaction count
- duration per category

This metadata is the audit's tamper-resistance baseline. The fix skill verifies a finding's report row hasn't been edited out-of-band by hashing the row at fix-start vs fix-end.
