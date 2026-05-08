# vegastack-mcp

Cloudflare Workers Remote MCP server that exposes VegaStack Registry evidence to MCP-aware coding agents (Claude Code, Codex, Cursor, Continue, Aider, Cline, ...). The current worker surface is Terraform-focused while the CLI remains the broad local harness.

- **Transport:** StreamableHTTP at `/mcp` (modern clients) and SSE at `/sse` (legacy clients).
- **Auth:** anonymous public read by default, with bearer-token auth available as an opt-in (see [Auth & rate-limit](#auth--rate-limit)). The Registry pack is open data.
- **Rate limit:** 60 requests / minute / IP by default (token bucket, in-memory, per-isolate). Configurable via `RATE_LIMIT_PER_MIN`.
- **Backed by:** Cloudflare R2 bucket `vegastack-cli-registry`.
- **Production URL:** `https://cli-mcp.vegastack.com/mcp` (StreamableHTTP) and `https://cli-mcp.vegastack.com/sse` (SSE) — DNS+route provisioned post-deploy.

## Tools

| name | summary |
| --- | --- |
| `terraform_discover(query, provider?, max?)` | Primary discovery — returns the canonical `DiscoverResult` envelope. |
| `terraform_get_manifest(provider, resource?)` | Full per-provider manifest, or a single resource entry. |
| `terraform_list_providers()` | All Registry-provided provider names + Registry pack CalVer. |
| `registry_get_knowledge_card(id)` | Single curated card (markdown + frontmatter parsed). |
| `registry_get_recipe(id)` | Single curated recipe (TOML parsed). |

The envelope shape is defined in `docs/contracts/discover-types.ts`. It mirrors the CLI's `vegastack ask --pack terraform --tf-provider <provider> <query>` output exactly.

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

A quick `terraform_discover` call:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"terraform_discover","arguments":{"query":"S3 bucket with versioning","provider":"aws"}}}'
```

## Deploy

```bash
# 1. Provision or reuse the R2 bucket (one-time, owned by Registry publishing):
wrangler r2 bucket create vegastack-cli-registry

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

`wrangler.toml` declares an R2 binding `REGISTRY` pointing at the `vegastack-cli-registry` bucket. The worker reads:

- `cli/packs/terraform/MANIFEST.json` — Terraform pack index
- `cli/packs/terraform/docs/<provider>/MANIFEST.json` — per-provider scoring data + resource entries
- `cli/packs/terraform/docs/knowledge/<id>.md` — knowledge cards
- `cli/packs/terraform/docs/recipes/<id>.toml` — recipes

Lookup falls through:

1. In-memory LRU (per isolate, ~64 keys)
2. KV cache (warm across isolates, optional)
3. R2 binding (zero-egress)
4. Public CDN fallback (`REGISTRY_PUBLIC_BASE_URL`) — useful for `wrangler dev` runs without R2 provisioned

## Auth & rate-limit

The worker enforces two abuse controls (issue [#77](https://github.com/vegastack/vegastack-cli/issues/77)):

### Per-IP rate limit (always on)

A token-bucket limiter, keyed on `cf-connecting-ip + colo`, fires before tool dispatch:

- **Default:** 60 requests / minute / IP. Override with `RATE_LIMIT_PER_MIN=<int>`.
- **Response on overage:** HTTP 429 with `Retry-After` header and a JSON body `{"error":"rate_limited", ...}`.
- **State:** in-memory, per Worker isolate. Best-effort — a determined attacker who lands across many isolates can exceed the per-IP cap, but a misbehaving single client is contained.
- **Scope:** every non-`OPTIONS` request, including `/health` and `/version`. The CORS preflight is exempt.

### Bearer-token auth (opt-in)

Set both env vars to require an `Authorization: Bearer <token>` header on every request:

```toml
# wrangler.toml [vars] — or `wrangler secret put MCP_AUTH_TOKEN` for the secret
REQUIRE_AUTH = "true"
```

```bash
wrangler secret put MCP_AUTH_TOKEN          # paste a 32-byte hex secret
```

- **Comparison:** constant-time over UTF-8 bytes; both length and content mismatches return identical 401 responses.
- **Misconfig:** if `REQUIRE_AUTH=true` and `MCP_AUTH_TOKEN` is empty, the server fails closed with HTTP 500 — there is no silent-allow path.
- **No-op default:** when `REQUIRE_AUTH` is unset (or anything other than the literal string `true`), the middleware is bypassed.

Generate a token: `openssl rand -hex 32`.

## Current limitations

- The worker currently exposes Terraform discovery and selected Registry lookup tools. The local CLI remains the primary interface for broad pack search.
- Workers cannot shell out to ripgrep, so remote search must use Registry indexes or R2/KV-backed lookup paths.
- v0.1 has rate-limiting and opt-in bearer auth (see above). Per-tenant quotas and OAuth land in v0.2. For shared private deployments, layer Cloudflare Access in front of the worker.
- Keep response shapes aligned with `docs/contracts/discover-types.ts` before changing tool output.
