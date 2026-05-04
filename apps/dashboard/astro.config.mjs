// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
// Uses @astrojs/cloudflare v13 + Astro 6 — first-class Cloudflare Workers
// support (NOT Pages). Tailwind v4 wired via the Vite plugin per the
// Tailwind v4 + Astro guide (the @astrojs/tailwind integration is deprecated).
export default defineConfig({
  site: "https://cli-evals.vegastack.com",
  output: "static",
  adapter: cloudflare({
    // Use the modern Workers static-assets binding — no Pages.
    // platformProxy was removed in v13; the workerd dev runtime is used by
    // default and bindings are read via `import { env } from "cloudflare:workers"`.
    imageService: "compile",
  }),
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: "auto",
    format: "directory",
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  experimental: {
    clientPrerender: true,
  },
});
