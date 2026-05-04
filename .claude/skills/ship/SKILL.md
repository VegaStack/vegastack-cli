---
name: ship
description: Internal release workflow for @vegastack/cli. Use when asked to cut, tag, publish, or release a new CLI version.
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Bash(node:*)
---

# Ship @vegastack/cli

Use only inside this repo.

## Preflight

1. Run `git status --short` and inspect the diff.
2. Run `npm run typecheck`, `npm run build`, and `npm test`.
3. Confirm public docs mention only the current command surface: `vegastack init`, `vegastack ask`, `vegastack search`, `vegastack registry update`, `vegastack doctor`, `vegastack skills`, `vegastack secrets`, `vegastack preview`, and `vegastack update`.
4. Confirm no stale Registry/package references:
   - no removed shortcut commands
   - no top-level install/refresh command docs
   - no old lock path
   - no old Registry environment variables
   - no GitHub Packages publishing docs

## Versioning

Use Changesets for release PRs. Keep root, `apps/mcp`, and `apps/dashboard` versions in sync when this repo ships as one product.

Branch and npm dist-tag policy:

- `develop` is the prerelease branch. Versions must be prerelease semver, for example `0.1.11-next.0`, and GitHub publishes them to public npm with dist-tag `next`.
- `main` is the production branch. Versions must be stable semver, for example `0.1.10`, and GitHub publishes them to public npm with dist-tag `latest`.
- Never publish a prerelease version to `latest`.
- Never publish a stable version to `next`.

## Publishing

Publishing is handled by GitHub Actions release workflows with npm trusted publishing and provenance. Do not add npm tokens to this repo and do not publish manually unless the maintainer explicitly asks for a local emergency publish.

Release workflow inputs:

- Develop prerelease: `.github/workflows/release.yml` with `tag=vX.Y.Z-<preid>.N` and `npm_tag=next`.
- Main production: `.github/workflows/release.yml` with `tag=vX.Y.Z` and `npm_tag=latest`.

## Final Check

Before pushing release changes, show:

- version
- changelog entry
- files changed
- test results
- exact command that will push

Wait for explicit confirmation before pushing tags or release branches.
