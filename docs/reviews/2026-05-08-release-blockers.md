# 2026-05-08 — release blockers (pre-`0.1.13`)

Three findings that should land before the next prerelease tag.

## F1 — `gemini-extension.json` version drift

- **Where:** `gemini-extension.json:3`
- **Observed:** `"version": "0.1.13-next.0"`
- **Expected:** matches `package.json:3` → `0.1.13-next.2`
- **Why it matters:** ships in the npm tarball (listed in `package.json:files`). Agents installing the extension see a stale version string, which breaks any "is my Gemini extension current?" check.
- **Root cause:** `.changeset/pre.json:initialVersions` is `0.1.13-next.0` (matches the original prerelease channel open) and there is no script that resyncs `gemini-extension.json` on `changeset version`.
- **Fix:** sync the value, and add `scripts/sync-version.mjs` invoked from a `package.json:scripts.version` (changesets) hook so future bumps propagate.

## F2 — Node engine mismatch in `SKILL.md`

- **Where:** `skills/vegastack/SKILL.md:26`
- **Observed:** "Requires Node >=18"
- **Expected:** matches `package.json:engines.node` → `>=20.0.0`; `.nvmrc` → `20`
- **Why it matters:** users on Node 18 will install the skill and hit a runtime crash with no breadcrumb. The skill is the first thing a Claude Code user reads.
- **Fix:** rewrite the line to "Requires Node >=20" and grep the rest of `skills/`, `docs/`, `README.md`, `GETTING_STARTED.md` (post-rename) for any other `>=18`.

## F3 — `## Unreleased` placement in `CHANGELOG.md`

- **Where:** `CHANGELOG.md:45`
- **Observed:** Unreleased section sits between `0.1.13-next.1` (line 13) and `0.1.13-next.0` (line 51).
- **Expected:** Keep-a-Changelog convention places Unreleased at the very top.
- **Why it matters:** readers scanning the changelog assume top-down chronology; a mid-file Unreleased makes them miss what's shipping next.
- **Fix:** check whether the bullets ("Replaced project-local JSON state and lock files with committed `.vegastack/vegastack.yml`", "Moved shared agent instructions to `~/.vegastack/instructions/`") already shipped in `0.1.13-next.2`. If yes — fold them in and delete the section. If no — move the section above `## 0.1.13-next.2`.

## Follow-ups (post-fix)

- **F32:** run `/skill-creator` skill-eval on `skills/vegastack/SKILL.md` once Node line + host enumeration are correct, to re-score description-trigger accuracy.
- **F33:** run `/vegastack-audit` to confirm doc/file moves don't regress production readiness.
