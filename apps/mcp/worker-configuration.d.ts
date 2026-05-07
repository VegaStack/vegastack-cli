// Ambient binding types for the vegastack-mcp Worker. Mirrors wrangler.toml.
// (Wrangler can also generate this via `wrangler types`; we ship a hand-written
// version so the project type-checks without needing the generated file.)

import type { DurableObjectNamespace, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface Env {
    /** McpAgent durable object namespace (one DO per MCP session). */
    MCP_OBJECT: DurableObjectNamespace;
    /** R2 bucket holding the published VegaStack Registry. */
    REGISTRY: R2Bucket;
    /** Optional warm cache for manifest blobs. May be undefined locally. */
    MCP_CACHE?: KVNamespace;
    /** Public CDN base URL for the Registry (e.g. https://cli-registry.vegastack.com). */
    REGISTRY_PUBLIC_BASE_URL: string;
    /** R2 key for the Terraform pack MANIFEST.json. */
    REGISTRY_MANIFEST_KEY: string;
    /** Cache TTL in seconds (string, parsed at boot). */
    CACHE_TTL_SECONDS: string;
    /** Log level: "debug" | "info" | "warn" | "error". */
    LOG_LEVEL: string;
    /** Per-IP rate limit, requests per minute. Default 60. */
    RATE_LIMIT_PER_MIN?: string;
    /** "true" to require Authorization: Bearer <token> on every request. */
    REQUIRE_AUTH?: string;
    /** Expected bearer token (secret). Required when REQUIRE_AUTH=true. */
    MCP_AUTH_TOKEN?: string;
  }
}

export {};
