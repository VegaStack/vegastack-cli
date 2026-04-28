# @vegastack/dashboard

Public eval dashboard for [vegastack-cli](https://github.com/vegastack/vegastack-cli).
Live at **https://evals.vegastack.com**.

Built with **Astro 6** + **Tailwind CSS v4** and deployed to **Cloudflare
Workers** using the [static-assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
(not Pages — Cloudflare deprecated Pages for new projects in 2025).

## What it shows

- Headline lift number — how much remaining error vegastack-cli closes vs
  baseline Claude on a 50-prompt Terraform suite, refreshed nightly.
- 30-day lift trend.
- Per-archetype lift across the [12 task shapes](https://github.com/vegastack/vegastack-cli/blob/main/CONTEXT.md#archetypes)
  derived from real Terraform user prompts.
- Per-knowledge-card and per-recipe hit rates.
- Three failure exemplars from each run — the dashboard publishes its
  own weak spots so the next content round can fix them.
- Per-date deep-dive pages at `/reports/<YYYY-MM-DD>`.
- Tiny `/api/latest.json` status feed for badges and health probes.

## Dev

```sh
npm install
npm run dev          # http://localhost:4321 — hot reload
npm run build        # produces ./dist for Workers
npm run preview      # wrangler dev — runs the built worker locally
npm run deploy       # astro build && wrangler deploy
npm run test         # vitest unit tests
npm run lint         # astro check
```

The dashboard renders alive on first install — `src/fixtures/sample-report.json`
is loaded when R2 is empty or unreachable, so design changes don't need
wired infra to preview.

## Deploy

You need:

1. A Cloudflare account with Workers enabled.
2. `wrangler login` (or `CLOUDFLARE_API_TOKEN` for CI).
3. Two KV namespace IDs and one R2 bucket — see the placeholders in
   `wrangler.toml`.

Steps:

```sh
# One-time setup
wrangler kv namespace create REPORTS_CACHE
wrangler kv namespace create REPORTS_CACHE --preview
# Paste the returned IDs into wrangler.toml under [[kv_namespaces]].

# E4 owns the R2 bucket — reuse it; do not create your own.
# wrangler.toml already binds vegastack-bundles.

# Ship
npm run deploy

# Then point evals.vegastack.com at the worker (uncomment [[routes]]
# in wrangler.toml and run `wrangler deploy` again).
```

## Pointing at a different bundle bucket

For a staging dashboard, edit `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "BUNDLES"
bucket_name = "bundles-vegastack-staging"
```

The dashboard reads reports from `evals/reports/<YYYY-MM-DD>.json` in
the bound bucket. The path prefix is in `src/lib/r2.ts` if it ever
needs to change.

## Cross-team contracts

| Team | What we expect |
|---|---|
| **E4** | R2 bucket `vegastack-bundles` with public-read on `evals/reports/*`. |
| **E6** | Eval reports in JSON matching `src/lib/parse-report.ts#EvalReport`. Index at `evals/reports/INDEX.json`. |
| **E7** | (Optional) consumes `/api/latest.json` for an MCP `evals.status` tool. |

## Updating the design system

All design tokens live in `src/styles/global.css` under the `@theme`
block (Tailwind v4 syntax — no `tailwind.config.js`). To shift the
accent colour, change `--color-accent-*`. Component primitives like
`.surface-card`, `.pill`, `.display-num` keep the visual language tight.

The aesthetic is intentionally restrained: deep ink base, single emerald
accent, JetBrains Mono for numerics, refined motion on entrance only.
We avoid generic AI-dashboard patterns (purple gradients on white,
Roboto, busy micro-interactions). Anything new should justify its
contrast against this baseline.

## Stack rationale (April 2026)

- **Astro 6.1.x** — latest stable; first-class Cloudflare Workers
  support; zero client JS by default (we use server-rendered SVG charts,
  no React/Vue runtime).
- **`@astrojs/cloudflare` v13** — Workers static-assets binding; the
  Pages adapter path is deprecated.
- **Tailwind v4 via `@tailwindcss/vite`** — the `@astrojs/tailwind`
  integration is deprecated for v4.
- **Wrangler 4** — modern static-assets binding syntax (`[assets]`).
- **No charting library** — every chart is a `.astro` component that
  emits SVG at build time. Saves ~120 KB of JS and looks better.
