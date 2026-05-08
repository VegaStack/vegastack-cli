# Maintainer Protocol

This repo owns the npm CLI, agent skill installers, local Registry cache
handling, and deterministic search UX. Registry content generation lives in
`vegastack/vegastack-cli-registry`.

Maintainer rules:

- Add or change pack sync sources in the Registry repo, not this CLI repo.
- Keep bare `vegastack` as the first-run global setup/status path.
- Keep `vegastack init` as the project-local setup path for selected Registry data.
- Keep `vegastack registry install --all` as the explicit opt-in path for downloading every published pack.
- Keep `vegastack search` as exact local source lookup.
- Keep `vegastack ask` as the agent-facing evidence builder.
- Run `npm run typecheck`, `npm run build`, and `npm test` before release.
- Do not reintroduce archive-era commands, release assets, or environment
  overrides.
