# Eval baseline & lift methodology (v0.1)

This page documents how the published lift numbers on `https://cli-evals.vegastack.com` are produced and how to read them.

## What "lift" means

```
lift = (with_skill_pct − baseline_pct) / (1 − baseline_pct)
```

Lift is the **fraction of remaining error that the skill closes**. If baseline gets 60% of expectations right and the skill+harness gets 80% right, lift = (0.80 − 0.60) / (1 − 0.60) = 0.50, i.e. the skill closed half the gap to perfection. Lift is bounded in `[−∞, 1]`; negative lift means the skill made things worse.

## Two-mode runner

`evals/runner.ts` runs each prompt in two modes:

1. **Baseline run.** The current Claude model (Sonnet 4.7 or whatever ships in `runner.ts:DEFAULT_MODEL`) is given the user prompt and a generic system prompt. No `vegastack ask` available, no skills directory, no MCP. Output is scored against the prompt's `expectations[]` by an LLM-as-judge (yes/no per expectation).

2. **With-skill run.** Same model, same prompt, **same scoring** — but with the Anthropic SDK harness configured with the `vegastack` Bash tool and the skills directory mounted. Same LLM-as-judge scoring.

Each prompt is run **3× per mode** and the median expectation-pass-rate is used. We report the 80% confidence interval alongside the headline.

## Per-archetype lift

The 50-prompt suite is partitioned by archetype:

| arch | tests | count |
|---|---|---|
| A1 | single-resource scaffold | 6 |
| A2 | argument lookup | 4 |
| A3 | import existing resource | 4 |
| A4 | modernise / migrate (knowledge cards) | 4 |
| A5 | soft-dep expansion (companions) | 5 |
| A6 | multi-resource single-provider | 5 |
| A7 | cross-provider topology (recipes) | 5 |
| A8 | compliance / hardening | 4 |
| A9 | cost optimisation | 3 |
| A10 | GitOps / CI-CD | 4 |
| A11 | day-2 operational | 3 |
| A12 | deprecation / recent-change (knowledge cards) | 3 |

Per-archetype lift drives content prioritization: A12 lift validates knowledge cards, A5 validates companions, A7 validates recipes, A1/A2 validate the manifest fixes (top-level vs. block args).

## CI gates

- **Nightly cron** (`cli/.github/workflows/evals.yml`): full 50-prompt run on `main`. Artifacts pushed to `vegastack/eval-history` branch and surfaced on the dashboard.
- **Per-PR smoke** (touching `src/lib/discover/**`, `src/lib/generic-pack-discover.ts`, `src/lib/registry.ts`, or `evals/**`): 10-prompt smoke (one per priority archetype). Blocks merge if **lift drops > 5pp** vs. the rolling-4-week median on `main`.
- **Release tag**: full 50-prompt run gates the npm publish.

## Public dashboard fields

`https://cli-evals.vegastack.com` renders:

- Headline lift number, weekly rolling.
- Per-archetype bar chart with 80% CIs.
- Per-knowledge-card "did the agent cite it" rate.
- Per-recipe "did the agent surface it" rate.
- Failure exemplars (anonymised) for the next content-authoring round.

## Local invocation

```bash
# Run full suite (slow; expects ANTHROPIC_API_KEY in env)
npx tsx evals/runner.ts --mode both --out evals/reports/$(date +%Y-%m-%d).json

# Run a single archetype
npx tsx evals/runner.ts --archetype A5 --mode with-skill

# Compare two report files
npx tsx evals/compare.ts evals/reports/2026-04-01.json evals/reports/2026-04-28.json
```

## Reproducibility

Each report carries:

- `registry_version` (pack version from the installed VegaStack Registry metadata)
- `cli_version` (semver from `package.json`)
- `model` (e.g. `claude-sonnet-4-7-2026-01`)
- `judge_model` (e.g. `claude-haiku-4-5-2026-01`)
- `runner_seed` (deterministic random for prompt shuffling)

Re-running with the same `registry_version` + `cli_version` + `runner_seed` should reproduce within the LLM-as-judge noise floor (~3pp).

## Methodology pitfalls (and what we do about them)

1. **LLM-as-judge noise** — week-over-week jitter ~3-8pp on identical Registry inputs. Mitigation: 3× per prompt, median, 80% CI in the headline.
2. **Prompt drift** — adding an A5 prompt mid-quarter changes the headline. Mitigation: locked suite per quarter; new prompts land in a "candidate" pool that doesn't enter the headline until the next quarter.
3. **Archetype imbalance** — A1 (6 prompts) carries more weight than A11 (3 prompts) in the macro average. Mitigation: dashboard reports both macro-average and macro-median; per-archetype bars are the primary view.
4. **Self-bias** — judging Claude with Claude. Mitigation: the judge runs on a *different* model family (Haiku vs. Sonnet) and a fixed-prompt rubric, not free-form scoring.

## When to read this file

- Before reporting "lift went down" — check whether the Registry pack/CLI/model versions match.
- When debugging a flaky prompt — `vegastack ask --entry terraform --tf-provider <provider> --debug "<prompt>"` shows you what `files[]` the harness returned, which tells you whether the failure is content (knowledge card missing) or harness (scoring miss).
- Run `vegastack ask --entry terraform --tf-provider <provider> --debug` when an eval fails unexpectedly.
