// Canonical TypeScript contract for the v0.1 discover envelope.
// This file is THE SOURCE OF TRUTH for the response shape produced by `vegastack tf` and consumed by:
//   - the SKILL.md (E5)
//   - the eval runner (E6)
//   - the MCP server (E7)
//   - the dashboard (E8)
// E2 implements producer; E1 produces the manifest the producer consumes.
// Update this file ONLY through synchronized PRs across teams.

export type DiscoverResult =
  | ({ status: "ok" } & DiscoverOk)
  | ({ status: "ambiguous" } & DiscoverAmbiguous)
  | ({ status: "error" } & DiscoverError);

export interface DiscoverOk {
  query: string;
  provider: string;                    // ALWAYS present when status="ok"
  provider_confidence: number;         // 0..1 — closes F8
  tokens: string[];
  tiers_used: ("manifest" | "grep" | "alias" | "knowledge" | "recipe")[];
  schema_version: 1;                   // v0.1 — restart numbering, was Python's 4
  bundle_version: string;              // CalVer e.g. "2026.04.28" — from bundle/MANIFEST.json
  files: DiscoverFile[];
  knowledge: KnowledgeCard[];          // populated by loadKnowledge() — closes F3, F4
  recipes: RecipeMatch[];              // populated by loadRecipes() — closes F3, F4
  concept_aliases_used: ConceptAliasMatch[]; // populated by alias-expanded tokenize() — closes F3, F4
  citations: string[];                 // derived: files[].path ∪ knowledge[].id ∪ recipes[].id
  count: number;                       // = files.length
  intents?: IntentGroup[];             // unchanged; omitted when empty
  timings?: DiscoverTimings;           // when --debug
  warnings?: string[];                 // soft-fail surfaces (e.g. "stale bundle (>14 days)")
  /** When the discoverer auto-merged an ambiguous envelope (≤4 candidate
   *  providers), this is the sorted list of providers whose pipelines were
   *  fanned out and unioned. `provider` becomes the comma-joined list and
   *  `provider_confidence` is the mean of per-provider confidences.
   *  Omitted for single-provider responses. Closes E9 §Recs #2 / A7. */
  merged_from_providers?: string[];
  /**
   * E1: Present when --brief was passed. Consumers can branch on this field
   * without inspecting individual file objects.
   * Additive — existing callers that don't check this field are unaffected.
   */
  mode?: "brief" | "full";
}

export interface DiscoverAmbiguous {
  query: string;
  tokens: string[];
  candidate_providers: { provider: string; score: number }[];
  recipes: RecipeMatch[];              // recipes that span the candidate set still surface here
  hint: string;                        // e.g. "Use --provider <name> to disambiguate."
}

export interface DiscoverError {
  query: string;
  error: string;                       // human-readable
  code: string;                        // machine-readable: BundleMissing | ProviderUnknown | etc.
}

// ─── files[] ────────────────────────────────────────────────────────────

export interface DiscoverFile {
  path: string;                         // absolute path under bundle/<provider>/
  score: number;                        // raw, kept for --debug; do NOT depend on this
  score_norm: number;                   // 0..100, per-provider normalized — closes F7
  tier: "manifest" | "grep" | "manifest+grep";
  reasons: string[];                    // "kind:detail" e.g. "primary_resource:cloudflare_dns_record"
  manifest_entry: ManifestResourceEntry;// always present in enrich mode (default)
  example_usage: string;                // always present in enrich mode (default); E2 truncates by default
  /**
   * E1: Only present in --brief mode. The resource or data_source name
   * (e.g. "aws_s3_bucket") derived from the manifest lookup. Agents can use
   * this directly without deriving the name from the path.
   * Additive — omitted in default (non-brief) mode.
   */
  name?: string;
}

// ─── manifest entry (mirrors per-provider MANIFEST.json) ────────────────

export interface ManifestResourceEntry {
  type: "resource" | "data_source";
  file: string;                         // relative to provider dir, e.g. "r/s3_bucket.html.markdown"
  description: string;
  subcategory?: string;
  required_args: ManifestArg[];        // TOP-LEVEL ONLY — closes F1, F2
  optional_args: ManifestArg[];        // top-level only
  computed_attrs: ManifestArg[];
  blocks: Record<string, ManifestBlock>; // sub-block args live here — closes F1
  enum_values: Record<string, string[]>;
  import_syntax: ManifestImportSyntax | null;
  deprecated: boolean;
  suggested_alternative: string | null;
  recommended_companions: string[];     // hand-curated from companions.yaml — closes F10
  schema_origin: "sdkv2" | "plugin_framework" | "mixed"; // doc-shape source — fixes F2 PF detection
  sections: Record<string, number>;     // header_name → byte_offset
  sha1_prefix: string;                  // 8-char content hash for cache invalidation
}

export interface ManifestArg {
  name: string;
  description?: string;                 // optional; pulled from arg description line if available
  enum_values?: string[];               // attached at arg-level when known
}

export interface ManifestBlock {
  nesting: "single" | "list" | "set" | "map";
  required_args: ManifestArg[];
  optional_args: ManifestArg[];
}

export interface ManifestImportSyntax {
  command: string;                      // verbatim "terraform import …" line from docs
  id_format: string;                    // e.g. "<zone_id>/<dns_record_id>"
}

// ─── knowledge cards ────────────────────────────────────────────────────

export interface KnowledgeCard {
  id: string;                           // e.g. "aws-s3-native-state-locking"
  title: string;
  date_authored: string;                // ISO8601 date
  authoritative_source: string;         // URL
  providers: string[];                  // ["aws"], ["aws","cloudflare"], or ["*"] for cross-cutting
  triggers: KnowledgeTrigger[];
  overrides_training: boolean;          // signals "trust this over model memory"
  body: string;                         // markdown body (post-frontmatter)
}

export type KnowledgeTrigger =
  | { tokens: string[] }                // ALL tokens must match query tokens
  | { phrase: string };                 // substring match against original query (case-insensitive)

// ─── recipes ────────────────────────────────────────────────────────────

export interface RecipeMatch {
  id: string;                           // e.g. "scalable-backend-aws-ecs-fargate-rds-datadog"
  providers: string[];                  // sorted alphabetically
  triggers: KnowledgeTrigger[];
  scaffold_hcl: string;                 // full HCL fragment
  pitfalls: { note: string; severity?: "info" | "warn" | "error" }[];
}

// ─── concept aliases ────────────────────────────────────────────────────

export interface ConceptAliasMatch {
  phrase: string;                       // the original NL phrase that fired
  provider: string;
  matched_alias: string;                // e.g. "bot_protection"
  resources: string[];                  // resource names this alias maps to
  rule_phase?: string;                  // for Cloudflare ruleset phases, etc.
}

// ─── debug / intents (unchanged from v0.1 prototype) ────────────────────

export interface IntentGroup {
  intent: string;
  files: string[];                      // paths (subset of DiscoverOk.files[].path)
  rationale: string;
}

export interface DiscoverTimings {
  total_ms: number;
  tokenize_ms: number;
  detect_provider_ms: number;
  tier1_ms: number;
  tier2_ms: number;
  enrich_ms: number;
  load_knowledge_ms: number;
  load_recipes_ms: number;
  load_aliases_ms: number;
}
