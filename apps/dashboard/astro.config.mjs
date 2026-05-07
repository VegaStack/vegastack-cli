// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
// Uses the Cloudflare adapter with Workers static assets. Tailwind is wired via
// the Vite plugin; package versions are pinned in package.json.
export default defineConfig({
  site: "https://cli-evals.vegastack.com",
  // SSR by default — index.astro and /api/latest.json read R2 at request time
  // and return runtime Responses. With "static" Astro would freeze any
  // build-time R2 miss into the bundle. Per-page opt-in via
  // `export const prerender = true` for genuinely static pages.
  output: "server",
  adapter: cloudflare({
    // Use the modern Workers static-assets binding — no Pages.
    // The workerd dev runtime is used by
    // default and bindings are read via `import { env } from "cloudflare:workers"`.
    imageService: "compile",
  }),
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // Mirrors the `@contracts/*` path alias from tsconfig.json so the
      // dashboard never reaches four levels up into the monorepo with a
      // brittle relative path. Required at runtime because Vite does not
      // honour tsconfig paths automatically.
      alias: {
        "@contracts": path.resolve(__dirname, "../../docs/contracts"),
      },
    },
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
