/// <reference types="astro/client" />

// Astro v6 + @astrojs/cloudflare v13 — `Astro.locals.runtime.env` was
// removed; bindings are now imported from "cloudflare:workers". The
// adapter still exposes its own narrow `Runtime` (just `cfContext`).
type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  ASSETS: Fetcher;
  BUNDLES: R2Bucket;
  REPORTS_CACHE: KVNamespace;
  PUBLIC_SITE_URL: string;
  PUBLIC_GITHUB_REPO: string;
  PUBLIC_NPM_PACKAGE: string;
}

declare module "cloudflare:workers" {
  export const env: Env;
}
