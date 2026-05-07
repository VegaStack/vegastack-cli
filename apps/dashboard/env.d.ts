/// <reference types="astro/client" />

// Cloudflare Workers bindings are imported from "cloudflare:workers". The
// Astro adapter also exposes its own narrow `Runtime` for request context.
type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  ASSETS: Fetcher;
  REGISTRY: R2Bucket;
  REPORTS_CACHE: KVNamespace;
  PUBLIC_SITE_URL: string;
  PUBLIC_GITHUB_REPO: string;
  PUBLIC_NPM_PACKAGE: string;
}

declare module "cloudflare:workers" {
  export const env: Env;
}
