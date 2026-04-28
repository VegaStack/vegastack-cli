// `vegastack tf` runtime — native TypeScript implementation (v0.1 envelope).
//
// Thin wrapper that:
//   • resolves the bundle dir (env override or canonical $XDG location);
//   • exports the canonical input/output types;
//   • forwards everything to src/lib/discover/index.ts.

import { discover as nativeDiscover } from "./discover/index.js";
import type { DiscoverArgs as NativeArgs, DiscoverResult } from "./discover/index.js";
import { bundleDir } from "./paths.js";

export type { DiscoverFile, DiscoverResult, KnowledgeCard, RecipeMatch, ConceptAliasMatch } from "./discover/index.js";

export interface DiscoverArgs {
  query: string;
  provider?: string;
  max?: number;
  /** Pass `raw: true` to skip enrichment (smaller envelope). */
  raw?: boolean;
  /** Pass `debug: true` to include per-stage timings. */
  debug?: boolean;
  /**
   * E1: Brief mode — strips manifest_entry and example_usage, adds name field.
   * Sets mode: "brief" in the envelope. ~80% smaller envelope. Default false.
   */
  brief?: boolean;
  /**
   * E2: Full-examples mode — restores full example_usage content.
   * Default false = truncate to first HCL fence + 30-line body.
   */
  fullExamples?: boolean;
}

export async function discover(args: DiscoverArgs): Promise<DiscoverResult> {
  const nativeArgs: NativeArgs = {
    query: args.query,
    root: bundleDir(),
    enrich: !args.raw,
    debug: args.debug ?? false,
    brief: args.brief ?? false,
    fullExamples: args.fullExamples ?? false,
  };
  if (args.provider !== undefined) nativeArgs.provider = args.provider;
  if (args.max !== undefined) nativeArgs.max = args.max;
  return nativeDiscover(nativeArgs);
}
