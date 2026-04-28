# vegastack-mcp

Cloudflare Workers Remote MCP server that exposes the `vega tf` Terraform-discovery harness to any MCP-aware coding agent (Claude Code, Codex, Cursor, Continue, Aider, Cline, …).

- **Transport:** StreamableHTTP at `/mcp` (modern clients) and SSE at `/sse` (legacy clients).
- **Auth:** none — v0.1 ships anonymous public read. The bundle is open data.
- **Backed by:** Cloudflare R2 bucket `vegastack-agent-kb` (E4 owns publishing).
- **Production URL:** `https://cli-mcp.vegastack.com/mcp` (StreamableHTTP) and `https://cli-mcp.vegastack.com/sse` (SSE) — DNS+route provisioned post-deploy.

## Tools

| name | summary |
| --- | --- |
| `tf_discover(query, provider?, max?)` | Primary discovery — returns the canonical `DiscoverResult` envelope. |
| `tf_get_manifest(provider, resource?)` | Full per-provider manifest, or a single resource entry. |
| `tf_list_providers()` | All bundled provider names + bundle CalVer. |
| `tf_get_knowledge_card(id)` | Single curated card (markdown + frontmatter parsed). |
| `tf_get_recipe(id)` | Single curated recipe (TOML parsed). |

The envelope shape is the source of truth at `/tmp/synthesis/contracts/discover-types.ts`. It mirrors the CLI's `vega tf <query>` output exactly.

## Local development

```bash
cd apps/mcp
npm install
npm run dev          # wrangler dev — opens http://localhost:8787
npm test             # vitest
npm run typecheck    # tsc --noEmit
```

Smoke checks once `wrangler dev` is up:

```bash
curl -s http://localhost:8787/health    | jq
curl -s http://localhost:8787/version   | jq
curl -s http://localhost:8787/tools     | jq
```

A quick MCP `tools/list` over StreamableHTTP:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 2000
```

A quick `tf_discover` call:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tf_discover","arguments":{"query":"S3 bucket with versioning","provider":"aws"}}}'
```

## Deploy

```bash
# 1. Provision the R2 bucket (one-time, owned by E4 in production):
wrangler r2 bucket create vegastack-agent-kb
wrangler r2 bucket create vegastack-agent-kb-preview

# 2. (Optional) Provision the warm cache KV namespace and paste the id back into wrangler.toml:
wrangler kv namespace create MCP_CACHE

# 3. Deploy
npm run deploy

# 4. Tail logs
npm run tail
```

After first deploy, point your custom domain at the worker via the Cloudflare dashboard — the route block in `wrangler.toml` is commented out so the user can manage DNS/zones separately.

## Wiring this server into agents

### Claude Code

Add to `~/.config/claude-code/mcp.json` (or per-project `.claude/mcp.json`):

```jsonc
{
  "mcpServers": {
    "vegastack": {
      "transport": { "type": "sse", "url": "https://cli-mcp.vegastack.com/sse" }
    }
  }
}
```

Or the StreamableHTTP variant on newer Claude Code releases:

```jsonc
{
  "mcpServers": {
    "vegastack": {
      "transport": { "type": "streamable-http", "url": "https://cli-mcp.vegastack.com/mcp" }
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.vegastack]
url = "https://cli-mcp.vegastack.com/mcp"
transport = "streamable-http"
```

### Cursor

Settings → MCP → Add server:

```jsonc
{
  "mcpServers": {
    "vegastack": {
      "url": "https://cli-mcp.vegastack.com/sse"
    }
  }
}
```

### Continue.dev

In `~/.continue/config.json`:

```jsonc
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "sse",
          "url": "https://cli-mcp.vegastack.com/sse"
        }
      }
    ]
  }
}
```

### Aider / Cline / mcp-remote

The community proxy `mcp-remote` bridges any URL into a stdio MCP server, which lets stdio-only clients connect:

```bash
npx mcp-remote https://cli-mcp.vegastack.com/sse
```

## How the R2 binding works

`wrangler.toml` declares an R2 binding `BUNDLE` pointing at the `vegastack-agent-kb` bucket. The worker reads:

- `bundle/MANIFEST.json` — root index (bundle CalVer + provider list)
- `bundle/<provider>/MANIFEST.json` — per-provider scoring data + resource entries
- `bundle/knowledge/<id>.md` — knowledge cards
- `bundle/recipes/<id>.toml` — recipes

Lookup falls through:

1. In-memory LRU (per isolate, ~64 keys)
2. KV cache (warm across isolates, optional)
3. R2 binding (zero-egress)
4. Public CDN fallback (`BUNDLE_PUBLIC_BASE_URL`) — useful for `wrangler dev` runs without R2 provisioned

## v0.1 limitations (tracked in `STATUS.md`)

- Knowledge / recipe / alias channels in `tf_discover` are stubs that return empty arrays — they fill in once E2/E3 publish the loaders + content.
- No Tier-2 grep fallback (Workers can't shell out). The Tier-2 path will be replaced by an indexed-content shard in v0.2.
- No auth → no rate limits. We rely on Cloudflare's free-tier defaults.
- The discovery scoring is intentionally a stripped-down port of the CLI's; once E2 lands, swap `src/lib/discover.ts` for a worker-friendly fork of `/Users/mk/projects/vegastack-cli/src/lib/discover/`.
