# Changelog

## 0.1.13-next.1

### Patch Changes

- Comprehensive audit drainage from the 2026-05-07 production-readiness audit.

  **All 27 individual High issues TDD-verified-fixed**, plus ~94 Medium + Low rollup findings resolved across 4 parallel-fix rounds. 0 audit findings open.

  **Key user-visible improvements:**
  - Cold start `vegastack --help` reduced from ~138 ms → ~80 ms (-42%) via lazy `sigstore` import + lazy command imports in `cli.ts`
  - Cross-platform Windows fixes: `vegastack update` self-upgrade now works on Windows (CVE-2024-27980 mitigation via `spawnCmdSync` helper); managed-tool installer uses JS-native `tar` + `yauzl` extractors instead of host `tar` / `unzip` / `Expand-Archive` (also fixes Alpine/musl)
  - MCP worker (`apps/mcp`) gains token-bucket rate-limit + opt-in bearer-token auth (`REQUIRE_AUTH=true`) + 4 MiB R2 size cap + 5s CDN AbortController
  - Dashboard (`apps/dashboard`) gains CSP/security headers middleware, capped R2 fan-out, KV `v1:` schema-version prefix
  - `vegastack scan --output` now validates path containment + atomic-writes the result (closes arbitrary-file-overwrite vector)
  - `vegastack preview --command` no longer shell-evaluates user-supplied commands by default
  - `VEGASTACK_REGISTRY_URL` requires HTTPS + host allowlist; opt-out warns to stderr instead of silently disabling
  - Sigstore signature verification can no longer be silently disabled — `VEGASTACK_REGISTRY_VERIFY=0` now emits a one-time stderr warning per process

  **Security hardening:**
  - Archive extractors reject symlinks/hardlinks/device-file entries + zip-slip
  - Registry installs now lock-protected (mkdir mutex), atomic-write metadata
  - All `fetch()` calls have AbortController timeouts and streaming size caps
  - Postinstall honors `npm_config_ignore_scripts` defensively
  - `chmod 0600` on sensitive global config files

  **Dependency updates** addressing GHSA advisories: `@anthropic-ai/sdk` → 0.91.1, `hono` → 4.12.18, `ip-address` → 10.2.0, `commander` → 14.0.3.

  **Internal:** GitHub Actions pinned to commit SHAs; new `tests/architecture/` regression-bar suite; tier1/runDoctor/discoverGenericPacks/discover-orchestrator cyclomatic complexity refactored under characterization-test pins (byte-identical output preserved). Test count: 426 → 621 (+45%).

  **Audit-skill upgrades:** `/vegastack-audit` and `/vegastack-fix` skills updated with regression-prevention category, mandatory worktrees + repo-relative paths for parallel subagents, already-fixed verification step, post-merge auto-fix step, and cleanup-verification template. Documented in `.claude/skills/vegastack-{audit,fix}/`.

  Full report: `audits/audit-1778150875-2026-05-07T10-47-55Z-full.md`.

## Unreleased

### Changed

- Replaced project-local JSON state and lock files with committed `.vegastack/vegastack.yml`.
- Moved shared agent instructions to `~/.vegastack/instructions/` and kept project agent files to small managed pointers.

## [0.1.13-next.0] - 2026-05-05

Opens the next develop prerelease channel after stable `0.1.12`.

### Changed

- Bumped develop prerelease metadata to `0.1.13-next.0` after promoting the lowercase GitHub org compatibility patch to stable.

## [0.1.12] - 2026-05-05

Stable patch for the GitHub organization rename from `VegaStack` to `vegastack`.

### Changed

- Updated public GitHub repository links to `github.com/vegastack`.
- Updated package repository, bugs, and homepage metadata to the lowercase GitHub organization.
- Allowed Registry Sigstore verification to trust both the previous `VegaStack` workflow identity and the new `vegastack` workflow identity during the rename transition.

## [0.1.12-next.0] - 2026-05-05

Opens the next develop prerelease channel after stable `0.1.11`.

### Changed

- Bumped develop prerelease metadata to `0.1.12-next.0` so npm `next` can diverge from stable `latest`.

## [0.1.11] - 2026-05-05

Stable release of the Registry-backed VegaStack CLI. This promotes the verified `0.1.11-next.1` build to the production `latest` channel.

### Fixed

- Kept `vegastack init --dry-run --json` machine-readable by avoiding interactive prompts and terminal control sequences.
- Kept `vegastack init --json` non-interactive unless `--yes` or `--dry-run` is supplied.

## [0.1.11-next.1] - 2026-05-05

### Fixed

- Fixed `vegastack init --dry-run --json` so it emits parseable JSON without interactive prompt control sequences on stdout.
- Fixed `vegastack init --json` without `--yes` to return a structured validation error instead of prompting on stdout.

## [0.1.11-next.0] - 2026-05-05

Prerelease of the Registry-backed VegaStack CLI for `develop`.

### Added

- Added Registry-backed `vegastack init`, `vegastack ask`, `vegastack search`, and `vegastack registry update` flows.
- Added signed Registry catalog verification, archive checksum verification, and artifact integrity checks.
- Added managed ripgrep, Gitleaks, and cloudflared installation paths with pinned checksums.
- Added Registry-aware skill renderers for Claude Code, Codex, Cursor, Gemini, Continue, and Aider.
- Added Registry-backed MCP and dashboard wiring for later hosted surfaces.

### Changed

- Moved project state into project-local VegaStack metadata files; this was later superseded by committed `.vegastack/vegastack.yml`.
- Replaced archive-era bundle language with VegaStack Registry terminology.
- Kept Terraform provider discovery behind `vegastack ask --entry terraform --tf-provider <provider>`.
- Updated public README install guidance so stable installs use `npm i -g @vegastack/cli` and prereleases use `@next`.

### Removed

- Removed removed shortcut command surfaces and stale bundle-era code paths.
- Removed stale internal planning/status docs that confused agent search.
