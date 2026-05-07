# @vegastack/dashboard

Public eval dashboard for [vegastack-cli](https://github.com/vegastack/vegastack-cli).
Live at **https://cli-evals.vegastack.com**.

Built with Astro, Tailwind CSS, and Cloudflare Workers. Package versions are
pinned in `package.json`; deployment bindings live in `wrangler.toml`.

## What it shows

- Headline lift number — how much remaining error vegastack-cli closes vs
  the baseline model on the Terraform eval suite, refreshed nightly.
- 30-day lift trend.
- Per-archetype lift across task shapes derived from real Terraform user
  prompts.
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

# Reuse the VegaStack Registry bucket; do not create a dashboard-specific bucket.
# wrangler.toml already binds vegastack-cli-registry as REGISTRY.

# Ship
npm run deploy

# Then point cli-evals.vegastack.com at the worker (uncomment [[routes]]
# in wrangler.toml and run `wrangler deploy` again).
```

## Pointing at a different Registry pack bucket

For a staging dashboard, edit `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "REGISTRY"
bucket_name = "vegastack-cli-registry"
```

The dashboard reads reports from `cli/evals/reports/<YYYY-MM-DD>.json` in
the bound bucket. The path prefix is in `src/lib/r2.ts` if it ever
needs to change.

## Data contracts

| Producer | What the dashboard expects |
|---|---|
| Registry publisher | R2 bucket `vegastack-cli-registry` with public-read on `cli/evals/reports/*`. |
| Eval runner | JSON matching `src/lib/parse-report.ts#EvalReport`, plus an index at `cli/evals/reports/INDEX.json`. |
| Downstream tools | `/api/latest.json` exposes the latest public report for badges, checks, and MCP health views. |

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

## Stack rationale

- **Astro** — Cloudflare Workers support; zero client JS by default (we use
  server-rendered SVG charts, no React/Vue runtime).
- **`@astrojs/cloudflare`** — Workers static-assets binding.
- **Tailwind via Vite** — design tokens live in CSS through the current
  Tailwind integration.
- **Wrangler** — Cloudflare deployment and local preview.
- **No charting library** — every chart is a `.astro` component that
  emits SVG at build time. Saves ~120 KB of JS and looks better.
