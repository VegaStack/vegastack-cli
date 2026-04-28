# Changelog

All notable changes to `@vegastack/cli` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-04-28

Single, brand-aligned skill surface — and a working Claude Code install path.

### Added

- `.claude-plugin/marketplace.json` so Claude Code 2.1.x can install via `claude plugin marketplace add` + `claude plugin install vegastack-cli@vegastack-cli`. Modern Claude Code only activates plugins registered through a marketplace; the prior symlink-into-`~/.claude/plugins/` approach was visible (`1 plugin` count) but did not load components.

### Changed (BREAKING)

- Skill renamed `terraform-docs` → `vegastack`. Skill dir moved `skills/terraform-docs/` → `skills/vegastack/`. Surfaces as `/vegastack` in Claude Code. Forward-compatible — future knowledge packs (runbooks, devops/cloudops guides) will be dispatched from this same skill body.
- Removed redundant `commands/tf.md` slash command. The skill auto-triggers on Terraform/HCL queries; no slash needed. Use `/vegastack` for explicit invocation.
- Codex skill symlink moved `.agents/skills/terraform-docs/` → `.agents/skills/vegastack/`.

### Fixed

- Hooks file structure: `hooks/hooks.json` now nests events under a top-level `"hooks"` key (`{"hooks": {"SessionStart": [...]}}`), matching what Claude Code's loader expects. The previous flat shape produced `Hook load failed: invalid_type at path "hooks"` and `0 hooks` on reload.

## [0.1.5] - 2026-04-28

Project-wide rename to a single brand: the CLI, plugin, internal symbols, and env vars now all use `vegastack`/`VEGASTACK_` instead of the mix of `vega` (binary), `terraform-providers-kit` (plugin), and `VEGA_*` (env). Terraform was the first knowledge pack; the surface name no longer pre-commits us to it. Also moves the Claude Code plugin layout to the spec-default locations so reload picks up commands, hooks, and the MCP server.

### Changed (BREAKING)

- CLI binary renamed `vega` → `vegastack`. All subcommands move with it: `vegastack tf`, `vegastack doctor`, `vegastack install`, `vegastack update`, `vegastack skills install`, etc. No `vega` shim is shipped.
- Env vars renamed `VEGA_*` → `VEGASTACK_*` (`VEGASTACK_BUNDLE_DIR`, `VEGASTACK_BUNDLE_URL`, `VEGASTACK_FORCE_UNLOCK`, …).
- Claude Code plugin renamed `terraform-providers-kit` → `vegastack-cli`. Install dir moves from `~/.claude/plugins/terraform-providers-kit/` to `~/.claude/plugins/vegastack-cli/`. Re-run `vegastack skills install --agent claude-code --force` after upgrading.
- Cloudflare Worker Durable Object class renamed `VegaMcp` → `VegastackMcp`. Migration `v1` rewritten clean (no deploy had occurred); deployers of pre-rename builds must wipe DO state before deploying.
- Internal TypeScript symbols renamed: `VegaError` → `VegastackError`, `VegaErrorKind`, `VegaErrorJson`, `asVegaError` correspondingly.

### Fixed

- Claude Code plugin commands (`/tf`), hooks, and MCP server now load on install. Previously the manifest pointed `commands`, `hooks`, and `mcpServers` at paths inside `.claude-plugin/`, but the [plugin spec](https://code.claude.com/docs/en/plugins-reference) resolves those fields against the plugin root — so reload reported `0 hooks · 0 plugin MCP servers` and `/tf` did not match. Files moved to the spec-default locations: `commands/`, `hooks/hooks.json`, and `.mcp.json` at the plugin root; the redundant override fields in `plugin.json` are gone.

## [0.1.4] - 2026-04-28

Stops `vega install` from silently lying about "another install in progress" when the real problem is a bad `VEGA_BUNDLE_DIR` or filesystem permissions. The previous code conflated three distinct failure modes (placeholder env value, lock infrastructure failure, real lock contention) into one misleading message.

### Fixed

- `vega install` no longer says "another vega install is in progress" when the bundle dir is unwriteable, points at a literal placeholder (`/absolute/path/to/...`, `/path/to/your/...`, `<your-bundle>`, or unexpanded `$VAR`), or when the lockfile mechanism itself fails (EACCES, EROFS, ENOTDIR, network mount without flock support). Each failure shape now produces a specific error with a concrete recovery hint:
  - **Placeholder** → "Run `unset VEGA_BUNDLE_DIR` and retry."
  - **Not absolute** → "Set VEGA_BUNDLE_DIR to an absolute path."
  - **EACCES/EROFS/ENOTDIR/ENOENT on parent** → name the OS error code and explain the likely cause.
  - **ELOCKED (real contention)** → keep the existing message, but also point at the new `VEGA_FORCE_UNLOCK=1` override.
  - **Other lock infra failure** → "This is NOT another install — the lockfile mechanism itself failed." with diagnosis hints.

### Added

- `VEGA_FORCE_UNLOCK=1` env var. Removes the lock sentinel before acquire so users with a known-stale lock (killed previous install, hung process they cleaned up manually) don't have to learn the lockfile path or wait for proper-lockfile's 5-minute stale window.
- New `validateBundleDir()` function in `npm/install.js`. Runs at startup before any I/O, so failures surface in milliseconds instead of after a confusing chain of mkdir → write → lock attempts.

## [0.1.3] - 2026-04-28

`vega doctor` now distinguishes "agent host installed" from "vega skill registered" instead of conflating them. This fixes a misleading `✓ codex registered` line that was actually showing "vega's previously-installed file is still on disk" even when codex itself had never been on the machine.

### Changed

- `vega doctor` agent registration block now shows two columns per agent: `host ✓/—` (is the agent itself installed?) and `skill ✓/—` (have we wired our skill into it?). Each combination produces a contextual hint:
  - `host ✓ skill ✓` → all good (green)
  - `host ✓ skill —` → "run `vega skills install --agent <name>` to register"
  - `host — skill ✓` → "host not detected; skill is an orphan, safe to remove"
  - `host — skill —` → silent (user doesn't use this agent)

### Added

- New `src/lib/host-detect.ts` with per-agent detection rules. Each agent has two signals: binary on `$PATH` (definitive when present) and a config file the agent itself creates on first run (never a path vega writes to — that would be tautological).
  - claude-code: `claude` on PATH or `~/.claude/settings.json`
  - codex: `codex` on PATH or `~/.codex/auth.json` (created by `codex login`)
  - cursor: `cursor` on PATH or platform-specific config dir (`~/Library/Application Support/Cursor` on macOS, `~/.config/Cursor` on Linux, `%APPDATA%\Cursor` on Windows)
  - gemini: `gemini` on PATH or `~/.gemini/settings.json`
  - continue: `~/.continue/config.{yaml,json}` (extension-only; no CLI binary)
  - aider: `aider` on PATH or `~/.aider.conf.yml`
- `CODEX_HOME` and `GEMINI_CLI_HOME` env-var overrides honored when checking those agents' config dirs.

## [0.1.2] - 2026-04-28

Fixes the `vega install` 404 by switching to the manifest-driven bundle resolution that matches the actual R2 + CalVer architecture. Also adds `vega update` and a daily stale-version nag.

### Fixed

- **`vega install` no longer 404s.** The previous URL `github.com/vegastack/vegastack-cli/releases/download/v<CLI>/vegastack-bundle-v<CLI>.tar.gz` was wrong on three dimensions: (1) the bundle ships from a different repo (`engg-vegastack-agent-tf-providers`), (2) the bundle uses CalVer that drifts independently from the CLI's semver, (3) R2 (`bundles.vegastack.com/cli/...`) is the primary CDN, not GitHub Releases. `npm/install.js` now GETs `https://bundles.vegastack.com/cli/manifest.json` and uses `channels.latest.bundle_url` + `channels.latest.bundle_sha256` directly. Falls back to the bundle repo's GitHub Releases (`bundle-v<CALVER>` tags) on R2 outage. `.version` on disk now stores the bundle's CalVer instead of the CLI's semver, so a CLI version bump no longer triggers a spurious bundle re-download.
- `vega doctor --json` now reports the real CLI version (read from the package's `package.json` via `pkgRoot()`) instead of `process.env.npm_package_version`, which is only set when invoked through an `npm run` script.
- README no longer recommends `export VEGA_BUNDLE_DIR=/absolute/path/to/...` as a copy-pasteable line — that placeholder caused a real user to set the bundle dir to a literal `/absolute/path/...` and hit `mkdir ENOENT`.

### Added

- `vega update` — upgrade in place by wrapping `npm i -g @vegastack/cli@latest`. Auth + scoped registry routing come from the user's `~/.npmrc`. Use `--check` to only refresh the cache and report status without installing.
- `vega doctor` now refreshes the version cache (network call, ~5s timeout) and adds a "CLI version" check that flags when a newer release is on the registry.
- One-line stderr nag printed at the start of any `vega` command when the cached `latest` is newer than the running version. Reads cache only — never blocks on network. Suppressed by `--quiet`, `--json`, or `VEGA_NO_UPDATE_NAG=1`.
- `~/.config/vegastack/update-check.json` — 24h-TTL cache of the last-seen latest version. Populated by `vega doctor` and `vega update [--check]`.
- New env vars for `npm/install.js`: `VEGA_BUNDLE_MANIFEST_URL` (override the manifest source), `VEGA_BUNDLE_SHA256` (pin a SHA when using `VEGA_BUNDLE_URL` without a `.sha256` sidecar).

### Removed

- `package.json#expectedBundleSha` and `expectedBundleVersion` fields, plus the `prepublishOnly` guard that enforced them. Pinning a single bundle SHA per CLI version was incoherent now that the bundle ships independently on a daily cadence; the trust anchor moved to the network manifest served from `bundles.vegastack.com` (HTTPS + Cloudflare). `scripts/check-bundle-pin.js` and `scripts/tag-release.js` are now dead code; they will be deleted in a follow-up.

## [0.1.1] - 2026-04-28

Fixes a packaging bug where `vega install` and other commands resolved the package root from the bin symlink, not the real install location, breaking every command that needed an in-package script (`vega install`, `vega refresh`, etc.) when installed via `npm i -g`.

### Fixed

- `pkgRoot()` now resolves `process.argv[1]` through `fs.realpathSync` before walking up to find `package.json`. Previously, when `vega` was a symlink in the npm prefix's `bin/` dir (the standard global-install layout), the upward walk never found the package and fell back to the npm prefix itself — producing nonsense paths like `/opt/homebrew/npm/install.js`.

## [0.1.0] - 2026-04-28

First internal release of `@vegastack/cli` to GitHub Packages under the `@vegastack` org. Deterministic file-system knowledge harness for coding agents (Claude Code, Codex, Cursor, Gemini, Continue, Aider) covering 31 Terraform providers.

### Added — CLI core

- `vega tf "<query>"` — discover Terraform resources via 4-channel response envelope (`files[]` + `knowledge[]` + `recipes[]` + `concept_aliases_used[]`). Top-K results arrive with full `manifest_entry` (required_args / optional_args / computed_attrs / enum_values / import_syntax / deprecated / recommended_companions) plus inline `## Example Usage` block. One tool call per task in the common case.
- `vega doctor` — environment health check (Node, bundle path, jq, ripgrep, schema validity, per-agent install status); `--verify-bundle` validates every per-provider MANIFEST.json against the JSON Schema; `--json` for machine-readable output.
- `vega install` / `vega refresh` — fetch the docs bundle from GitHub Releases / R2, SHA256-verify, atomic-swap into place. Postinstall is the default install hook; can be skipped via `VEGA_SKIP_POSTINSTALL=1`.
- `vega skills install --agent <name>` for **6 agent renderers**: Claude Code, Codex, Cursor, Gemini, Continue, Aider. Global / project scope, dry-run, idempotent install/uninstall.
- `--brief` flag returns ~80% smaller envelope for survey / multi-call dispatch.
- `--full-examples` flag restores full `## Example Usage` content (default truncates to first HCL fenced block + 30 lines).
- Auto `--top 1` short-circuit fires when top-1 score_norm > 90 AND second-best < 50, returning a single result for high-confidence queries.

### Added — multi-provider classification

- Confidence-scored provider detection (canonical 1.0 / substring 0.9 / alias 0.6) with anti-detection caps for English-word providers (`time`, `local`, `random`, `external`, `helm`).
- `distinctive_tokens` per provider in MANIFEST.json — top-15 tokens that uniquely identify the provider, enabling the classifier-tiebreaker for queries like "Atlas cluster" → `mongodb-atlas`.
- Multi-provider phrasing heuristic — queries like "X on Y", "X with Y", "X via Y" force `status: ambiguous` → fan-out to per-provider auto-merge → unioned envelope (`merged_from_providers: [...]`).
- Token stemmer (`-ing`, `-er`, `-s`, `-es` suffix-stripping) with digit-protection guard so `v1`, `m40`, `t4g`, `r6g` survive intact.
- Per-provider score normalization (`score_norm` 0..100) replaces raw cross-provider score comparison.

### Added — 4-channel content registry (real, not stubs)

- **16 knowledge cards** under `bundle/knowledge/*.md` — recent renames, deprecations, native-feature replacements (S3 native state locking, BPA defaults, Cloudflare v5 mass-rename, azurerm v4, Cloud Run v2, GitHub OIDC thumbprint sentinel, etc.), each with `date_authored` + `authoritative_source` + body.
- **10 cross-provider recipes** under `bundle/recipes/*.toml` — zero-trust (CF Access + AWS ALB + Okta), scalable backend (ECS Fargate + ALB + RDS + Datadog), GitHub OIDC → AWS, GKE + Cloudflare DNS + WAF, EKS + IRSA + ALB controller, more.
- **42 concept aliases** across `bundle/<provider>/aliases.yaml` (cloudflare, aws, gcp, azure, mongodb-atlas, tls, local, crowdstrike, snowflake, etc.) — phrase-substring matches that map natural-language queries to specific resource sets.
- **111 `recommended_companions` entries** across `bundle/<provider>/companions.yaml` — soft-dep expansion for top-30 resources (e.g., `aws_instance` → VPC + subnet + SG + IGW + RT + key pair).

### Added — apps (Cloudflare Workers, separate folders)

- **`apps/mcp/`** — Cloudflare Remote MCP server via the Cloudflare Agents SDK (`agents@0.11.6` + `@modelcontextprotocol/sdk@1.29.0`). Both `/mcp` (StreamableHTTP) and `/sse` (legacy SSE) transports. 5 MCP tools (`tf_discover`, `tf_get_manifest`, `tf_list_providers`, `tf_get_knowledge_card`, `tf_get_recipe`). R2-binding-first reader with LRU + KV cache + public-CDN fallback. Lives at `https://cli-mcp.vegastack.com/mcp`.
- **`apps/dashboard/`** — Astro 6.1.9 + `@astrojs/cloudflare@13.2.1` Workers static-assets dashboard at `https://cli-evals.vegastack.com`. Renders the lift number, per-archetype bars, knowledge-card hit rates, per-date deep-dives. Tailwind v4. Server-rendered SVG charts (no chart-lib runtime). Falls back to bundled fixture report when R2 has no data yet.

### Added — manifest builder & schema (separate `engg-vegastack-agent-tf-providers` repo)

- `manifest_builder.py` rewritten with block-nesting state machine — `required_args` now top-level only, eliminating the spurious nested-block pollution that previously caused `aws_db_instance.required_args` to report 8 entries (now 4), `aws_lb_listener` 26 → 2, `aws_eks_cluster` 12 → 3.
- `build_companions.py` + `build_aliases.py` + `validate_manifest.py` — JSON-Schema (Draft 2020-12) validator runs against every per-provider MANIFEST.json (31/31 PASS).
- Manifest schema v1 published at `schema/manifest.schema.json`, consumed by both Python builder and TS loader (eliminates drift).

### Added — distribution

- npm publish path via GitHub Packages (`publish-internal.yml`, tag-triggered). Public-npm `release.yml` exists but is dormant for the v0.1 internal phase.
- Bundle distributed via Cloudflare R2 (`vegastack-agent-kb` bucket, `cli/` prefix) with mirror to GitHub Releases. Custom domain `bundles.vegastack.com`. Per-provider content-addressed shards under `cli/cas/sha256/<hex>.tar.gz` with cosign sigstore signatures.
- `prepublishOnly` guard at `scripts/check-bundle-pin.js` blocks `npm publish` if `expectedBundleSha` is the placeholder. CI bypass via `VEGA_ALLOW_PENDING_BUNDLE_SHA=1` for v0.1 internal builds.

### Added — eval pipeline

- 50 evaluation prompts across 12 archetypes (single-resource scaffold, argument lookup, import, modernise, soft-dep expansion, multi-resource topology, cross-provider topology, compliance, cost optimisation, GitOps, day-2 ops, recent-change). 5 personas (SRE, Platform Engineer, Security Engineer, FinOps, Junior Dev).
- `evals/runner.ts` baseline-vs-skill runner with `lift = (with_skill - baseline) / max(0.01, 1 - baseline)` formula. Mock mode for offline CI; Anthropic SDK mode for real measurement.
- `.github/workflows/evals.yml` — nightly cron + per-PR smoke. Uploads results to R2 (`cli/evals/reports/<date>.json`), maintains `cli/evals/reports/INDEX.json` for the dashboard.
- Reusable `evals-upload-r2.yml` workflow for ad-hoc backfill of past dates.

### Added — supply chain & security

- npm OIDC trusted publishing (no `NPM_TOKEN`); SLSA L3 build provenance via `actions/attest-build-provenance@v2`.
- cosign sign-blob signs every R2 shard plus the full bundle tarball; sigstore bundles available alongside `.sha256` sidecars.
- `npm/safe-tar.js` validates every tar entry path + link target BEFORE extraction (path-traversal, absolute paths, drive letters, UNC, dotdot, refusable types). Gzip magic-bytes pre-check.
- Crypto: `crypto.timingSafeEqual` against hex-validated SHA256 sidecar; bundle hashed in streaming chunks (never fully in memory); 500 MB hard cap.
- Concurrency lock via `proper-lockfile` (replaces brittle mtime stale-lock heuristic).
- Path validation rejects bidi-override + zero-width control chars (Trojan Source defense). Allowed-roots realpath'd to close the macOS `/var → /private/var` divergence.
- Dependabot + OSV-Scanner + CodeQL workflows; third-party Actions pinned to commit SHAs.

### Added — testing

- 426 tests across 3 codebases pass green: CLI 398 (vitest), `apps/mcp` 19 (vitest + `@cloudflare/vitest-pool-workers`), `apps/dashboard` 9 (vitest). Bundle pytest 27 in the separate tf-providers repo.
- Per-stage unit tests for tier1 / tier2 / scoring / enrich / provider / tokenize / knowledge / recipes / aliases / merge.
- Integration tests for discover-native, classifier-distinctive-tokens, multi-provider-phrasing, auto-merge.

### Distribution targets (live)

- **`@vegastack/cli`** at GitHub Packages — `npm i -g @vegastack/cli` (PAT setup per README "Install (internal — GitHub Packages)").
- **`apps/mcp`** at `https://cli-mcp.vegastack.com/mcp` (StreamableHTTP) and `/sse` (SSE) — for any MCP-aware coding agent.
- **`apps/dashboard`** at `https://cli-evals.vegastack.com` — public eval dashboard.

### Known follow-ups (for v0.1.x patch releases)

- 2 narrow eval regressions documented in the S9 audit (`E9-A4-k8s-v1-suffix` knowledge card trigger mismatch, `E9-A6-cloudflare-workers-d1-r2` companion ranking) — both bounded; bundle-content fixes, not code.
- `--brief` envelope compression on real bundle (32-50%) is below the 25% target measured against test stubs — documented as v0.1.x optimization opportunity.
- `vega doctor --verify-attestations` (CLI-side cosign verification) deferred to v0.2 — only `--verify-bundle` (schema validation) wired in v0.1.

[0.1.0]: https://github.com/VegaStack/vegastack-cli/releases/tag/v0.1.0
