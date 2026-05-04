# Changelog

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
