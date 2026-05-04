# Changelog

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

- Moved project state to `.vegastack/project.json` and `.vegastack/vegastack-lock.json`.
- Replaced archive-era bundle language with VegaStack Registry terminology.
- Kept Terraform provider discovery behind `vegastack ask --entry terraform --tf-provider <provider>`.
- Updated public README install guidance so stable installs use `npm i -g @vegastack/cli` and prereleases use `@next`.

### Removed

- Removed removed shortcut command surfaces and stale bundle-era code paths.
- Removed stale internal planning/status docs that confused agent search.
