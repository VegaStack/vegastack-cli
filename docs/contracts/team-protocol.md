# Maintainer Protocol

This repo owns the npm CLI, agent skill installers, local Registry cache
handling, and deterministic search UX. Registry content generation lives in
`VegaStack/vegastack-cli-registry`.

Maintainer rules:

- Add or change pack sync sources in the Registry repo, not this CLI repo.
- Keep `vegastack init` as the only first-run install path for Registry data.
- Keep `vegastack search` as exact local source lookup.
- Keep `vegastack ask` as the agent-facing evidence builder.
- Run `npm run typecheck`, `npm run build`, and `npm test` before release.
- Do not reintroduce archive-era commands, release assets, or environment
  overrides.
