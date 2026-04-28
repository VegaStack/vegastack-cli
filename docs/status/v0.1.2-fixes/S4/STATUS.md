# S4 Refactor Status

## Before
- `apps/mcp/src/lib/types.ts` owned 16 hand-mirrored type definitions locally:
  `DiscoverResult`, `DiscoverOk`, `DiscoverAmbiguous`, `DiscoverError`,
  `DiscoverFile`, `ManifestResourceEntry`, `ManifestArg`, `ManifestBlock`,
  `ManifestImportSyntax`, `KnowledgeCard`, `KnowledgeTrigger`, `RecipeMatch`,
  `ConceptAliasMatch`, `IntentGroup`, `DiscoverTimings`
  plus 2 MCP-internal types: `ProviderManifest`, `BundleRootManifest`
- Missing `merged_from_providers?: string[]` field (added by P1 to canonical contract)

## After
- 16 shared types are now re-exported from `docs/contracts/discover-types.ts` via:
  `export type { ... } from "../../../../docs/contracts/discover-types"`
- `merged_from_providers?: string[]` is now visible to all `apps/mcp` consumers
  (inherited from `DiscoverOk` in the canonical contract)
- 2 MCP-server-internal types (`ProviderManifest`, `BundleRootManifest`) kept
  defined locally — they describe raw bundle-on-disk layout, not the API envelope,
  and are not present in the canonical contract

## tsconfig.json change
None required. Relative path imports from `src/lib/` to `docs/contracts/` resolve
correctly without adding `../../docs/contracts` to `include` (same behavior as
`apps/dashboard/src/lib/parse-report.ts` which uses the identical 4-level-up path).

## Build + Test
- `npm run build` exit code: 0 (tsc --noEmit, no errors)
- `npm test` exit code: 0 (19/19 tests passed, 5 test files)
