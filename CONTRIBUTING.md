# Contributing to `@vegastack/cli`

Thanks for your interest. This is a small, focused TypeScript CLI; we keep
contributions tightly scoped and well-tested.

## Quick start

```bash
git clone https://github.com/vegastack/vegastack-cli.git
cd vegastack-cli
nvm use            # picks up .nvmrc → Node 20
npm ci             # postinstall will warn about missing bundle — that's fine
npm run build      # tsc → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run format     # prettier --write
```

## Local end-to-end test

The bundle is built by the upstream repo `engg-vegastack-agent-tf-providers`. To
test end-to-end without GitHub Releases, point `vega` at an in-tree bundle:

```bash
# Build a bundle locally (one-time, takes a few seconds):
( cd ../engg-vegastack-agent-tf-providers
  bash scripts/build_bundle.sh --version 0.1.0 )

# Install it via file://:
VEGA_BUNDLE_URL=file:///abs/path/to/dist/vegastack-bundle-v0.1.0.tar.gz \
VEGA_BUNDLE_DIR=/tmp/vega-test \
  node npm/install.js

# Run the CLI against it:
VEGA_BUNDLE_DIR=/tmp/vega-test node dist/cli.js doctor
VEGA_BUNDLE_DIR=/tmp/vega-test node dist/cli.js tf "create an S3 bucket with versioning"
```

## Pull-request workflow

1. **Open a feature branch** from `main`. Keep PRs focused — one topic per PR.
2. **Add a Changeset** for any user-visible change:
   ```bash
   npx changeset
   ```
   The CI policy gate blocks merges that touch `src/`, `npm/`, or
   `skills/` without a `.changeset/*.md` file.

   **Versioning rule (Wrangler-style).** Every non-breaking change ships
   as a **patch**. We deliberately do not use minor bumps for new
   features — patch is fine, and it keeps users upgrading aggressively
   instead of pinning. **Minor versions are reserved for envelope-shape
   changes** (the `manifest_schema_version` bump, breaking shape changes
   to `vega tf --json` output, etc.). **Major** is reserved for the v1.0
   API-stability commitment. Until v1.0, almost every changeset should
   be `patch`.
3. **Run the local checks** before you push:
   ```bash
   npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
   ```
4. **Open the PR**. Fill in the template (`.github/PULL_REQUEST_TEMPLATE.md`).
5. **CI** runs lint, format-check, typecheck, vitest, npm-audit, build, and a
   smoke install on Linux + macOS. Windows compatibility is verified by the
   per-agent installer tests, which mock `process.platform`.

## Code style

- **TypeScript everywhere.** No untyped JS in `src/`. The `npm/` shim is plain
  ESM JS for postinstall (zero runtime deps; runs before `dist/` is built).
- **`"strict": true`, `noUncheckedIndexedAccess: true`.** Both are non-negotiable.
- **No `any` unless the boundary truly is dynamic** (e.g. `JSON.parse` output).
  Use `unknown` and narrow with type guards.
- **Errors as types.** Throw a `VegaError` (`src/lib/errors.ts`); each variant
  has an exit code and a hint. Don't throw plain `Error` in command handlers.
- **stdout is for data, stderr for status.** All human-readable output goes to
  `log.{ok,warn,err,info,step}`. Machine-readable output (JSON envelopes) goes
  to `log.json` (stdout).
- **Honor `NO_COLOR`, `--quiet`, `--json`** in any new command.
- **Per-agent installers must be idempotent** and respect `--dry-run`.

See [STYLE.md](STYLE.md) for review-time guidance.

## Tests

Every PR that adds or modifies behavior must add or update tests:

- `tests/lib/*.test.ts` — pure-function unit tests (paths, errors, validate, …).
- `tests/agents/*.test.ts` — per-agent installer tests; use `withTmpDir` from
  `tests/setup.ts` to avoid cross-test contamination.
- `tests/integration/*.test.ts` — end-to-end flows (postinstall, CLI help).

Coverage thresholds are enforced via `vitest.config.ts`. Aim for ≥80% lines on
new code; the global floor is 70%.

## What we won't accept

- Drive-by formatting changes mixed with logic changes.
- Adding runtime dependencies without a clear reason. Today: `commander`,
  `kleur`, `prompts`. New deps need a justification in the PR description.
- Code that runs at import time (top-level side-effects in non-`cli.ts`
  modules). Commands should be pure functions of their inputs.
- Reaching for `child_process` when a Node API exists.

## Reporting bugs / requesting features

Use the GitHub issue templates at [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).
For security issues, follow the process in [SECURITY.md](SECURITY.md).

## Licensing

By contributing, you agree your contribution is licensed under the [MIT License](LICENSE).
