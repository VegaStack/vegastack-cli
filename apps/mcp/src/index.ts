// vegastack-mcp — Cloudflare Workers Remote MCP server.
//
// Routes:
//   GET  /            — landing page (HTML pointer to the MCP endpoints)
//   GET  /health      — liveness + bundle reachability check
//   GET  /version     — server + bundle version JSON
//   GET  /tools       — non-MCP convenience listing of tools (debug)
//   *    /mcp         — MCP StreamableHTTP transport (modern clients)
//   *    /sse         — MCP SSE transport (legacy clients: Claude Desktop, mcp-remote)
//
// Dependencies (web-researched 2026-04-28):
//   * agents@0.11.6                       (McpAgent base class + DO plumbing)
//   * @modelcontextprotocol/sdk@1.29.0    (McpServer + tool registration)
//   * zod@4.3.6                           (input schemas)
//
// Why both /mcp AND /sse?
//   The MCP spec moved from SSE → StreamableHTTP in late-2024/early-2025 and
//   modern clients (Codex, Continue, Cline, Aider) prefer /mcp. Claude Desktop
//   and the `mcp-remote` proxy still default to SSE, so we keep /sse mounted
//   for compatibility. Both routes proxy to the SAME McpAgent class.

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProviders, readRootManifest } from "./lib/r2-bundle.js";

import {
  handleTfDiscover,
  tfDiscoverDescription,
  tfDiscoverSchema,
} from "./tools/tf_discover.js";
import {
  handleTfGetKnowledgeCard,
  tfGetKnowledgeCardDescription,
  tfGetKnowledgeCardSchema,
} from "./tools/tf_get_knowledge_card.js";
import {
  handleTfGetManifest,
  tfGetManifestDescription,
  tfGetManifestSchema,
} from "./tools/tf_get_manifest.js";
import {
  handleTfGetRecipe,
  tfGetRecipeDescription,
  tfGetRecipeSchema,
} from "./tools/tf_get_recipe.js";
import {
  handleTfListProviders,
  tfListProvidersDescription,
  tfListProvidersSchema,
} from "./tools/tf_list_providers.js";

// ─── McpAgent (Durable Object) ────────────────────────────────────────────

export class VegaMcp extends McpAgent<Env> {
  server = new McpServer({
    name: "vegastack-mcp",
    version: "0.1.0",
  });

  override async init(): Promise<void> {
    const env = this.env;

    this.server.tool(
      "tf_discover",
      tfDiscoverDescription,
      tfDiscoverSchema,
      async (args) => {
        const t0 = Date.now();
        const result = await handleTfDiscover(env, args);
        log(env, "info", "tf_discover", {
          query: args.query,
          provider: args.provider ?? null,
          latency_ms: Date.now() - t0,
          result_count:
            (result.structuredContent as { count?: number } | undefined)?.count ?? 0,
        });
        return result;
      },
    );

    this.server.tool(
      "tf_get_manifest",
      tfGetManifestDescription,
      tfGetManifestSchema,
      async (args) => {
        const t0 = Date.now();
        const result = await handleTfGetManifest(env, args);
        log(env, "info", "tf_get_manifest", {
          provider: args.provider,
          resource: args.resource ?? null,
          latency_ms: Date.now() - t0,
        });
        return result;
      },
    );

    this.server.tool(
      "tf_list_providers",
      tfListProvidersDescription,
      tfListProvidersSchema,
      async () => {
        const t0 = Date.now();
        const result = await handleTfListProviders(env);
        log(env, "info", "tf_list_providers", { latency_ms: Date.now() - t0 });
        return result;
      },
    );

    this.server.tool(
      "tf_get_knowledge_card",
      tfGetKnowledgeCardDescription,
      tfGetKnowledgeCardSchema,
      async (args) => {
        const t0 = Date.now();
        const result = await handleTfGetKnowledgeCard(env, args);
        log(env, "info", "tf_get_knowledge_card", {
          id: args.id,
          latency_ms: Date.now() - t0,
        });
        return result;
      },
    );

    this.server.tool(
      "tf_get_recipe",
      tfGetRecipeDescription,
      tfGetRecipeSchema,
      async (args) => {
        const t0 = Date.now();
        const result = await handleTfGetRecipe(env, args);
        log(env, "info", "tf_get_recipe", { id: args.id, latency_ms: Date.now() - t0 });
        return result;
      },
    );
  }
}

// ─── Worker fetch handler ─────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  // v0.1: anonymous public read. Tightens to per-tenant in v0.2 if we add auth.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Health / version / tools listing ────────────────────────────────
    if (url.pathname === "/" || url.pathname === "") {
      return html(LANDING_HTML);
    }
    if (url.pathname === "/health") {
      const body = await healthBody(env);
      return json(body, body.ok ? 200 : 503);
    }
    if (url.pathname === "/version") {
      let bundle = "unknown";
      try {
        bundle = (await readRootManifest(env)).bundle_version ?? "unknown";
      } catch {
        // ignore — version still useful even if bundle unreachable
      }
      return json({
        name: "vegastack-mcp",
        version: "0.1.0",
        bundle_version: bundle,
        schema_version: 1,
      });
    }
    if (url.pathname === "/tools") {
      return json({ tools: TOOL_NAMES });
    }

    // ── MCP transports ──────────────────────────────────────────────────
    // Both routes proxy to the SAME McpAgent class. McpAgent.serve(path) and
    // McpAgent.serveSSE(path) are static helpers that build a Worker handler
    // wired to this class's Durable Object namespace.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const handler = VegaMcp.serve("/mcp") as unknown as McpHandler;
      const resp = await handler.fetch(request, env, ctx);
      return withCors(resp);
    }
    if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
      const handler = VegaMcp.serveSSE("/sse") as unknown as McpHandler;
      const resp = await handler.fetch(request, env, ctx);
      return withCors(resp);
    }

    return json({ error: "not_found", path: url.pathname }, 404);
  },
} satisfies ExportedHandler<Env>;

// ─── helpers ──────────────────────────────────────────────────────────────

interface McpHandler {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

const TOOL_NAMES = [
  "tf_discover",
  "tf_get_manifest",
  "tf_list_providers",
  "tf_get_knowledge_card",
  "tf_get_recipe",
];

async function healthBody(env: Env): Promise<{ ok: boolean; bundle_reachable: boolean; provider_count: number; bundle_version: string }> {
  try {
    const root = await readRootManifest(env);
    const providers = await listProviders(env);
    return {
      ok: true,
      bundle_reachable: true,
      provider_count: providers.length,
      bundle_version: root.bundle_version ?? "unknown",
    };
  } catch {
    return {
      ok: false,
      bundle_reachable: false,
      provider_count: 0,
      bundle_version: "unknown",
    };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
  });
}

function withCors(resp: Response): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

type LogLevel = "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
function log(env: Env, level: LogLevel, event: string, fields: Record<string, unknown>): void {
  const min = (env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  if (LEVEL_ORDER[level] < (LEVEL_ORDER[min] ?? 20)) return;
  // Workers Logs / Logpush ingest stdout JSON lines.
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
}

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>vegastack-mcp</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 720px; margin: 4rem auto; padding: 0 1rem; line-height: 1.6; color: #1f2937; }
  code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-size: 0.95em; }
  pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
  h1 { margin-bottom: 0.25rem; }
  .muted { color: #6b7280; }
  ul { padding-left: 1.25rem; }
</style>
</head>
<body>
<h1>vegastack-mcp</h1>
<p class="muted">Remote Model Context Protocol server for the <code>vega tf</code> Terraform discovery harness.</p>
<h2>Endpoints</h2>
<ul>
  <li><code>POST /mcp</code> — StreamableHTTP transport (modern clients)</li>
  <li><code>GET&nbsp;/sse</code> — SSE transport (legacy clients: Claude Desktop, mcp-remote)</li>
  <li><code>GET&nbsp;/health</code> — liveness + bundle check</li>
  <li><code>GET&nbsp;/version</code> — server + bundle version</li>
  <li><code>GET&nbsp;/tools</code> — list of MCP tools</li>
</ul>
<h2>Tools</h2>
<ul>
  <li><code>tf_discover</code> — natural-language discovery</li>
  <li><code>tf_get_manifest</code> — full or per-resource manifest</li>
  <li><code>tf_list_providers</code> — list all bundled providers</li>
  <li><code>tf_get_knowledge_card</code> — fetch a curated knowledge card by id</li>
  <li><code>tf_get_recipe</code> — fetch a curated recipe by id</li>
</ul>
<p>See the <a href="https://github.com/vegastack/vegastack-cli/tree/main/apps/mcp">README</a> for client setup.</p>
</body>
</html>`;
