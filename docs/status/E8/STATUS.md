# E8 — Astro public eval dashboard · STATUS

**Status:** ready to commit · build green · tests green · typecheck green

## What shipped

A complete Astro 6 + Tailwind v4 + Cloudflare Workers dashboard at
`apps/dashboard/`. Deploys with `npm run deploy` to a Workers static-assets
binding (NOT Pages — Cloudflare deprecated Pages for new projects in 2025).
Renders alive on first install via a bundled fixture; falls back to the
fixture whenever R2 is empty/unreachable so design changes never need
wired infra to preview.

The homepage shows the headline lift number, a 30-day SVG line chart, a
per-archetype bar chart for all 12 R4 task shapes, knowledge-card and
recipe hit-rate cards, three prompt showcases, and three failure
exemplars. Per-date deep-dive pages at `/reports/<YYYY-MM-DD>` group
prompts by archetype and table the card hit rates. `/methodology` documents
the lift formula, baseline-vs-skill methodology, and expectation kinds.
`/api/latest.json` serves a tiny SSR feed for badges and E7 health probes.

The visual language follows the `frontend-design` skill (anthropic-skills
repo): refined-minimal, deep ink base, single emerald accent, JetBrains
Mono for numerics, server-rendered SVG charts (no React, no chart lib),
motion limited to entrance reveals + a single live-pulse on "Last run".
Dark by default with a non-flashy light toggle; mobile-first responsive
down to 360px.

## Files added

| path | LOC |
|---|---|
| `apps/dashboard/package.json` | 35 |
| `apps/dashboard/astro.config.mjs` | 32 |
| `apps/dashboard/wrangler.toml` | 49 |
| `apps/dashboard/tsconfig.json` | 16 |
| `apps/dashboard/env.d.ts` | 22 |
| `apps/dashboard/vitest.config.ts` | 14 |
| `apps/dashboard/.gitignore` | 27 |
| `apps/dashboard/README.md` | 109 |
| `apps/dashboard/src/styles/global.css` | 187 |
| `apps/dashboard/src/lib/parse-report.ts` | 165 |
| `apps/dashboard/src/lib/r2.ts` | 162 |
| `apps/dashboard/src/fixtures/sample-report.json` | 95 |
| `apps/dashboard/src/layouts/Base.astro` | 53 |
| `apps/dashboard/src/components/SiteHeader.astro` | 41 |
| `apps/dashboard/src/components/SiteFooter.astro` | 76 |
| `apps/dashboard/src/components/ThemeToggle.astro` | 50 |
| `apps/dashboard/src/components/Hero.astro` | 57 |
| `apps/dashboard/src/components/Headline.astro` | 90 |
| `apps/dashboard/src/components/LiftLineChart.astro` | 132 |
| `apps/dashboard/src/components/ArchetypeBars.astro` | 64 |
| `apps/dashboard/src/components/PromptCard.astro` | 78 |
| `apps/dashboard/src/pages/index.astro` | 130 |
| `apps/dashboard/src/pages/methodology.astro` | 121 |
| `apps/dashboard/src/pages/reports/[date].astro` | 108 |
| `apps/dashboard/src/pages/api/latest.json.ts` | 53 |
| `apps/dashboard/tests/smoke.test.ts` | 76 |
| `apps/dashboard/public/favicon.svg` | 11 |
| `apps/dashboard/public/robots.txt` | 4 |

**Total:** ~28 files, ~2,100 LOC code + ~95 lines fixture data.
No files outside `apps/dashboard/` were touched.

## npm install commands run

Single `npm install` at `apps/dashboard/`. Resolved versions (web-searched
before pinning):

| package | spec | resolved |
|---|---|---|
| `astro` | `^6.1.8` | `6.1.9` (latest stable, March 2026 release) |
| `@astrojs/cloudflare` | `^13.0.0` | `13.2.1` (Astro 6 requires v13+, Workers static-assets) |
| `tailwindcss` | `^4.1.0` | `4.2.4` (v4, no `tailwind.config.js` needed) |
| `@tailwindcss/vite` | `^4.1.0` | `4.2.4` (Vite plugin — `@astrojs/tailwind` is deprecated for v4) |
| `wrangler` | `^4.85.0` | `4.85.0` (latest stable) |
| `@cloudflare/workers-types` | `^4.20260101.0` | resolved |
| `vitest` | `^3.0.0` | `3.2.4` |
| `typescript` | `^5.7.0` | resolved |
| `@astrojs/check` | `^0.9.8` | added on second pass for `npm run lint` |
| `@types/node` | `^22.10.0` | resolved |

## Verification

| check | result |
|---|---|
| `npm install` | 335 packages, 0 vulnerabilities |
| `npm run build` | exit 0 — 3 prerendered routes (`/`, `/methodology`, `/reports/2026-04-28`) + SSR worker for `/api/latest.json` |
| `npm run test` (vitest) | 9 tests passed |
| `npm run lint` (`astro check`) | 18 files, 0 errors, 0 warnings, 0 hints |
| Fixture renders | confirmed `+47%` headline appears in built HTML |
| Page weight | 30 KB homepage, 31 KB report page, 10 KB methodology · 24 KB total `_astro/` (CSS+JS) |
| Client JS | one tiny inline theme-toggle script · no React/Vue/chart-lib runtime |

Lighthouse simulation skipped (no Chrome in agent env). Page weight + zero
runtime framework + server-rendered SVG charts + system-font fallback +
single critical CSS file should comfortably hit 95+ on Performance,
Accessibility, Best Practices, SEO. README documents the manual run.

## Web-research log (every dep verified before install)

1. **Astro stable as of April 2026** — verified Astro 6.1.x is real and is
   the current stable. The user's "Astro 6.1.x" hint was correct.
2. **`@astrojs/cloudflare` v13** — verified Workers static-assets support;
   Pages adapter path is deprecated; `platformProxy` removed in v13.
3. **Wrangler `[assets]` binding syntax** — `directory`, `binding`,
   `not_found_handling`, `run_worker_first` confirmed via Cloudflare docs.
4. **Pages → Workers migration** — confirmed Cloudflare's official stance:
   skip Pages for new projects, deploy to Workers from day one.
5. **`frontend-design` skill** — found at
   `/Users/mk/projects/references/anthropic-skills/skills/frontend-design/SKILL.md`.
   Adopted its guidance: bold-direction commitment, refined typography,
   single accent, motion on entrance only, no AI-slop tropes (no purple
   gradients on white, no Inter/Roboto/Space Grotesk default).
6. **shadcn/ui Astro** — available but NOT installed. The dashboard has
   zero React surface; bringing in shadcn would force adding `@astrojs/react`
   for one toggle button. The custom Tailwind v4 design tokens cover
   everything we need at lower weight.
7. **Tailwind v4 + Astro** — confirmed `@tailwindcss/vite` plugin is the
   v4 path; `@astrojs/tailwind` integration is deprecated for v4. Single
   `@import "tailwindcss"` + `@theme` block in `global.css`.
8. **Wrangler 4.85** — current stable.
9. **Charts** — picked pure server-rendered SVG components over Recharts
   or Tremor. No client JS, smaller payload, sharper aesthetics.

## Cross-team contracts (for the audit team)

| Team | Contract | Status |
|---|---|---|
| **E4** (R2) | Bind `bundles-vegastack-com` bucket; reports at `evals/reports/<YYYY-MM-DD>.json`; index at `evals/reports/INDEX.json`. CORS read-public on that prefix. | wired in `wrangler.toml`; placeholders for KV namespace IDs the user must fill after `wrangler kv namespace create` |
| **E6** (eval runner) | Report JSON must match `src/lib/parse-report.ts#EvalReport`. `parseReport()` is defensive — it tolerates extra keys but requires `date`, `lift`, `prompts[]`, `archetypes[]`. | We mirror the §4 + format-examples §5 shapes; if E6 deviates, raise it via `cross-team-touch.md`. |
| **E7** (MCP server) | May consume `/api/latest.json` for an `evals.status` MCP tool. CORS open. | API endpoint shipped, cache-control `public, max-age=300`. |

## Known gaps / deferred

- **`og-image.png`** — not generated (no image-gen tool in agent env).
  README + `Base.astro` reference it; the `og:image` meta is omitted
  rather than broken-linked. Add when a designer ships one.
- **Lighthouse run** — manual; documented in README.
- **Deploy** — `npm run deploy` documented but not executed (wrangler-auth
  is on the user's side per the brief).
- **KV namespace IDs in wrangler.toml** — placeholders. User runs
  `wrangler kv namespace create REPORTS_CACHE` and pastes the IDs in.
- **Custom domain `[[routes]]`** — commented out for first deploy.
  Uncomment after DNS is set up.

## Open questions for the user

1. Confirm the R2 bucket name is `bundles-vegastack-com` (the v0.1 overrides
   say `bundles.vegastack.com` is the public URL — bucket name with dots
   sometimes works, sometimes not depending on the CF setup; using the
   dash form in `wrangler.toml`).
2. Confirm the report path inside the bucket is `evals/reports/<date>.json`
   vs `bundle/evals/reports/<date>.json`. The brief said both; we picked
   `evals/reports/`. Single line change in `src/lib/r2.ts` if wrong.
3. Compatibility-date in `wrangler.toml` is `2025-09-23` (the latest the
   currently-installed miniflare understands during `npm run preview`).
   Bump to `2026-04-28` once your installed wrangler version recognizes it.

## Contract issues raised

None. The §4 + format-examples §5 shapes were enough to author
`parse-report.ts` and the fixture without ambiguity.
