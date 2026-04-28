# Changelog

All notable changes to `@vegastack/cli` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
