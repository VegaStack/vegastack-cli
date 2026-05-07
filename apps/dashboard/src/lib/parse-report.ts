/**
 * Eval report types and helpers — re-exported from the canonical contract at
 * docs/contracts/eval-report.ts so the runner (`evals/runner.ts`) and the
 * dashboard never drift.
 *
 * Imported via the `@contracts/*` tsconfig path alias (see
 * apps/dashboard/tsconfig.json) so the dashboard does not reach four levels
 * up into the monorepo with a brittle relative path.
 *
 * Closes audit punch-list #2: previously this file owned a private copy of
 * the types that didn't match the runner's emitted shape, so `parseReport()`
 * silently returned null and the dashboard fell back to the Registry-provided fixture.
 */

export type {
  Archetype,
  ExpectationKind,
  Expectation,
  ExpectationResult,
  PromptResult,
  ArchetypeRollup,
  KnowledgeCardHit,
  RecipeHit,
  EvalReport,
} from "@contracts/eval-report";

export {
  ARCHETYPE_LABELS,
  computeLift,
  parseReport,
  formatLiftPct,
  formatPct,
  sortArchetypes,
} from "@contracts/eval-report";
