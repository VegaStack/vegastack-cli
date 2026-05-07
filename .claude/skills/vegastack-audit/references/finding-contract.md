# Finding-Emission Contract

Every subagent spawned by `/vegastack-audit` must emit findings using this exact
format. Format compliance is enforced mechanically by the post-audit
validation step (see `_validate.py` invocation in `SKILL.md` step 7a).

## Why this is mandatory

The first full audit run (2026-05-07) had **2 false positives in 8 fix-attempts (25%)** because subagents either:

- Hallucinated the cited line content without re-reading the file (issue #15: claimed `scan.ts:110` references undefined `ok`; actual line was `return payload.ok ? 0 : 1;`).
- Named the wrong file for the concern (issue #38: claimed WSL detection missing in `host-detect.ts`; that file is for agent-app detection, not OS).

Both would have been caught at audit time if subagents had been required to echo the cited line back into the evidence block. A reader (or a validator script) can then spot the mismatch without opening the file.

## The format

Every finding is a Markdown block with this exact structure. Field order is fixed:

```markdown
### F-<NNN> — <title (≤80 chars, imperative, action-oriented)>
- **Severity:** critical | high | medium | low | info
- **Category:** <one of the 11 from categories.md, or "code-review/<slice>" for code-review slices>
- **Location:** `<path/to/file.ts:LINE>` (or `<path>` for whole-file findings, or `n/a` for command-output-only)
- **Cited line:** `<verbatim content of the line at <file:LINE>, leading whitespace preserved, single-line; n/a for whole-file or command-only findings>`
- **Evidence:**
  ```
  <command output OR multi-line file excerpt — redacted of any tokens/secrets>
  ```
- **Suggested fix:** <one paragraph, concrete>
- **Suggested test:** <test file/case that should exist, or "n/a" with reason>
```

### Hard rules

1. **One H3 per finding.** Subagents must NOT use H4 headers like `### Renderer parity matrix` to group findings — each emit is its own `### F-<NNN>` block.
2. **Severity literal.** Only the five literals on a line by itself: `critical`, `high`, `medium`, `low`, `info`. No bracket-style `[high]`. No qualifiers like `Medium (hygiene gap)`. The reason can go in evidence/suggested fix.
3. **Cited line is mandatory** when Location names a file:LINE. Skip only when the finding is whole-file or command-output-only (and explicitly say `n/a`).
4. **Cited line must be verbatim.** Read the file at finding-emit time. Copy the line exactly. Preserve indentation. If the line is wrapped in the source (>120 chars), include the full content.
5. **Evidence must contain at least one of:**
   - A command and its (redacted) output
   - A file excerpt of ≥3 lines around the cited line
   - An external reference (CVE, advisory, RFC)
6. **No findings without evidence.** If a check passes, say so in the section's `## Summary`. Do not emit findings to "show work."
7. **F-<NNN> numbering** starts at F-001 within each section file. The aggregator renumbers globally.
8. **No emoji**, no bold/italic in titles. Plain text + backticks for code identifiers.

## Self-verification step (subagent must run before submitting)

Before writing the section file, the subagent must:

```bash
# For each finding with a file:LINE Location:
for finding in findings:
    actual = read_line(finding.location)  # exact line content
    if normalize(actual) != normalize(finding.cited_line):
        DROP THE FINDING and log: "self-verify failed: <id> — actual='<actual>' echoed='<echoed>'"
```

A finding that fails self-verify is **dropped**, not weakened. The subagent's return summary must report the drop count: `"Self-verify drops: <n>"`.

## Post-audit mechanical validation

After all subagents complete and before the aggregator builds the master table, the audit skill runs `_validate.py` against `audits/.tmp-<runid>/*.md`:

```python
# For each finding in every section file:
#   - parse Location
#   - parse Cited line
#   - re-read the actual file:LINE
#   - compare normalized strings
# Output:
#   - validated/N findings pass
#   - failed-validation findings get tagged "validation-pending" and excluded from issue creation
#   - report header gets a "Validation: X/Y findings verified" line
```

A finding that fails post-audit validation is excluded from GitHub issue creation. It still appears in the local report, marked `Validated: ❌` with the actual line content shown for the reader to triage.

## Examples

### ✅ Compliant

```markdown
### F-001 — `vegastack scan` writes user-supplied --output anywhere with no containment
- **Severity:** high
- **Category:** code-review/cli
- **Location:** `src/commands/scan.ts:107`
- **Cited line:** `    if (opts.output) fs.writeFileSync(opts.output, \`${JSON.stringify(outputPayload, null, 2)}\n\`);`
- **Evidence:**
  ```ts
  // src/commands/scan.ts lines 105-110
  const outputPayload = opts.format === "sarif" ? toSarif(payload.findings) : payload;
  if (opts.output) fs.writeFileSync(opts.output, `${JSON.stringify(outputPayload, null, 2)}\n`);
  if (opts.format === "json" || opts.format === "sarif") log.json(outputPayload);
  else printTextReport(payload);
  return payload.ok ? 0 : 1;
  ```
  No `path.resolve` + safe-root containment check. `vegastack scan --output /etc/passwd` would attempt to overwrite.
- **Suggested fix:** Resolve the path, assert it stays within `process.cwd()` or an allowlisted root, write atomically (temp + rename), set 0644 permissions.
- **Suggested test:** Add `tests/commands/scan-output-traversal.test.ts` that asserts `vegastack scan --output ../escape.json` is rejected with a clear error.
```

### ❌ Non-compliant (would be dropped/flagged)

```markdown
### F-D03 [high] tier1/tier2 Promise.all is fake parallelism
File: src/lib/discover/index.ts:444-455
The Promise.all call returns synchronously...
```

Problems:
1. Bracket-style severity `[high]` instead of `**Severity:** high` line.
2. `File:` field instead of `**Location:**`.
3. No `**Cited line:**` echo.
4. Multi-line range `:444-455` instead of single line — pick the single most-load-bearing line.
5. Missing structured fields (Suggested fix, Suggested test).

### ❌ False positive that the contract would have caught

The #15 finding from the 2026-05-07 audit:

```markdown
### F-001 — runScan references undefined ok instead of payload.ok
- **Severity:** critical
- **Category:** code-review/scan
- **Location:** `src/commands/scan.ts:110`
- **Cited line:** `    return ok ? 0 : 1;`     ← THIS IS WRONG, ACTUAL LINE IS `return payload.ok ? 0 : 1;`
```

If this finding had carried the actual line content, the post-audit validator would have re-read `src/commands/scan.ts:110`, found `return payload.ok ? 0 : 1;`, compared it to the echoed `return ok ? 0 : 1;`, found a mismatch, and dropped the finding before any GitHub issue was created.

The subagent that emitted this finding skipped the re-read step. The contract makes that skip impossible — there's no way to fill the **Cited line** field correctly without reading the line.

## Validator script (run by SKILL.md step 7a)

The skill ships `_validate.py` (loaded inline by the audit skill — exact content in `SKILL.md` §validation). High level:

```python
def validate_finding(finding: Finding, repo_root: str) -> ValidationResult:
    if finding.location in (None, "n/a"):
        return ValidationResult.SKIPPED  # whole-file or command-only
    if not finding.cited_line:
        return ValidationResult.MISSING_CITATION
    actual = read_line(repo_root, finding.location)
    if normalize(actual) == normalize(finding.cited_line):
        return ValidationResult.VERIFIED
    return ValidationResult.MISMATCH
```

A `MISMATCH` result is fatal for issue creation but not for the report. The report includes the mismatch with both the echoed and actual line, so a reader can decide whether the finding is real (subagent typo) or hallucinated (drop).
