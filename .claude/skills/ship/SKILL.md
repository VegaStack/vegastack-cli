---
name: ship
description: Internal release workflow for @vegastack/cli. Use when asked to cut, tag, publish, or release a new CLI version.
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Bash(node:*)
---

# Ship @vegastack/cli

Use only inside this repo.

## Hard Release Gate

Do not push, tag, publish, move npm dist-tags, or dispatch release workflows
until the maintainer gives explicit release approval in the current
conversation.

Implementation approval is not release approval. Do not treat "go ahead",
"proceed", "implement it", "fix it", "looks good", "continue", "ship-ready", or
similar wording as permission to mutate remote state. Those phrases allow local
edits and verification only.

Before any remote mutation, show the exact command(s), the version being
released, the target branch/tag, and the npm dist-tag impact. Then wait for a
direct approval that names the release action, for example:

- "push this branch"
- "tag v0.1.13-next.0 and publish to next"
- "release 0.1.12 to latest"
- "move npm latest to 0.1.12"

If the request is ambiguous, stop and ask. Never infer publish approval from
prior discussion or from a successful test run.

## Preflight

1. Run `git status --short` and inspect the diff.
2. Run `npm run typecheck`, `npm run build`, and `npm test`.
3. **Run the contributor audit chain (ephemeral mode — no GitHub issues created):**
   - Invoke `/vegastack-audit scope=changed mode=ephemeral`. This writes a single audit report under `audits/audit-<epoch>-<iso>-changed.md` covering uncommitted changes + their blast radius.
   - If the report has any **Critical** or **High** findings, **block release**. Either:
     - Run `/vegastack-fix all sev=critical,high --auto` to apply TDD-verified fixes (each fix carries red→green commit SHAs, mutation review, and a verification log entry appended to the audit report), then re-run the audit until clean; or
     - Stop and ask the maintainer how to proceed (e.g. defer the finding, mark wontfix, accept and document the risk).
   - **Medium** findings do not block but must be acknowledged in the release notes if they affect shipped behavior.
   - The audit report and any verification-log entries from `/vegastack-fix` are committed alongside the release commit so the audit history travels with the version.
4. Confirm public docs mention only the current command surface: `vegastack init`, `vegastack ask`, `vegastack search`, `vegastack registry update`, `vegastack doctor`, `vegastack skills`, `vegastack preview`, and `vegastack update`.
5. Confirm no stale Registry/package references:
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

Before any remote release mutation, show:

- version
- changelog entry
- files changed
- test results
- exact command that will push

Wait for explicit confirmation before pushing branches, pushing tags, moving npm
dist-tags, dispatching release workflows, or publishing packages.
