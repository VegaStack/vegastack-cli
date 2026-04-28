# A4 — Per-team 12-point checklist

Format: ✓ pass · ⚠ nit · ✗ fail · n/a

## Legend
1. No swallowed errors
2. No silent fallbacks
3. No leftover `// TODO` / `// FIXME`
4. No `console.log` in production paths
5. No hard-coded paths
6. No hard-coded provider list
7. Schema migrations safe
8. No breaking changes for nothing
9. Tests cover the public surface
10. No accidentally-committed secrets
11. Lint clean
12. Typecheck clean

---

## E1 — Manifest fixer (Python, bundle repo)

| # | Result | Notes / file:line |
|---|---|---|
| 1 | ✓ | `manifest_builder.py:701-703` `_build_one` catches with traceback + propagates failure status. `build_aliases.py` and `build_companions.py` log every malformed entry as WARN. |
| 2 | ⚠ | `build_aliases.py:51-58`: when `MANIFEST.json` is absent the provider is silently skipped with only a `warnings.append`. Fine, but `_process_provider` returns `(0,0,warns)` so the caller still prints `OK ...: 0 entries written`. Could be a soft-fail upgrade. |
| 3 | ✓ | No `# TODO` / `# FIXME` in `scripts/`. |
| 4 | n/a | Python uses `print()` by design (pipeline tees logs). |
| 5 | ✓ | Builder takes `path` arg + walks; no hard-coded paths. |
| 6 | ✓ | `_list_providers` walks `bundle_root` at runtime; no provider list in code. |
| 7 | ✓ | `MANIFEST_SCHEMA_VERSION = 1` (clean restart per v0.1 overrides §2). Validator + tests guard the shape. |
| 8 | ✓ | Greenfield. |
| 9 | ✓ | 12/12 tests pass (`tests/manifest_builder/test_extract_schema.py`); validator script exits 0 on all 31 providers. |
| 10 | ✓ | No secrets in diff. |
| 11 | n/a | No JS lint; Python style consistent. |
| 12 | n/a | Python (no tsc). |

**Headline finding:** the per-resource fields (`blocks`, `recommended_companions`, `schema_origin`) are emitted correctly. The TOP-LEVEL `primary_resources`, `subcat_keywords` fields are NOT emitted by `manifest_builder.py`; only `service_aliases` is (and only via `build_aliases.py`, only for the 4 providers with `aliases.yaml`). This is the E1↔E2 gap in punch-list #4. See A4.2 below.

**Verdict: APPROVE-WITH-NITS** (1 functional gap — punch-list #4, recommend resolution (a))

---

## E2 — Harness modernization (TS, CLI repo)

| # | Result | Notes |
|---|---|---|
| 1 | ✓ | All catches either log via `log` lib or rethrow; defensive `?? {}` handles missing manifest fields. |
| 2 | ✓ | `index.ts:266` emits `warnings[]` when `bundle_version === "unknown"`. |
| 3 | ✓ | None found. |
| 4 | ✓ | No `console.*` in `src/lib/discover/`, `src/commands/`, `npm/*.js`. |
| 5 | ✓ | Uses `path.join`, `os.homedir()`, `bundleDir()` throughout; no hard-coded paths. |
| 6 | ✓ | `index.ts` resolves providers via `loadBundleRootManifest()`. `tier1.ts:58-59` reads `manifest.subcat_keywords ?? {}` and `manifest.primary_resources ?? {}`. |
| 7 | ✓ | `schema_version: 1` everywhere. |
| 8 | ✓ | Greenfield. |
| 9 | ✓ | 308/308 tests pass; new tests in `tests/lib/discover/{tier1,tier2,scoring,enrich,intents,merge,knowledge,recipes,aliases,tokenize,provider}.test.ts`. |
| 10 | ✓ | None. |
| 11 | ✓ | `npm run lint` exit 0. |
| 12 | ✓ | `npm run build` + `npx tsc --noEmit` exit 0. |

**Verdict: APPROVE**

---

## E3 — Content authoring (YAML / Markdown / TOML, bundle repo)

| # | Result | Notes |
|---|---|---|
| 1 | n/a | Content only. |
| 2 | n/a | Content only. |
| 3 | ✓ | None. |
| 4 | n/a | Content. |
| 5 | n/a | Content. |
| 6 | n/a | Content. |
| 7 | ✓ | All YAML / TOML / frontmatter parses; passes E1's `validate_manifest.py`. |
| 8 | ✓ | Greenfield. |
| 9 | n/a | Content (E2 has loader tests). |
| 10 | ✓ | No secrets in any card / recipe / alias file. |
| 11 | n/a | YAML / TOML / Markdown. |
| 12 | n/a | Same. |

**Verdict: APPROVE**

Notes: 16 knowledge cards + 10 recipes + 28 aliases shipped. 221 of 221 cross-references against per-provider MANIFEST.json validate. `cloudflare_zone_settings_override → cloudflare_zone_setting` rename caught and fixed.

---

## E4 — Distribution + auto-update (workflows, scripts)

| # | Result | Notes |
|---|---|---|
| 1 | ✓ | `scripts/tag-release.js` propagates errors with exit codes. |
| 2 | ✓ | Workflows fail loud (`::error::` lines). |
| 3 | ✓ | None. |
| 4 | n/a | Bash + JS workflow scripts. |
| 5 | ✓ | All paths derived from `$GITHUB_WORKSPACE`. |
| 6 | ✓ | Bundle build pulls provider list from disk. |
| 7 | ✓ | CalVer bundle, semver CLI. |
| 8 | ✓ | Greenfield. |
| 9 | ✓ | `tests/scripts/tag-release.test.ts` 7/7 pass. |
| 10 | ✓ | No tokens in workflows; uses OIDC + secrets contexts. |
| 11 | ✓ | `actionlint` + `prettier --check` clean. |
| 12 | ✓ | `npm run build` + `npm run typecheck` clean. |

**Verdict: APPROVE-WITH-NITS** — 1 nit, the `R2_BUCKET` GH-secret naming is consistent in both build-and-publish.yml + evals-upload-r2.yml, but the wrangler.toml files in apps/{mcp,dashboard} hardcode different bucket names (punch-list #1).

---

## E5 — SKILL + agent-renderer (TS, CLI repo)

| # | Result | Notes |
|---|---|---|
| 1 | ✓ | `aider.ts:248`, `gemini.ts:239` catches re-raise non-typed errors. |
| 2 | ✓ | `skill-source.ts` returns null + warning, not silent default. |
| 3 | ✓ | None. |
| 4 | ✓ | No console.*. |
| 5 | ✓ | Uses `paths.ts` helpers. |
| 6 | ✓ | No provider list. |
| 7 | ✓ | N/A — additive. |
| 8 | ✓ | Greenfield. |
| 9 | ✓ | 5 new test files cover Aider + Continue + Gemini renderer + types + skill-render integration. |
| 10 | ✓ | None. |
| 11 | ✓ | Lint clean (E5's STATUS noted 1 pre-existing error in E2 territory; that file is now clean). |
| 12 | ✓ | Build + typecheck clean. |

**Verdict: APPROVE-WITH-NITS** — 2 nits:
1. `src/commands/skills.ts:3` still imports `ALL_AGENT_NAMES` + `getAgent` (legacy 4-agent registry). The new 6-agent `ALL_RENDERERS` registry was shipped but not wired into the CLI command. Punch-list #3.
2. `.claude-plugin/mcp/mcp.json`, `gemini-extension.json`, `src/agents/continue.ts` default to `/sse`; punch-list #2 says switch to `/mcp` per current Cloudflare guidance, leave `/sse` as fallback for older Claude Desktop.

---

## E6 — Eval expansion (TS, CLI repo)

| # | Result | Notes |
|---|---|---|
| 1 | ✓ | Runner catches surface as `is_error` tool results; `pmap` propagates. |
| 2 | ⚠ | `mockRun` returns a `[mock-baseline]` placeholder when no fixtures key is matched — silent. |
| 3 | ✓ | None. |
| 4 | ⚠ | `runner.ts:333` uses `console.log` with `// eslint-disable-next-line` — acceptable for a CLI runner but worth `log` lib parity. |
| 5 | ✓ | Paths derived. |
| 6 | ✓ | No provider list. |
| 7 | ✓ | `schema_version: 1`. |
| 8 | ⚠ | The persisted report shape does NOT match the `EvalReport` interface that E8 publishes (see A4.4). Drift. |
| 9 | ✓ | 23 new tests; 308/308 overall pass. |
| 10 | ✓ | None. |
| 11 | ✓ | Clean. |
| 12 | ✓ | Clean. |

**Verdict: REQUEST-CHANGES** — the report shape drift with E8 is a ship-blocker for the dashboard; see A4.4. Quick fix: align `runner.ts` to emit `{schema_version, date, lift, baseline_pass_rate, with_skill_pass_rate, prompts[], archetypes[], knowledge_cards[], recipes[], cli_version, bundle_version, prompt_count, duration_s}` per `apps/dashboard/src/lib/parse-report.ts:113-130`.

---

## E7 — Cloudflare Remote MCP (TS, apps/mcp)

| # | Result | Notes |
|---|---|---|
| 1 | ✓ | All catches typed (`BundleNotFound`, `BundleCorrupt`); structured logging. |
| 2 | ⚠ | `r2-bundle.ts:79-81` silently swallows public-CDN-fallback fetch failures. The next step throws `BundleNotFound` so the contract is preserved, but the underlying network error is gone — add a debug log line. |
| 3 | ✓ | None. |
| 4 | ⚠ | One `console.log` in `index.ts:265` — but it's the structured-logger's only sink in Workers (Workers Logs ingest `console.log`), so this is correct. |
| 5 | ✓ | All paths via env bindings + `BUNDLE_PUBLIC_BASE_URL` var. |
| 6 | ✓ | `listProviders()` reads from root manifest. |
| 7 | ✓ | `schema_version: 1`. |
| 8 | ✓ | Greenfield. |
| 9 | ✓ | 19/19 tests pass. |
| 10 | ✓ | None. |
| 11 | n/a | No lint script. |
| 12 | ✓ | `npm run build` (`tsc --noEmit`) clean. |

**Verdict: REQUEST-CHANGES** — 3 issues:
1. **Provider regex bug** at `apps/mcp/src/lib/r2-bundle.ts:115`, `apps/mcp/src/tools/tf_discover.ts:22`, `apps/mcp/src/tools/tf_get_manifest.ts:14` use `^[a-z][a-z0-9-]*$` which rejects `1password`. E1 already fixed this in the canonical schema (E1's `contract-issue.md`); E7 missed the memo. Patch all 3 to `^[a-z0-9][a-z0-9-]*$`.
2. **Type duplication.** `apps/mcp/src/lib/types.ts` is a hand-mirrored copy of `docs/contracts/discover-types.ts`. The file even says "When E2 lands and exports the canonical types from @vegastack/cli, replace this mirror." E2 has landed — this should re-export now (or stay mirrored only because @vegastack/cli is unpublished, in which case raise an explicit cleanup TODO post-publish). See A4.4.
3. R2 bucket name in `wrangler.toml:46` is `vegastack-bundle` — diverges from E4 (`vegastack-cli-bundles`) and E8 (`bundles-vegastack-com`). Punch-list #1.

---

## E8 — Astro public dashboard (TS / Astro, apps/dashboard)

| # | Result | Notes |
|---|---|---|
| 1 | ✓ | `r2.ts` `.catch(() => null)` is intentional + defensive. |
| 2 | ✗ | `r2.ts:79-83`: malformed JSON or unparseable report falls through to `fallbackReport()` (the bundled fixture) without surfacing the error. The user sees `+47%` lift from the fixture and thinks it is real. Please log a warning, set a `stale: true` flag in the model, or render a "no live data" banner. |
| 3 | ✓ | None. |
| 4 | ✓ | No console.*. |
| 5 | ✓ | All paths derived from env bindings. |
| 6 | n/a | Doesn't touch providers. |
| 7 | ✓ | `schema_version: 1`. |
| 8 | ✓ | Greenfield. |
| 9 | ✓ | 9/9 smoke tests pass. |
| 10 | ✓ | None. |
| 11 | ✓ | `astro check` 0/0/0. |
| 12 | ✓ | `npm run build` clean. |

**Verdict: REQUEST-CHANGES** — 2 issues:
1. **Report shape drift with E6** — see A4.4. `parseReport()` will return `null` for every real E6 report, so the dashboard will render the bundled fixture forever. Either E6 changes runner output (preferred — single source of truth in dashboard) OR `parse-report.ts` adds an adapter that tolerates E6's shape and maps to the dashboard model.
2. R2 bucket name in `wrangler.toml:20` is `bundles-vegastack-com` — diverges from E4 + E7. Punch-list #1.
