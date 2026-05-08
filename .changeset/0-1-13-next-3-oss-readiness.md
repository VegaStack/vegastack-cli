---
"@vegastack/cli": patch
---

OSS-readiness restructure + two latent production bugs fixed.

**Bug fixes (both were pre-existing in 0.1.13-next.2; surfaced by ground-up E2E):**

- **Critical:** `vegastack registry install --all` (and any single-pack install) failed with `ArtifactCorrupt: unexpected file in registry archive: ARTIFACTS.json`. The post-extract allowlist in `src/lib/registry.ts` did not seed itself with the index file (`ARTIFACTS.json`), which the archive legitimately ships at the root. The index is integrity-protected by `entry.artifacts_sha256` from the signed catalog, so seeding it is safe. Pinned by a 4-case regression test that invokes `verifyExtractedArtifacts` directly.
- **High:** `vegastack ask` and `vegastack search` (no `--pack`, no `--all`) always rejected with `ValidationError: no Registry packs are selected in .vegastack/vegastack.yml`, even when packs WERE selected. Commander's `.option("--pack <names>", collect, [])` defaults to `[]`; `cli.ts` forwarded that empty array as `entries` and the resolver in `_shared.ts` short-circuited because `if (opts.entries)` is truthy for `[]` in JS. Two-layer fix: `cli.ts` only forwards `opts.pack` when length > 0; `_shared.ts` treats empty arrays as "no override". Pinned by `tests/commands/ask-search-empty-pack.test.ts`.

**Skill / multi-agent restructure:**

- Standardized shipped agent templates under `skills/vegastack/templates/`. Renamed root docs: `GET_STARTED.md` → `GETTING_STARTED.md`, `STYLE.md` → `STYLEGUIDE.md`, `CONTEXT.md` → `GEMINI.md`. Root `cursor-rule.mdc` and `gemini-extension.json` moved into the templates folder; `pkgCursorRule()`, `pkgGeminiExtension()`, `pkgAgentsMd()` in `src/lib/paths.ts` now resolve there. Repo-internal `AGENTS.md` is now contributor-only; the shippable Codex template lives at `skills/vegastack/templates/AGENTS.md` and no longer leaks repo-internal sections to user projects.
- Removed the legacy `ALL_AGENTS` synchronous installer registry from `src/agents/index.ts`. `ALL_RENDERERS` (claude-code, codex, cursor, gemini, continue, aider) is the single source of truth.
- Removed the legacy project-level Gemini installer path. `vegastack skills install --host gemini` now writes only the modern `~/.gemini/extensions/vegastack/` layout.
- `references/skills.md` enumerates all six supported hosts with per-host install footprints. Architecture test pins the host list against `ALL_RENDERER_NAMES`.

**Repo / process hygiene:**

- Dropped unused `personas/` and `recipes/` scaffolding plus `scripts/generate-skills.ts`.
- Removed redundant `.npmignore`; `package.json:files` is authoritative.
- Added `scripts/sync-version.mjs` invoked from `version-sync` so `gemini-extension.json` version stays in sync with `package.json` automatically.
- Standardized "preview tunnel via Cloudflare" terminology across user-facing help and docs.
- `package.json:description` now lists all six agents; removed unreferenced `openclaw`/`hermes` keywords.
- README adds a Supported Agents line + a realistic `--agent` JSON envelope sample matching the actual CLI shape (`results[]`, `registry_packs[]`, `citations[]`, `concept_aliases_used[]`).
- SECURITY.md exit-code reference points to `src/cli.ts` (`EXIT_CODES`) and `tests/lib/exit-codes-contract.test.ts` instead of inventing a stale range.

**Tests:** 426 (0.1.13-next.0) → 621 (next.1) → **659** in this release. New regression tests cover both production bugs plus a `tests/architecture/templates-and-host-list.test.ts` regression-prevention pass.

Audit reports for this release: `audits/audit-1778241677-2026-05-08T12-01-17Z-changed.md`, `audits/audit-1778244187-2026-05-08T12-43-07Z-changed.md`. Pre-PR review notes under `docs/reviews/`.
