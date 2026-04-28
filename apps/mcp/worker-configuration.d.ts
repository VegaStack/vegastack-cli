// Ambient binding types for the vegastack-mcp Worker. Mirrors wrangler.toml.
// (Wrangler can also generate this via `wrangler types`; we ship a hand-written
// version so the project type-checks without needing the generated file.)

import type { DurableObjectNamespace, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface Env {
    /** McpAgent durable object namespace (one DO per MCP session). */
    MCP_OBJECT: DurableObjectNamespace;
    /** R2 bucket holding the published bundle (E4 owns publishing). */
    BUNDLE: R2Bucket;
    /** Optional warm cache for manifest blobs. May be undefined locally. */
    MCP_CACHE?: KVNamespace;
    /** Public CDN base URL for the bundle (e.g. https://bundles.vegastack.com). */
    BUNDLE_PUBLIC_BASE_URL: string;
    /** R2 key for the root MANIFEST.json (default: "bundle/MANIFEST.json"). */
    BUNDLE_MANIFEST_KEY: string;
    /** Cache TTL in seconds (string, parsed at boot). */
    CACHE_TTL_SECONDS: string;
    /** Log level: "debug" | "info" | "warn" | "error". */
    LOG_LEVEL: string;
  }
}

export {};
