# E6 — Eval expansion status

Repo: `/Users/mk/projects/vegastack-cli/`
Time spent: ~110 min / 120 min budget
Build status: my files clean (typecheck + lint); pre-existing failures in
`tests/agents/{cursor,gemini}.test.ts` and `tests/integration/install-security.test.ts`
are unrelated to E6 scope (E2/E4/E5 territory).

## Files shipped

| path | LOC | purpose |
|---|---|---|
| `evals/evals.json` | 559 | 50 prompts, distributed exactly per /tmp/synthesis/v1-plan.md §4: A1×6 A2×4 A3×4 A4×4 A5×5 A6×5 A7×5 A8×4 A9×3 A10×4 A11×3 A12×3 |
| `evals/README.md` | 110 | format docs, expectation-kind table, how to add a prompt, how to run locally |
| `evals/runner.ts` | 327 | CLI: `--mode baseline|with-skill|both --concurrency 4 --output …`; supports `--mock` and `--mock-fixtures` for offline test runs; emits per-prompt + per-archetype + overall lift JSON |
| `evals/lib/score.ts` | 234 | per-expectation scoring: resource_present, no_resource, argument_present/absent, import_syntax_match, manifest_check, cites_card/recipe/path; lift formula + summarize |
| `evals/lib/judge.ts` | 110 | LLM-as-judge for ambiguous cases; 3-sample median; locked prompt (snapshot-tested) |
| `evals/lib/anthropic-runner.ts` | 184 | Anthropic SDK driver with bash_20250124 tool; baseline = no skill in system prompt; with-skill = SKILL.md body inlined; mockRun() for offline runs |
| `evals/reports/.gitkeep` | 4 | reports land here |
| `evals/reports/demo-fixtures.json` | 16 (data) | mock fixtures used to prove pipeline end-to-end |
| `evals/reports/demo-baseline-vs-skill.json` | (generated) | proof-of-pipeline 5-prompt report — baseline 26.3% / with_skill 100% / lift 100% |
| `tests/integration/eval-runner.test.ts` | 168 | 15 tests: score primitives, lift formula, summarize, judge prompt locked, mockRun, end-to-end runner via --mock |
| `tests/integration/loaders.test.ts` | 95 | 8 tests: bundle-mini fixture sanity + manifest entry contract |
| `tests/integration/discover-parity.test.ts` | (edited; +6/-9) | replaced 10 ad-hoc parity prompts with 12 archetype-aligned prompts (one per A1..A12) |
| `tests/lib/discover/tier1.test.ts` | 12 | skeleton (E2 fills) |
| `tests/lib/discover/tier2.test.ts` | 9 | skeleton (E2 fills) |
| `tests/lib/discover/scoring.test.ts` | 9 | skeleton (E2 fills) |
| `tests/lib/discover/enrich.test.ts` | 9 | skeleton (E2 fills) |
| `tests/lib/discover/intents.test.ts` | 7 | skeleton (E2 fills) |
| `tests/lib/discover/merge.test.ts` | 8 | skeleton (E2 fills) |
| `tests/lib/discover/knowledge.test.ts` | 9 | skeleton (E2 fills) |
| `tests/lib/discover/recipes.test.ts` | 9 | skeleton (E2 fills) |
| `tests/lib/discover/aliases.test.ts` | 9 | skeleton (E2 fills) |
| `tests/fixtures/bundle-mini/MANIFEST.json` | 5 | root manifest (2 providers, 2026.04.28 CalVer) |
| `tests/fixtures/bundle-mini/aws/MANIFEST.json` | 100 | 5 resources (s3_bucket, s3_bucket_versioning, eks_cluster (with vpc_config block), lambda_function, iam_role) |
| `tests/fixtures/bundle-mini/cloudflare/MANIFEST.json` | 105 | 5 resources (dns_record, zone, zero_trust_access_application, workers_script, ruleset) |
| `tests/fixtures/bundle-mini/{aws,cloudflare}/aliases.yaml` | 30 | 4 aliases total |
| `tests/fixtures/bundle-mini/aws/r/{s3_bucket,eks_cluster}.html.markdown` | 60 | 2 stub doc files |
| `tests/fixtures/bundle-mini/cloudflare/r/dns_record.html.markdown` | 32 | 1 stub doc file |
| `tests/fixtures/bundle-mini/knowledge/aws-s3-native-state-locking.md` | 22 | 1 knowledge card stub |
| `tests/fixtures/bundle-mini/recipes/scalable-backend-aws-ecs-fargate-rds-datadog.toml` | 32 | 1 recipe stub |
| `.github/workflows/evals.yml` | 156 | nightly (cron 07:00 UTC) full 50-prompt run + eval-history branch push; PR-smoke (12 prompts × 4 shards) + PR comment + 5pp gate |
| `tsconfig.json` | +1 char | added `evals/**/*.ts` to `include` |
| `eslint.config.js` | +1 char | added `evals/**/*.ts` to TS-aware lint group |

Net new LOC ~1,860 code + 350 data + 156 yaml.

## Web-search log (per team-protocol §1)

| package | version pinned | notes |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.90.0` | latest stable as of late April 2026; bash_20250124 tool is the recommended bash variant; verified via npm + Releasebot. Adds the SDK as a devDep (used only by evals/runner.ts at test/CI time). |
| `vitest` | already at `^1.5.0` in repo | 4.1.4 is current latest; LEFT AT 1.5.0 to avoid breaking other teams' in-flight work. Recommend a follow-up upgrade PR after E1-E5 land. |

LLM-as-judge patterns (April 2026 best practice consensus):
- single yes/no question per call,
- temperature 0,
- explicit JSON output schema,
- 3-sample median to suppress jitter (matches v1-plan §8 risk #10),
- snapshot-locked prompt to detect drift in CI.

Anthropic bash tool API:
- `tools: [{ type: "bash_20250124", name: "bash" }]`
- tool_use blocks deliver `{ command }`,
- tool_result blocks accept `{ tool_use_id, content, is_error }`.

GH Actions matrix patterns: 4-shard PR-smoke parallelization with download-artifact aggregation step.

Concurrent LLM rate-limit handling: bounded `pmap` with `--concurrency` flag; default 4 (conservative; raises wall-clock ~2× over serial without tripping standard tier rate limits).

## End-to-end proof

```
$ npx tsx evals/runner.ts --mode both --mock-fixtures evals/reports/demo-fixtures.json \
    --evals /tmp/demo-evals.json --output evals/reports/demo-baseline-vs-skill.json
[runner] mode=both model=claude-opus-4-7 count=5 concurrency=4
[runner] baseline_pct=26.3%  with_skill_pct=100.0%  lift_pct=100.0%
```

JSON report at `evals/reports/demo-baseline-vs-skill.json` shows correct
per-archetype breakdown (A1, A3, A12 each carrying expected lift).

## Tests

| test file | passing | skipped (todo) |
|---|---|---|
| `tests/integration/eval-runner.test.ts` | 15 | 0 |
| `tests/integration/loaders.test.ts` | 8 | 0 |
| `tests/lib/discover/{tier1,tier2,scoring,enrich,intents,merge,knowledge,recipes,aliases}.test.ts` | 0 | 44 (skeletons) |

`npm test` overall: **223 passing, 5 pre-existing failures (not E6)**, 44 todo (E2 to fill).

## Cross-team notes

- **E2**: I shipped the per-stage test SKELETONS as `it.todo(...)`. Fill them when you implement the stages. The fixture bundle in `tests/fixtures/bundle-mini/` is yours to share; if you need different shapes, append rather than rename so my eval-runner tests keep passing.
- **E3**: My `evals.json` references your knowledge-card and recipe ids by canonical id (e.g. `aws-s3-native-state-locking`, `scalable-backend-aws-ecs-fargate-rds-datadog`). If you renumber any of these during authoring, tell me and I'll bulk-rewrite the `cites_card` / `cites_recipe` expectations.
- **E4**: My CI workflow assumes the bundle-build runs at 06:00 UTC. If you push that earlier/later, update the cron in `.github/workflows/evals.yml`. The "push to eval-history branch" step is a fallback; if you'd rather upload reports directly to R2, swap that step for an `aws s3 cp` (R2 is S3-API-compatible).
- **E5**: My with-skill mode reads `skills/terraform-docs/SKILL.md` directly and inlines into the system prompt. When you ship the rewritten SKILL.md, no code change needed on my side.
- **E7 (MCP)**: My runner does NOT exercise the MCP path — bash tool only, per spec ("no MCP"). When MCP ships, a `--mode with-mcp` could be added.
- **E8 (dashboard)**: Reports land at `evals/reports/<date>.json` and (in CI) the `eval-history` branch under `reports/<date>.json`. Read either path. Schema documented in `evals/README.md`.

## Open / follow-ups

- The test fixture's `manifest_check` lookup is best-effort — see `evals/runner.ts:scoreExpectations` and `evals/lib/score.ts:manifestEntryToResourceName`. To make `manifest_check` strict in production, the runner needs a real `vega tf` pipe so the harness returns `manifest_entry` keyed by canonical resource name. Hooking that up is a 30-minute follow-up after E2's loader lands.
- PR-smoke aggregation node script uses the legacy `::set-output` syntax; on a recent runner (`>=v2.318.0`) GitHub will deprecate this — update to `$GITHUB_OUTPUT` writes when the deprecation lands.
- `vitest` is on `1.5.0` (Apr 2024); upgrading to `4.1.x` is a separate cross-team PR.

## Contract issues raised

None. The discover-types.ts contract was usable as-is; the manifest schema
is forward-compatible with what we ship (`schema_version: 1`).
