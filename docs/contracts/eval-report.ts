// Canonical TypeScript contract for the eval-report JSON shape produced by
// Produced by `evals/runner.ts` and consumed by `apps/dashboard/src/lib/parse-report.ts`.
//
// Closes punch-list #2 (A4 must-fix): the two consumers were defining
// incompatible shapes; `parseReport()` returned null on every real run and the
// dashboard silently fell back to its Registry-provided fixture. This file is now THE
// source of truth — both consumers import from here.
//
// One report per nightly run. Stored in R2 at:
//   cli-registry.vegastack.com/cli/evals/reports/<YYYY-MM-DD>.json
//
// Lift formula (per v1-plan §4):
//   lift = (with_skill_pct - baseline_pct) / max(0.01, 1 - baseline_pct)

export type Archetype =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "A7"
  | "A8"
  | "A9"
  | "A10"
  | "A11"
  | "A12";

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  A1: "Single-resource scaffold",
  A2: "Argument lookup",
  A3: "Import existing",
  A4: "Modernise / migrate",
  A5: "Soft-dep expansion",
  A6: "Multi-resource (single provider)",
  A7: "Cross-provider topology",
  A8: "Compliance / hardening",
  A9: "Cost optimisation",
  A10: "GitOps / CI-CD",
  A11: "Day-2 operational",
  A12: "Recent change / deprecation",
};

export type ExpectationKind =
  | "resource_present"
  | "no_resource"
  | "argument_present"
  | "argument_absent"
  | "import_syntax_match"
  | "manifest_check"
  | "cites_card"
  | "cites_recipe"
  | "cites_path";

export interface Expectation {
  id: string;
  kind: ExpectationKind;
  value: string;
}

export interface ExpectationResult {
  id: string;
  kind: ExpectationKind;
  passed: boolean;
  /** Optional rationale from the LLM judge (kept short for the UI). */
  reason?: string;
}

export interface PromptResult {
  id: string;
  archetype: Archetype;
  title: string;
  prompt: string;
  expectations: ExpectationResult[];
  baseline: {
    pass_rate: number; // 0..1 across expectations
    tool_calls: number;
    cited_cards: string[];
    cited_recipes: string[];
  };
  with_skill: {
    pass_rate: number;
    tool_calls: number;
    cited_cards: string[];
    cited_recipes: string[];
  };
  /** Per-prompt lift on the same closed-error formula as the headline. */
  lift: number;
  /** Set when the with-skill response failed at least one expectation. */
  failure_excerpt?: string;
}

export interface ArchetypeRollup {
  archetype: Archetype;
  prompt_count: number;
  baseline_pass_rate: number;
  with_skill_pass_rate: number;
  lift: number;
}

export interface KnowledgeCardHit {
  id: string;
  title: string;
  expected_in_prompts: number;
  cited_in_prompts: number;
  hit_rate: number; // 0..1
}

export interface RecipeHit {
  id: string;
  expected_in_prompts: number;
  cited_in_prompts: number;
  hit_rate: number;
}

export interface EvalReport {
  schema_version: 1;
  date: string; // YYYY-MM-DD
  registry_version: string; // CalVer e.g. "2026.04.28"
  cli_version: string; // semver e.g. "0.1.11"
  model: string; // e.g. "claude-sonnet-4-7"
  prompt_count: number;
  /** Headline: fraction of remaining error closed. -1..1. */
  lift: number;
  baseline_pass_rate: number;
  with_skill_pass_rate: number;
  archetypes: ArchetypeRollup[];
  knowledge_cards: KnowledgeCardHit[];
  recipes: RecipeHit[];
  prompts: PromptResult[];
  /** Wall-clock seconds for the full run. */
  duration_s: number;
}

/**
 * Compute lift on the public formula. Centralised so the dashboard,
 * `evals/runner.ts`, and the API endpoint never disagree.
 */
export function computeLift(baseline: number, withSkill: number): number {
  return (withSkill - baseline) / Math.max(0.01, 1 - baseline);
}

/**
 * Defensive parser — never throws on a slightly-off report. Returns
 * `null` on irrecoverable shapes so the UI can show a "no data" panel.
 */
export function parseReport(raw: unknown): EvalReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.date !== "string" || typeof r.lift !== "number") return null;
  if (!Array.isArray(r.prompts) || !Array.isArray(r.archetypes)) return null;
  return r as unknown as EvalReport;
}

/** Format lift as a public-facing percent. `0.42` → `"+42%"`. */
export function formatLiftPct(lift: number): string {
  const rounded = Math.round(lift * 100);
  if (Number.isNaN(rounded)) return "—";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Format a 0..1 pass rate as a percent. */
export function formatPct(value: number): string {
  if (Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Sorted archetypes A1..A12 for stable bar-chart ordering. */
export function sortArchetypes(rows: ArchetypeRollup[]): ArchetypeRollup[] {
  const order: Archetype[] = [
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "A8",
    "A9",
    "A10",
    "A11",
    "A12",
  ];
  const idx = new Map(order.map((a, i) => [a, i]));
  return [...rows].sort(
    (a, b) => (idx.get(a.archetype) ?? 99) - (idx.get(b.archetype) ?? 99),
  );
}
