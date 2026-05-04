// CANONICAL: ../../../../docs/contracts/discover-types.ts
//
// Re-export pattern matches apps/dashboard/src/lib/parse-report.ts (sibling app convention).
// Do NOT hand-mirror types here — add new shared types to the canonical contract instead.
// Only MCP-server-internal types that have no place in the contract are defined locally below.

export type {
  DiscoverResult,
  DiscoverOk,
  DiscoverAmbiguous,
  DiscoverError,
  DiscoverFile,
  ManifestResourceEntry,
  ManifestArg,
  ManifestBlock,
  ManifestImportSyntax,
  KnowledgeCard,
  KnowledgeTrigger,
  RecipeMatch,
  ConceptAliasMatch,
  IntentGroup,
  DiscoverTimings,
} from "../../../../docs/contracts/discover-types";

// ─── MCP-server-internal types (on-disk per-provider MANIFEST.json) ──────────
// These are not part of the shared discover-types contract because they
// describe the raw Registry pack layout read by r2-registry.ts, not the API envelope.

export interface ProviderManifest {
  manifest_schema_version?: number;
  provider?: string;
  registry_version?: string;
  upstream_sha?: string;
  synced_at?: string;
  resources: Record<string, import("../../../../docs/contracts/discover-types").ManifestResourceEntry>;
  data_sources: Record<string, import("../../../../docs/contracts/discover-types").ManifestResourceEntry>;
  guides?: Record<string, unknown>;
  subcategory_useful?: boolean;
  subcategory_trust?: Record<string, number>;
  subcategories?: Record<string, string[]>;
  argument_index?: Record<string, string[]>;
  attribute_index?: Record<string, string[]>;
  description_token_index?: Record<string, string[]>;
  example_tokens?: Record<string, string[]>;
  resource_bigrams?: Record<string, string[]>;
  service_aliases?: Record<string, string[]>;
  primary_resources?: Record<string, string>;
  subcat_keywords?: Record<string, string>;
  generic_args_downweight?: Record<string, number>;
}

export interface TerraformRootManifest {
  manifest_schema_version?: number;
  registry_version?: string;
  providers?: string[] | Record<string, unknown>;
  generated_at?: string;
}
