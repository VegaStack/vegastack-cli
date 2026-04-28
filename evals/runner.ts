#!/usr/bin/env node
// evals/runner.ts — baseline-vs-skill eval runner for vegastack-cli.
//
// Usage:
//   tsx evals/runner.ts --mode both --concurrency 4 --output evals/reports/2026-04-28.json
//   tsx evals/runner.ts --mode baseline --model claude-opus-4-7 --limit 5
//   tsx evals/runner.ts --mode with-skill --filter A12  (run all A12 prompts)
//
// Flags:
//   --mode baseline|with-skill|both     (required)
//   --model <model-id>                  default: claude-opus-4-7
//   --concurrency <n>                   default: 4
//   --output <path>                     default: evals/reports/<ISO-date>.json
//   --limit <n>                         only run first N prompts (for smoke)
//   --filter <prefix>                   only run prompts whose archetype matches
//   --evals <path>                      path to evals.json (default: evals/evals.json)
//   --skill <path>                      path to SKILL.md (default: skills/vegastack/SKILL.md)
//   --vegastack <path>                       path to `vegastack` binary (with-skill only)
//   --mock                              use mock fixtures instead of calling Anthropic
//
// CI surface:
//   --pr-smoke   convenience: --mode both --filter "" --limit 12 --output /tmp/eval-smoke.json
//   --nightly    convenience: --mode both --output evals/reports/<date>.json

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resource_present,
  no_resource,
  argument_present,
  argument_absent,
  import_syntax_match,
  manifest_check,
  cites_card,
  cites_recipe,
  cites_path,
  summarize,
  type Expectation,
  type PromptScore,
  type ScoreResult,
} from "./lib/score.js";
import {
  mockRun,
  runPromptOnce,
  type RunResult,
} from "./lib/anthropic-runner.js";
import type { KnowledgeCard, RecipeMatch, ManifestResourceEntry } from "../src/lib/discover/types.js";
import type {
  Archetype,
  EvalReport,
  ArchetypeRollup,
  PromptResult,
  KnowledgeCardHit,
  RecipeHit,
} from "../docs/contracts/eval-report.js";

interface EvalEntry {
  id: string;
  archetype: string;
  title: string;
  prompt: string;
  expectations: Expectation[];
  tags?: string[];
  max_tool_calls_with_skill?: number;
  max_tool_calls_baseline?: number;
}

interface EvalsFile {
  schema_version: number;
  skill_name: string;
  evals: EvalEntry[];
}

interface CliArgs {
  mode: "baseline" | "with-skill" | "both";
  model: string;
  concurrency: number;
  output: string;
  limit: number | null;
  filter: string;
  evals: string;
  skill: string;
  vegastack: string | null;
  mock: boolean;
  mockFixtures: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    mode: "both",
    model: "claude-opus-4-7",
    concurrency: 4,
    output: defaultReportPath(),
    limit: null,
    filter: "",
    evals: resolve(here(), "evals.json"),
    skill: resolve(here(), "..", "skills", "vegastack", "SKILL.md"),
    vegastack: null,
    mock: false,
    mockFixtures: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--mode" && next) { out.mode = next as CliArgs["mode"]; i++; }
    else if (a === "--model" && next) { out.model = next; i++; }
    else if (a === "--concurrency" && next) { out.concurrency = Math.max(1, parseInt(next, 10)); i++; }
    else if (a === "--output" && next) { out.output = next; i++; }
    else if (a === "--limit" && next) { out.limit = Math.max(1, parseInt(next, 10)); i++; }
    else if (a === "--filter" && next) { out.filter = next; i++; }
    else if (a === "--evals" && next) { out.evals = next; i++; }
    else if (a === "--skill" && next) { out.skill = next; i++; }
    else if (a === "--vegastack" && next) { out.vegastack = next; i++; }
    else if (a === "--mock") { out.mock = true; }
    else if (a === "--mock-fixtures" && next) { out.mock = true; out.mockFixtures = next; i++; }
    else if (a === "--pr-smoke") { out.mode = "both"; out.limit = 12; out.output = "/tmp/eval-smoke.json"; }
    else if (a === "--nightly") { out.mode = "both"; }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
  }
  return out;
}

function here(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function defaultReportPath(): string {
  const d = new Date().toISOString().slice(0, 10);
  return resolve(here(), "reports", `${d}.json`);
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    `evals/runner.ts — vegastack-cli eval runner\n\n` +
      `--mode baseline|with-skill|both   (default: both)\n` +
      `--model <id>                      (default: claude-opus-4-7)\n` +
      `--concurrency <n>                 (default: 4)\n` +
      `--output <path>                   (default: evals/reports/<date>.json)\n` +
      `--limit <n>                       only run first N\n` +
      `--filter <archetype>              only run prompts whose archetype starts with this\n` +
      `--evals <path>                    (default: evals/evals.json)\n` +
      `--skill <path>                    (default: skills/vegastack/SKILL.md)\n` +
      `--vegastack <path>                     path to vegastack bin for with-skill mode\n` +
      `--mock                            use deterministic mock instead of Anthropic API\n` +
      `--pr-smoke                        12-prompt smoke for PR CI\n` +
      `--nightly                         convenience for nightly cron\n`
  );
}

// ─── per-prompt scoring ────────────────────────────────────────────────

interface ScoringContext {
  knowledge: KnowledgeCard[]; // populated by `vegastack tf` envelope when available; empty for baseline
  recipes: RecipeMatch[];
  manifestByResource: Map<string, ManifestResourceEntry>;
}

function scoreExpectations(
  evalEntry: EvalEntry,
  run: RunResult,
  ctx: ScoringContext
): PromptScore {
  const results: PromptScore["expectations"] = [];
  const hcl = run.response_text;
  for (const e of evalEntry.expectations) {
    let r: ScoreResult;
    switch (e.kind) {
      case "resource_present":
        r = resource_present(hcl, e.value);
        break;
      case "no_resource":
        r = no_resource(hcl, e.value);
        break;
      case "argument_present": {
        const [res, arg] = e.value.split(".");
        r = res && arg ? argument_present(hcl, res, arg) : { passed: false, detail: "bad value (expected resource.arg)" };
        break;
      }
      case "argument_absent": {
        const [res, arg] = e.value.split(".");
        r = res && arg ? argument_absent(hcl, res, arg) : { passed: false, detail: "bad value (expected resource.arg)" };
        break;
      }
      case "import_syntax_match":
        r = import_syntax_match(hcl, e.value);
        break;
      case "manifest_check": {
        // Try to grab any resource_present expectation in the same prompt to
        // pick a manifest entry. This is best-effort.
        const candidate = evalEntry.expectations.find(
          (x) => x.kind === "resource_present"
        );
        const manifest = candidate ? ctx.manifestByResource.get(candidate.value) : undefined;
        r = manifest_check(hcl, manifest, e.value);
        break;
      }
      case "cites_card":
        r = cites_card(hcl, e.value, ctx.knowledge);
        break;
      case "cites_recipe":
        r = cites_recipe(hcl, e.value, ctx.recipes);
        break;
      case "cites_path":
        r = cites_path(hcl, e.value);
        break;
      default: {
        const _exhaustive: never = e.kind;
        r = { passed: false, detail: `unknown kind ${String(_exhaustive)}` };
      }
    }
    results.push({ ...r, id: e.id, kind: e.kind, value: e.value });
  }
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  return {
    id: evalEntry.id,
    archetype: evalEntry.archetype,
    passed,
    total,
    pct: total === 0 ? 0 : passed / total,
    expectations: results,
  };
}

// ─── concurrency-bounded executor ──────────────────────────────────────

async function pmap<T, U>(items: T[], n: number, fn: (item: T, idx: number) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array<U>(items.length);
  let cursor = 0;
  const total = items.length;
  const workers = Array.from({ length: Math.min(n, total) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= total) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── entry point ───────────────────────────────────────────────────────

async function main(): Promise<number> {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const file = JSON.parse(await readFile(args.evals, "utf8")) as EvalsFile;
  let evals = file.evals;
  if (args.filter) evals = evals.filter((e) => e.archetype.startsWith(args.filter));
  if (args.limit) evals = evals.slice(0, args.limit);

  // eslint-disable-next-line no-console
  console.log(`[runner] mode=${args.mode} model=${args.model} count=${evals.length} concurrency=${args.concurrency}`);

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  type AnthropicClient = InstanceType<(typeof import("@anthropic-ai/sdk"))["default"]>;
  let client: AnthropicClient | null = null;
  if (!args.mock) {
    if (!process.env.ANTHROPIC_API_KEY) {
      // eslint-disable-next-line no-console
      console.warn("[runner] ANTHROPIC_API_KEY not set — falling back to --mock");
      args.mock = true;
    } else {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  }

  const ctx: ScoringContext = {
    knowledge: [], // baseline; with-skill ctx is per-prompt and overrides via merge
    recipes: [],
    manifestByResource: new Map(),
  };

  // Optional mock-fixtures map keyed by eval id. Lets us produce a deterministic
  // baseline-vs-skill divergence without hitting the real API.
  let fixtures: Record<string, { baseline: string; "with-skill": string }> = {};
  if (args.mockFixtures) {
    fixtures = JSON.parse(await readFile(args.mockFixtures, "utf8")) as Record<
      string,
      { baseline: string; "with-skill": string }
    >;
  }

  const baseline: PromptScore[] = [];
  const withSkill: PromptScore[] = [];

  if (args.mode === "baseline" || args.mode === "both") {
    const runs = await pmap(evals, args.concurrency, async (e) => {
      const r = args.mock || !client
        ? mockRun(e.id, "baseline", fixtures)
        : await runPromptOnce(e.prompt, {
            client,
            model: args.model,
            mode: "baseline",
            skillBodyPath: args.skill,
            ...(args.vegastack ? { vegaBin: args.vegastack } : {}),
          });
      return scoreExpectations(e, r, ctx);
    });
    baseline.push(...runs);
  }
  if (args.mode === "with-skill" || args.mode === "both") {
    const runs = await pmap(evals, args.concurrency, async (e) => {
      const r = args.mock || !client
        ? mockRun(e.id, "with-skill", fixtures)
        : await runPromptOnce(e.prompt, {
            client,
            model: args.model,
            mode: "with-skill",
            skillBodyPath: args.skill,
            ...(args.vegastack ? { vegaBin: args.vegastack } : {}),
          });
      return scoreExpectations(e, r, ctx);
    });
    withSkill.push(...runs);
  }

  // For modes that don't run both, fill the missing side with zero-scores so
  // summarize() still produces a per-archetype map.
  const baselineRows = args.mode === "with-skill" ? evals.map((e) => zeroScore(e)) : baseline;
  const skillRows = args.mode === "baseline" ? evals.map((e) => zeroScore(e)) : withSkill;
  const summary = summarize(baselineRows, skillRows);
  const durationS = (Date.now() - startedAt) / 1000;

  // Build the canonical EvalReport shape (closes audit punch-list #2 — the
  // dashboard's parseReport() previously returned null on every real run).
  const report: EvalReport = buildReport({
    evals,
    baselineRows,
    skillRows,
    summary,
    model: args.model,
    durationS,
  });

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(report, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `[runner] baseline_pct=${(summary.baseline_pct * 100).toFixed(1)}%  ` +
      `with_skill_pct=${(summary.with_skill_pct * 100).toFixed(1)}%  ` +
      `lift_pct=${(summary.lift_pct * 100).toFixed(1)}%  → ${args.output}`
  );
  return 0;
}

/**
 * Translate the runner's PromptScore[] outputs into the canonical EvalReport
 * shape consumed by `apps/dashboard/src/lib/parse-report.ts`.
 *
 * v0.1: knowledge_cards and recipes hit-rate fields are computed from the
 * `cites_card` / `cites_recipe` expectations. tool_calls / cited_cards /
 * cited_recipes per-prompt fields default to 0 / [] until the Anthropic
 * runner threads them through (post-v0.1 polish).
 */
function buildReport(input: {
  evals: EvalEntry[];
  baselineRows: PromptScore[];
  skillRows: PromptScore[];
  summary: ReturnType<typeof summarize>;
  model: string;
  durationS: number;
}): EvalReport {
  const { evals, baselineRows, skillRows, summary, model, durationS } = input;
  const baselineById = new Map(baselineRows.map((r) => [r.id, r]));
  const skillById = new Map(skillRows.map((r) => [r.id, r]));

  // Per-prompt rollup
  const prompts: PromptResult[] = evals.map((e) => {
    const b = baselineById.get(e.id);
    const w = skillById.get(e.id);
    const bRate = b?.pct ?? 0;
    const wRate = w?.pct ?? 0;
    const expectations = (w?.expectations ?? b?.expectations ?? []).map((x) => ({
      id: x.id,
      kind: x.kind as PromptResult["expectations"][number]["kind"],
      passed: x.passed,
      reason: x.detail,
    }));
    return {
      id: e.id,
      archetype: e.archetype as Archetype,
      title: e.title,
      prompt: e.prompt,
      expectations,
      baseline: { pass_rate: bRate, tool_calls: 0, cited_cards: [], cited_recipes: [] },
      with_skill: { pass_rate: wRate, tool_calls: 0, cited_cards: [], cited_recipes: [] },
      lift: (wRate - bRate) / Math.max(0.01, 1 - bRate),
    };
  });

  // Per-archetype rollup
  const archetypeOrder: Archetype[] = [
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12",
  ];
  const archetypeCount = new Map<string, number>();
  for (const e of evals) {
    archetypeCount.set(e.archetype, (archetypeCount.get(e.archetype) ?? 0) + 1);
  }
  const archetypes: ArchetypeRollup[] = archetypeOrder
    .filter((a) => summary.per_archetype[a])
    .map((a) => {
      const x = summary.per_archetype[a]!;
      return {
        archetype: a,
        prompt_count: archetypeCount.get(a) ?? 0,
        baseline_pass_rate: x.baseline_pct,
        with_skill_pass_rate: x.with_skill_pct,
        lift: x.lift_pct,
      };
    });

  // Knowledge-card / recipe hit rates from cites_card / cites_recipe expectations
  const cardExp: Map<string, { expected: number; cited: number }> = new Map();
  const recipeExp: Map<string, { expected: number; cited: number }> = new Map();
  for (const e of evals) {
    for (const x of e.expectations) {
      if (x.kind === "cites_card") {
        const c = cardExp.get(x.value) ?? { expected: 0, cited: 0 };
        c.expected += 1;
        const w = skillById.get(e.id);
        if (w?.expectations.find((er) => er.id === x.id)?.passed) c.cited += 1;
        cardExp.set(x.value, c);
      } else if (x.kind === "cites_recipe") {
        const r = recipeExp.get(x.value) ?? { expected: 0, cited: 0 };
        r.expected += 1;
        const w = skillById.get(e.id);
        if (w?.expectations.find((er) => er.id === x.id)?.passed) r.cited += 1;
        recipeExp.set(x.value, r);
      }
    }
  }
  const knowledge_cards: KnowledgeCardHit[] = [...cardExp.entries()].map(([id, c]) => ({
    id,
    title: id, // resolved from disk in a future polish; ID is fine for v0.1 dashboard
    expected_in_prompts: c.expected,
    cited_in_prompts: c.cited,
    hit_rate: c.expected === 0 ? 0 : c.cited / c.expected,
  }));
  const recipes: RecipeHit[] = [...recipeExp.entries()].map(([id, r]) => ({
    id,
    expected_in_prompts: r.expected,
    cited_in_prompts: r.cited,
    hit_rate: r.expected === 0 ? 0 : r.cited / r.expected,
  }));

  return {
    schema_version: 1,
    date: new Date().toISOString().slice(0, 10),
    bundle_version: process.env.VEGASTACK_BUNDLE_VERSION ?? "unknown",
    cli_version: process.env.npm_package_version ?? "0.1.0",
    model,
    prompt_count: evals.length,
    lift: summary.lift_pct,
    baseline_pass_rate: summary.baseline_pct,
    with_skill_pass_rate: summary.with_skill_pct,
    archetypes,
    knowledge_cards,
    recipes,
    prompts,
    duration_s: Math.round(durationS * 100) / 100,
  };
}

function zeroScore(e: EvalEntry): PromptScore {
  return {
    id: e.id,
    archetype: e.archetype,
    passed: 0,
    total: e.expectations.length,
    pct: 0,
    expectations: e.expectations.map((x) => ({
      id: x.id,
      kind: x.kind,
      value: x.value,
      passed: false,
      detail: "mode skipped",
    })),
  };
}

// ESM entry: only run when invoked directly.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[runner] fatal:", e);
      process.exit(1);
    });
}

export { main, parseArgs, scoreExpectations, pmap };
