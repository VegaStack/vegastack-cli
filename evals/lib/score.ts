// Per-expectation scoring functions for the eval runner.
// All functions return { passed: boolean, detail: string } so the runner
// can aggregate per-prompt + per-archetype + overall.

import type { KnowledgeCard, RecipeMatch, ManifestResourceEntry } from "../../src/lib/discover/types.js";

export interface ScoreResult {
  passed: boolean;
  detail: string;
}

export interface Expectation {
  id: string;
  kind:
    | "resource_present"
    | "no_resource"
    | "argument_present"
    | "argument_absent"
    | "import_syntax_match"
    | "manifest_check"
    | "cites_card"
    | "cites_recipe"
    | "cites_path";
  value: string;
}

// ─── HCL helpers ────────────────────────────────────────────────────────

/**
 * Detect a resource or data source declaration in HCL output. We look for
 * `resource "<name>" "..."` or `data "<name>" "..."`. The HCL block can be
 * inside a fenced markdown code block or inline.
 */
export function findResourceBlocks(hcl: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:^|\n)\s*(?:resource|data)\s+"([a-zA-Z0-9_]+)"\s+"[^"]+"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hcl)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

/**
 * Find arguments under a named resource block. Returns the set of argument
 * names declared (top-level only, not inside nested blocks).
 */
export function findArgsInResource(hcl: string, resourceName: string): Set<string> {
  const out = new Set<string>();
  const blockRe = new RegExp(
    `(?:resource|data)\\s+"${resourceName}"\\s+"[^"]+"\\s*\\{([\\s\\S]*?)\\n\\}`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(hcl)) !== null) {
    const body = m[1];
    if (!body) continue;
    // Top-level args are `key = value` lines. Skip nested-block opening lines
    // (`name {`). Use simple heuristic: lines whose first token is followed by `=`.
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      const mm = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/.exec(line);
      if (mm?.[1]) out.add(mm[1]);
    }
  }
  return out;
}

// ─── per-kind scoring ───────────────────────────────────────────────────

export function resource_present(hcl: string, name: string): ScoreResult {
  const blocks = findResourceBlocks(hcl);
  const passed = blocks.has(name);
  return {
    passed,
    detail: passed ? `found ${name}` : `missing ${name}; saw ${[...blocks].join(",") || "<none>"}`,
  };
}

export function no_resource(hcl: string, name: string): ScoreResult {
  const blocks = findResourceBlocks(hcl);
  const passed = !blocks.has(name);
  return {
    passed,
    detail: passed ? `confirmed absent: ${name}` : `unexpected ${name} present`,
  };
}

export function argument_present(hcl: string, resourceName: string, arg: string): ScoreResult {
  const args = findArgsInResource(hcl, resourceName);
  const passed = args.has(arg);
  return {
    passed,
    detail: passed
      ? `${resourceName}.${arg} present`
      : `${resourceName}.${arg} missing; saw ${[...args].join(",") || "<none>"}`,
  };
}

export function argument_absent(hcl: string, resourceName: string, arg: string): ScoreResult {
  const args = findArgsInResource(hcl, resourceName);
  const passed = !args.has(arg);
  return {
    passed,
    detail: passed ? `${resourceName}.${arg} absent` : `${resourceName}.${arg} unexpectedly present`,
  };
}

/**
 * Match `terraform import <type>.<name> <id>` against an expected resource
 * type. We only assert the import line exists for the type — the runner
 * pairs this with manifest_check for stricter ID-format validation when
 * a manifest entry is available.
 */
export function import_syntax_match(hcl: string, resourceType: string): ScoreResult {
  const re = new RegExp(`terraform\\s+import\\s+${resourceType}\\.[a-zA-Z0-9_-]+\\s+\\S+`, "i");
  const passed = re.test(hcl);
  return {
    passed,
    detail: passed
      ? `import line present for ${resourceType}`
      : `no \`terraform import ${resourceType}.X ID\` line found`,
  };
}

/**
 * Manifest sanity check. Two assertion shapes:
 *   - "all required_args present"        : every required_arg from the manifest entry appears in the HCL block
 *   - "no extra args beyond required+optional+blocks" : every top-level arg in the HCL block exists in the entry
 *
 * If no manifest is supplied (baseline run, or runner couldn't enrich) we
 * return passed=true with detail "skipped (no manifest)" so the eval doesn't
 * unfairly punish a baseline run that produced reasonable HCL — the headline
 * lift comes from resource_present / no_resource / cites_card.
 */
export function manifest_check(
  hcl: string,
  manifest: ManifestResourceEntry | undefined,
  kind: string
): ScoreResult {
  if (!manifest) {
    return { passed: true, detail: "skipped (no manifest)" };
  }
  const args = findArgsInResource(hcl, manifestEntryToResourceName(manifest));
  if (kind.includes("required_args")) {
    const missing = manifest.required_args.map((a) => a.name).filter((n) => !args.has(n));
    return {
      passed: missing.length === 0,
      detail: missing.length === 0 ? "all required_args present" : `missing: ${missing.join(",")}`,
    };
  }
  if (kind.includes("no extra args")) {
    const known = new Set<string>([
      ...manifest.required_args.map((a) => a.name),
      ...manifest.optional_args.map((a) => a.name),
      ...Object.keys(manifest.blocks),
    ]);
    const extras = [...args].filter((a) => !known.has(a));
    return {
      passed: extras.length === 0,
      detail: extras.length === 0 ? "no extras" : `extras: ${extras.join(",")}`,
    };
  }
  return { passed: true, detail: `unknown manifest_check kind: ${kind}` };
}

function manifestEntryToResourceName(m: ManifestResourceEntry): string {
  // The manifest entry's `file` is e.g. "r/s3_bucket.html.markdown". The
  // canonical resource name lives in the manifest's outer key, which we
  // don't have here. Fall back to deriving from the file path; callers can
  // override by wrapping with `.bind`.
  const base = (m.file.split("/").pop() ?? "").replace(/\.html\.markdown$/, "").replace(/\.markdown$/, "");
  return base;
}

// ─── citation scoring ──────────────────────────────────────────────────

/**
 * cites_card: response references a knowledge card by id. We accept either
 *   - the literal card id string anywhere in the response, or
 *   - the card's authoritative_source URL substring.
 * The knowledge_array is populated by the harness; if it's empty (baseline
 * run) we only check for the literal id substring (less strict).
 */
export function cites_card(response: string, card_id: string, knowledge_array: KnowledgeCard[]): ScoreResult {
  const hit = response.includes(card_id);
  if (hit) return { passed: true, detail: `cited "${card_id}" by id` };
  const card = knowledge_array.find((k) => k.id === card_id);
  if (card?.authoritative_source && response.includes(card.authoritative_source)) {
    return { passed: true, detail: `cited via source URL` };
  }
  return { passed: false, detail: `did not cite ${card_id}` };
}

export function cites_recipe(response: string, recipe_id: string, recipe_array: RecipeMatch[]): ScoreResult {
  if (response.includes(recipe_id)) return { passed: true, detail: `cited "${recipe_id}" by id` };
  // Best-effort: look for the recipe's first scaffold line as a unique fingerprint.
  const recipe = recipe_array.find((r) => r.id === recipe_id);
  if (recipe?.scaffold_hcl) {
    const head = recipe.scaffold_hcl.split("\n").find((l) => l.trim().length > 30);
    if (head && response.includes(head.trim())) {
      return { passed: true, detail: `cited via scaffold fingerprint` };
    }
  }
  return { passed: false, detail: `did not cite ${recipe_id}` };
}

export function cites_path(response: string, path_substring: string): ScoreResult {
  const passed = response.includes(path_substring);
  return {
    passed,
    detail: passed ? `cited path "${path_substring}"` : `did not cite path "${path_substring}"`,
  };
}

// ─── headline aggregation ──────────────────────────────────────────────

export interface PromptScore {
  id: string;
  archetype: string;
  passed: number;
  total: number;
  pct: number;
  expectations: (ScoreResult & { id: string; kind: string; value: string })[];
}

export interface ReportSummary {
  baseline_pct: number;
  with_skill_pct: number;
  lift_pct: number;
  per_archetype: Record<string, { baseline_pct: number; with_skill_pct: number; lift_pct: number }>;
}

/** Lift formula per spec: (with_skill - baseline) / max(0.01, 1 - baseline). */
export function computeLift(baseline: number, withSkill: number): number {
  return (withSkill - baseline) / Math.max(0.01, 1 - baseline);
}

export function summarize(
  baseline: PromptScore[],
  withSkill: PromptScore[]
): ReportSummary {
  const overall = (rows: PromptScore[]) => {
    const t = rows.reduce((a, r) => a + r.total, 0);
    const p = rows.reduce((a, r) => a + r.passed, 0);
    return t === 0 ? 0 : p / t;
  };
  const byArch = (rows: PromptScore[]) => {
    const out: Record<string, { passed: number; total: number }> = {};
    for (const r of rows) {
      const a = (out[r.archetype] ??= { passed: 0, total: 0 });
      a.passed += r.passed;
      a.total += r.total;
    }
    return out;
  };
  const baseB = byArch(baseline);
  const withB = byArch(withSkill);
  const archs = new Set([...Object.keys(baseB), ...Object.keys(withB)]);
  const per_archetype: ReportSummary["per_archetype"] = {};
  for (const a of archs) {
    const bp = baseB[a]?.total ? (baseB[a]?.passed ?? 0) / (baseB[a]?.total ?? 1) : 0;
    const wp = withB[a]?.total ? (withB[a]?.passed ?? 0) / (withB[a]?.total ?? 1) : 0;
    per_archetype[a] = {
      baseline_pct: bp,
      with_skill_pct: wp,
      lift_pct: computeLift(bp, wp),
    };
  }
  const baseline_pct = overall(baseline);
  const with_skill_pct = overall(withSkill);
  return {
    baseline_pct,
    with_skill_pct,
    lift_pct: computeLift(baseline_pct, with_skill_pct),
    per_archetype,
  };
}
