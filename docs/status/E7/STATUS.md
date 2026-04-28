# E7 — Cloudflare Remote MCP server (apps/mcp/) — STATUS

Status: **READY TO COMMIT**
Wall-clock: ~110 min
Date: 2026-04-28

## Summary

Built a complete `apps/mcp/` Cloudflare Workers project that exposes the
`vegastack tf` discovery harness (and four supporting operations) as a Remote MCP
server reachable over both StreamableHTTP (`/mcp`, modern clients) and SSE
(`/sse`, legacy clients via `mcp-remote` / Claude Desktop). The server uses
the official Cloudflare Agents SDK (`agents` npm pkg, `McpAgent` base class)
backed by a Durable Object for per-session state.

Five MCP tools shipped: `tf_discover`, `tf_get_manifest`, `tf_list_providers`,
`tf_get_knowledge_card`, `tf_get_recipe`. Each returns the canonical envelope
specified in `/tmp/synthesis/contracts/discover-types.ts`. The discover stub
also returns `knowledge[]` / `recipes[]` / `concept_aliases_used[]` as empty
arrays today — they fill in once E2 ships the loaders and E3 publishes the
content.

Bundle access goes through an R2 binding (`BUNDLE` → `vegastack-bundle`) with
in-memory + KV caching and a public CDN fallback for `wrangler dev` runs that
don't have R2 provisioned. CORS is wide-open (v0.1 anonymous public read).

## Files added (LOC)

```
apps/mcp/.dev.vars.example                                +14
apps/mcp/.gitignore                                       +6
apps/mcp/README.md                                        +177
apps/mcp/package.json                                     +30
apps/mcp/wrangler.toml                                    +66
apps/mcp/tsconfig.json                                    +24
apps/mcp/vitest.config.ts                                 +18
apps/mcp/worker-configuration.d.ts                        +26
apps/mcp/src/index.ts                                     +304
apps/mcp/src/lib/discover.ts                              +355
apps/mcp/src/lib/r2-bundle.ts                             +150
apps/mcp/src/lib/types.ts                                 +171
apps/mcp/src/tools/_shared.ts                             +24
apps/mcp/src/tools/tf_discover.ts                         +51
apps/mcp/src/tools/tf_get_knowledge_card.ts               +209
apps/mcp/src/tools/tf_get_manifest.ts                     +60
apps/mcp/src/tools/tf_get_recipe.ts                       +155
apps/mcp/src/tools/tf_list_providers.ts                   +30
apps/mcp/tests/_fixtures.ts                               +237
apps/mcp/tests/tools/tf_discover.test.ts                  +90
apps/mcp/tests/tools/tf_get_knowledge_card.test.ts        +47
apps/mcp/tests/tools/tf_get_manifest.test.ts              +40
apps/mcp/tests/tools/tf_get_recipe.test.ts                +37
apps/mcp/tests/tools/tf_list_providers.test.ts            +18
                                                  TOTAL: 2,339 LOC (excl. lockfile)
```

No files outside `apps/mcp/` were touched. The CLI repo's existing layout is
unchanged.

## Web research (mandatory before installing)

| package | latest stable on 2026-04-28 | pinned | source |
|---|---|---|---|
| `agents` (Cloudflare Agents SDK) | 0.11.6 | `0.11.6` | npmjs.com (published 12h before this run) |
| `@modelcontextprotocol/sdk` | 1.29.0 | `1.29.0` | npm view, MCP TS SDK GitHub |
| `wrangler` | 4.85.0 | `4.85.0` | npm view |
| `zod` | 4.3.6 | `4.3.6` | npm view |
| `@cloudflare/workers-types` | 4.20260426.1 | `4.20260426.1` | npm view |
| `@cloudflare/vitest-pool-workers` | 0.15.0 | `0.15.0` | npm view |
| `vitest` | 4.1.5 | `4.1.5` | npm view |
| `typescript` | 6.0.3 | `6.0.3` | npm view |

Docs consulted (verbatim, top-of-page reads):

* https://developers.cloudflare.com/agents/guides/remote-mcp-server/ — confirmed `McpAgent.serve("/mcp")` (StreamableHTTP) and `McpAgent.serveSSE("/sse")` (legacy) pattern.
* https://developers.cloudflare.com/agents/api-reference/mcp-agent-api/ — confirmed exact imports (`agents/mcp` for `McpAgent`, `@modelcontextprotocol/sdk/server/mcp.js` for `McpServer`) and `init()` + `server.tool()` API.
* https://developers.cloudflare.com/agents/api-reference/configuration/ — confirmed `wrangler.jsonc` shape with `durable_objects.bindings` + `migrations` `new_sqlite_classes`.
* https://github.com/cloudflare/agents — confirmed the `agents` package replaced the deprecated `agents-sdk`.

## Verification

* `npm install` — 0 vulnerabilities, 251 packages added (28s)
* `npm run build` (`tsc --noEmit`) — exit 0, no diagnostics
* `npm test` (`vitest run`) — 19/19 tests pass across 5 files, 200ms
* `npm run dev` (`wrangler dev`) — boots cleanly on port 8788
* `GET /health` — 200 (when R2 reachable) / 503 (clean degradation when not)
* `GET /version` — 200, returns `{name, version, bundle_version, schema_version: 1}`
* `GET /tools` — 200, returns the 5 tool names
* `POST /mcp` initialize — 200 SSE, returns `protocolVersion: 2025-06-18`, `serverInfo: {name: "vegastack-mcp", version: "0.1.0"}`, sets `mcp-session-id` header
* `POST /mcp` tools/list (with session) — 200, returns full Zod-derived JSON Schema for all 5 tools
* `POST /mcp` tools/call `tf_discover` — 200, returns canonical `DiscoverResult` envelope (status='error' code='BundleMissing' in the no-R2 dev case, which is the correct shape per /tmp/synthesis/contracts/discover-types.ts)

## Cross-team contract — what the MCP server promises others

* **Production endpoints (post-deploy):**
  * `https://mcp.vegastack.com/mcp` — StreamableHTTP (modern: Codex, Continue, Cline, Aider via mcp-remote)
  * `https://mcp.vegastack.com/sse`  — SSE (legacy: Claude Desktop, mcp-remote)
* **Tool surface:** the 5 names above. Schemas live in `apps/mcp/src/tools/`.
* **Envelope:** mirrors `/tmp/synthesis/contracts/discover-types.ts` exactly. The `DiscoverResult` produced by `tf_discover` is identical (modulo the empty `knowledge[]` / `recipes[]` / `concept_aliases_used[]`) to what E2's CLI implementation will return.
* **R2 layout consumed:** `bundle/MANIFEST.json`, `bundle/<provider>/MANIFEST.json`, `bundle/knowledge/<id>.md`, `bundle/recipes/<id>.toml`. E4 owns publishing this layout.

## Telegram for E5

E5 — your `.claude-plugin/plugin.json` and Continue config snippet should reference:

```jsonc
{
  "mcpServers": {
    "vegastack": {
      "transport": { "type": "sse", "url": "https://mcp.vegastack.com/sse" }
    }
  }
}
```

(SSE for Claude Desktop / Code; modern clients can use `streamable-http` + `/mcp`.)
Full integration snippets for Codex / Cursor / Continue / Aider live in `apps/mcp/README.md`.

## Telegram for E8 (dashboard)

`/health` returns `{ok, bundle_reachable, provider_count, bundle_version}` (200/503). `/version` returns `{name, version, bundle_version, schema_version}` (always 200). Use these for the dashboard's MCP-uptime widget.

## Blocked-on / known limitations (tracked, not blocking ship)

These are deliberate v0.1 stubs documented in `apps/mcp/README.md` and in the
top comment of `apps/mcp/src/lib/discover.ts`. None block deploy.

* **knowledge[] / recipes[] / concept_aliases_used[] in tf_discover** — return
  empty arrays today. They fill in once E2 ships `loadKnowledge` / `loadRecipes`
  / `loadAliases` (the loaders need a worker-friendly fork — no `node:fs`).
  The `tf_get_knowledge_card` and `tf_get_recipe` tools already work
  end-to-end against R2.
* **Tier-2 grep fallback** — Workers can't shell out. Will be replaced by an
  indexed-content shard published by E1 in v0.2.
* **Discovery scoring is the lite version** — token overlap + index lookup
  only. The full 11-stage pipeline lives in `src/lib/discover/` and will be
  ported to a worker-friendly fork once E2 finishes.

## Open questions for the user

1. Custom domain: confirm `mcp.vegastack.com` is the desired hostname
   (commented out in `wrangler.toml`; user provisions DNS + route after first
   `wrangler deploy`).
2. R2 bucket name: pinned to `vegastack-bundle` (and `vegastack-bundle-preview`).
   Confirm with E4 before the first deploy.
3. KV namespace `MCP_CACHE`: optional warm cache, currently commented out in
   `wrangler.toml`. Run `wrangler kv namespace create MCP_CACHE` and paste the
   id back if you want sub-isolate sharing of manifest blobs. Not required.

## What the audit team should verify

* Diff `apps/mcp/src/lib/types.ts` against `/tmp/synthesis/contracts/discover-types.ts`
  to confirm the envelope hasn't drifted.
* Re-run `npm install && npm run build && npm test` from a clean checkout.
* `npm run dev` and re-run the smoke checks in `apps/mcp/README.md`.
* Confirm wrangler.toml's `compatibility_date = "2026-04-15"` is acceptable —
  bumped from today because wrangler@4.85.0 clamps future dates. Re-bump to
  current after the next wrangler release.

## Contract issues raised

None. The contract files were sufficient and unambiguous for the MCP server's
needs. The only deliberate divergence: `apps/mcp/src/lib/types.ts` is a
hand-mirrored copy of `/tmp/synthesis/contracts/discover-types.ts` (the
contract file isn't a publishable npm package). When E2 lands and exports the
canonical types from `@vegastack/cli`, replace this mirror with a re-export.
