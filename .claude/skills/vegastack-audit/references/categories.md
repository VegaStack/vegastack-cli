# Audit Categories

Eleven categories. Each becomes an H2 section in the audit report and an
`area:<category>` label on GitHub issues.

For each category: **what it covers**, **commands**, **pass criteria**.
A finding is recorded whenever a check fails or yields a concern; record the
exact file:line or command output as evidence.

## Contents

1. [repo-hygiene](#1-repo-hygiene) — license, README, package metadata, tarball
2. [supply-chain](#2-supply-chain) — vulns, licenses, lockfile, postinstall, provenance
3. [secrets](#3-secrets) — gitleaks on tree + history + audit outputs
4. [security](#4-security) — endpoints, subprocesses, traversal, archive safety, sigstore
5. [code-quality](#5-code-quality) — typecheck, lint, dead code, duplication, complexity
6. [code-review](#6-code-review) — file-by-file deep review across 10 slices
7. [test-coverage](#7-test-coverage) — vitest thresholds, flake, missing scenarios
8. [cross-platform](#8-cross-platform) — macOS/Linux glibc+musl/Win10/11/WSL2/Workers
9. [performance](#9-performance) — startup, hot paths, memory, lazy imports
10. [docs-and-ux](#10-docs-and-ux) — help text, error messages, exit codes, manifests
11. [release-readiness](#11-release-readiness) — CI, provenance, branch protection, 2FA
12. [regression-prevention](#12-regression-prevention) — architectural pins for patterns previously fixed

Plus the [severity rubric](#severity-rubric) at the end.

---

## 1. repo-hygiene

**Covers:** license, README accuracy, stray files, `npm pack` output, `.gitignore`/`.npmignore` parity, package.json metadata.

| Check | Command | Pass |
|---|---|---|
| License headers consistent | `rg -L "SPDX-License-Identifier" src/ apps/` | All have or none have (consistency). |
| OSS files present | inspect `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | All present, links live. |
| README runnable | walk every `vegastack <cmd>` example in README | Each command exists, flags valid. |
| Changeset state | `npx changeset status` | Clean; no orphan changesets. |
| Tarball | `npm pack --dry-run \| sort` | No stray `.md` outside whitelist; no fixtures, no `.env`, no internal notes. |
| .gitignore vs .npmignore vs `files` | manual diff | Coherent. |
| Repo metadata | inspect `package.json` `homepage`/`bugs`/`repository`/`keywords` | All resolve. |

---

## 2. supply-chain

**Covers:** vulnerabilities, license compatibility, version recency, lockfile integrity, postinstall safety, npm provenance readiness. **Run serially** (network).

| Check | Command | Pass |
|---|---|---|
| Vuln scan (prod) | `npm audit --omit=dev --audit-level=low` | Zero High/Critical. |
| Vuln scan (dev) | `npm audit --audit-level=high` | Zero High/Critical. |
| Apps audit | `(cd apps/mcp && npm audit) && (cd apps/dashboard && npm audit)` | Same. |
| OSV scan | `osv-scanner --lockfile=package-lock.json` (and apps) | No unfixed advisories. |
| Latest versions vs May 2026 | `npm view <pkg> version` per dep + WebSearch advisory | Within one minor of latest, or pinned with reason. |
| License compatibility | `npx license-checker --production --summary` | All MIT/BSD/ISC/Apache-2.0 compatible. |
| Postinstall surface | read `npm/install.js` | No silent `\|\| true` swallowing real errors; honors `npm_config_ignore_scripts`; works offline; respects `HTTP_PROXY`. |
| Lockfile integrity | `npm ci --ignore-scripts` from clean | Reproducible. |
| Sigstore use | trace `sigstore` import sites | Verifies what it claims to verify; no silent degradation. |
| Provenance readiness | inspect `.github/workflows/*` for `npm publish --provenance` + Trusted Publisher | Configured per [npm Trusted Publishers docs](https://docs.npmjs.com/trusted-publishers/). |

---

## 3. secrets

**Covers:** secrets in working tree + git history + audit outputs.

| Check | Command | Pass |
|---|---|---|
| Working tree | `gitleaks detect --source . --redact --no-banner` | Zero findings. |
| Git history | `gitleaks detect --source . --log-opts="--all"` | Zero findings; if any, follow rotation playbook in SECURITY.md. |
| Audit outputs | re-run gitleaks on `audits/` | Zero findings. |
| .env / .envrc | `find . -name ".env*" -not -path "*/node_modules/*"` | Only `.env.example` / `.dev.vars.example`. |

If a secret is found in history: file as **Critical**. The fix is rotation + history rewrite, not just detection cleanup.

---

## 4. security

**Covers:** STRIDE walk, network endpoints, subprocess inventory, path traversal, archive zip-slip, signature verification, telemetry policy, Cloudflare Worker auth.

| Check | Method | Pass |
|---|---|---|
| Network endpoints inventory | `rg "https?://" src apps` | Every endpoint allowlisted, documented, fails closed. |
| Subprocess inventory | `rg "spawn\|exec\|execFile" src` | All array args; PATH validated; no shell metacharacters in user input. |
| Path traversal | for each `path.join(userInput,...)` find containment check | All resolve + contain. |
| Archive extraction | review tar/zip loaders against `tests/fixtures/safe-tar/traversal.tar.gz` | Defends against zip-slip + symlinks + device files. |
| Signature verification | trace `sigstore` + any GPG/cosign | Verifies before trusting; no silent failure. |
| File writes outside cwd | review `paths.ts`, `fs-utils.ts` | Confined to `~/.vegastack/` or project; symlinks resolved; sensitive files 0600. |
| Update channel | review `update-check.ts` | No auto-execute; respects `--no-update-check`. |
| Worker security | review `apps/mcp/src/**` | No `eval`; bounded R2/D1; auth on every tool call. |
| Telemetry | search analytics keywords | None, or opt-in with README notice + env-var opt-out. |

---

## 5. code-quality

**Covers:** typecheck strictness, lint, format, dead code, duplication, complexity, banned patterns.

| Check | Command | Pass |
|---|---|---|
| Typecheck | `npm run typecheck` | Zero errors. |
| `tsconfig` rigor | inspect `tsconfig.json` | `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. |
| Lint | `npm run lint` | Zero errors and zero warnings (or each waived). |
| Format | `npm run format:check` | Clean. |
| Dead code | `npx knip` | Zero unused exports/files outside known entry points. |
| Duplication | `npx jscpd src apps/*/src --min-lines 8` | Document any block over threshold. |
| Complexity | `npx eslint --rule '{"complexity":["error",10]}' src` | Identify hotspots; refactor if >15. |
| Build output | inspect `dist/` post-build | No leaked test files, no absolute dev paths in source maps, ESM-correct. |
| Banned patterns | `rg "console\.log\|TODO\|FIXME\|XXX\|@ts-ignore\|: any\b" src` | Each occurrence justified. |

---

## 6. code-review

**Covers:** file-by-file deep review across slices. Run as 10 parallel `Agent` calls (Explore subagent type, Opus model).

**Slices:**

1. `cli` — `src/cli.ts` + `src/commands/*.ts`
2. `agents` — `src/agents/*.ts`
3. `discover` — `src/lib/discover/**`
4. `scan` — `src/lib/scan/**` + `src/lib/scan-tools.ts` + `src/lib/gitleaks.ts` + `src/lib/ripgrep.ts`
5. `registry` — `src/lib/registry*.ts` + `src/lib/managed-tools*.ts` + `src/lib/cloudflared.ts`
6. `lib-core` — remaining `src/lib/*.ts`
7. `mcp` — `apps/mcp/**`
8. `dashboard` — `apps/dashboard/**`
9. `scripts` — `scripts/**`
10. `npm-shim` — `npm/install.js` + `npm/run.js`

**Per-file checklist** (each subagent applies to every file in its slice):

- Inputs validated at boundary (path, URL, env, argv).
- Every `await` has error handling; no unhandled-rejection risk.
- No path traversal: `path.join(userInput,...)` followed by containment check.
- No shell injection: `spawn` array args, never `exec` with concat.
- No symlink/zipslip in archive extraction.
- Cross-platform paths (no hardcoded `/`); EOL-agnostic file reads.
- Windows long-path / case-insensitive FS handled.
- SIGINT cleanup: no orphan child processes, no leftover lockfiles.
- Network calls: timeout + retry-with-jitter + offline fallback.
- Errors carry actionable next-step messages.
- Help text accurate; examples runnable.
- Tests cover happy + ≥1 failure + ≥1 edge case.

Each subagent returns: list of findings with `file:line`, severity, title, suggested fix, missing-test list.

---

## 7. test-coverage

**Covers:** suite health, coverage thresholds, flake, missing scenarios.

| Check | Command | Pass |
|---|---|---|
| All tests pass | `npm test` | Green. |
| Coverage | `npx vitest run --coverage` | ≥85% lines / ≥80% branches on `src/lib/`; ≥75% overall. |
| Apps tests | `(cd apps/mcp && npm test) && (cd apps/dashboard && npm test)` | Green. |
| Flake | run suite 3× | No nondeterministic failures. |
| Missing scenarios | scan code-review subagent reports | One finding per gap. |

If coverage < threshold on a file → finding with severity Medium and a list of suggested tests. **The fix skill is allowed to add tests** (test creation itself is gated by TDD red-before-green).

---

## 8. cross-platform

**Covers:** OS/Node matrix smoke. Run via local Docker/VM where possible; otherwise document as "not yet validated on <env>".

Targets:

| OS / Env | Node | Notes |
|---|---|---|
| macOS arm64 | 20, 22 | Local default. |
| macOS x64 | 20 | Rosetta + native paths. |
| Ubuntu 22.04 (glibc) | 18, 20, 22 | Baseline. |
| Alpine 3.20 (musl) | 20 | Native bins; postinstall must degrade. |
| Debian 12 | 20 | sigstore + corporate CA. |
| Windows 11 (cmd, PS7, Git Bash) | 20 | Path sep, CRLF, long paths, `npm/run.js` shim. |
| Windows 10 | 20 | Same. |
| WSL2 (Ubuntu) | 20 | `\\wsl$` edge cases when invoked from Windows. |
| Cloudflare Workers (`wrangler dev`) | n/a | `apps/mcp` + `apps/dashboard` cold start; no Node API leaks. |

**Smoke per target:**
```
npm install -g @vegastack/cli
vegastack --version && vegastack --help && vegastack doctor
vegastack init --dry-run && vegastack search terraform aws vpc && vegastack scan
```

---

## 9. performance

**Covers:** cold start, hot paths, memory, lazy imports.

| Check | Command | Pass |
|---|---|---|
| Cold start | `hyperfine 'vegastack --help'` | <150ms M-series, <400ms Linux CI. |
| Search query | `hyperfine 'vegastack search aws s3 module'` | <500ms warm, <1.5s cold. |
| Discover hot path | bench against real registry size | Linear; no quadratic surprises. |
| Memory | `/usr/bin/time -v` (or gtime) | <150 MB RSS typical. |
| Lazy imports | audit top-level imports in `cli.ts` | Heavy modules (sigstore, child_process workflows) lazy per command. |

---

## 10. docs-and-ux

**Covers:** every `--help` accurate, error messages actionable, exit-code mapping, no stale references, manifest validity.

| Check | Method | Pass |
|---|---|---|
| Per-command help | run `vegastack <cmd> --help` for every command | Consistent shape; examples copy-pasteable. |
| Error messages | review every `throw` in `src/lib/errors.ts` and call sites | Each: cause + suggested fix + exit code. |
| Exit codes | document map; verify via tests | 0 success, 1 generic, 2 usage, 64+ specific. |
| Stale refs | `rg "secrets\|terraform-discover" src skills docs README.md` after refactor | No mention of removed commands. |
| Manifest validity | schema-check `.claude-plugin/`, `gemini-extension.json`, `cursor-rule.mdc` | All validate. |
| Skill cross-refs | every `references/*.md` filename mentioned in SKILL.md exists | Zero broken refs. |
| Onboarding | fresh-VM walkthrough of README | <10 min, no surprises. |

---

## 12. regression-prevention

**Covers:** architectural-test pins for patterns previously fixed. Each pattern documents a class of bug that should never recur once fixed; a corresponding `tests/architecture/*.test.ts` file is the regression bar. Full catalog in `references/regression-pins.md`.

| Check | Method | Pass |
|---|---|---|
| Pattern catalog | read `references/regression-pins.md` | Every documented pattern has its architectural test in `tests/architecture/`. Missing pin = Low finding. |
| ESLint complexity rule | `npx eslint --rule '{"complexity":["error",15]}' src` | Exit 0. |
| Per-file complexity pin tests | grep `tests/**/*-complexity.test.ts` | Hot-path functions have explicit pins (e.g. `runDoctor`, `tier1`, `discover`, `discoverGenericPacks`). |
| Architectural test suite present | `ls tests/architecture/` | Directory exists with the expected pin tests. |
| Audit-skill validator portability | `tests/architecture/no-absolute-paths-in-fixtures.test.ts` | Baseline JSONs use repo-relative paths only. |

Findings here are typically **Low** — they don't block release but compound over time. They become noticeable when a "trivial" fix re-introduces an old class of bug because nothing pinned it.

When `/vegastack-fix` lands a fix, it should add the corresponding architectural pin in the same commit. The next audit's `regression-prevention` category catches any drift.

## 11. release-readiness

**Covers:** CI/release pipeline, provenance, branch protection, 2FA, Dependabot.

| Check | Method | Pass |
|---|---|---|
| Release workflow | read `.github/workflows/*` | Tagged build from clean checkout, full matrix tests, `npm publish --provenance` via Trusted Publisher. |
| Provenance | check published version on npmjs.com | Provenance badge present. |
| 2FA | confirm with maintainer | Enabled. |
| Branch protection | GitHub settings | `main` requires PR + review + green CI. |
| Dependabot/Renovate | check config | Enabled, weekly. |
| CodeQL / Scorecard | GH Security tab | Enabled. |
| Workflows minimal perms | inspect `permissions:` blocks | Least privilege. |

---

## Severity rubric

- **Critical** — security vulnerability, data loss risk, leaked secret, RCE, supply-chain compromise. Blocks release.
- **High** — correctness bug in shipped behavior, missing signature verification, broken cross-platform support, OSS-launch blocker.
- **Medium** — quality issue, missing test for non-trivial logic, doc inaccuracy users will hit, suboptimal error UX.
- **Low** — polish, nit, perf micro-optimization, internal naming, stale comment.
- **Info** — observation worth recording but not actionable on its own.

Severity is set by the auditing subagent and confirmed in the aggregation step.
Disagreements are resolved by re-reading the per-file checklist and the
finding's blast radius.
