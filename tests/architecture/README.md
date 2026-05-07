# Architectural Pin Tests

These tests are **regression bars**. Each one fails if a class of bug
that was previously fixed reappears anywhere in the repo. They run as
part of `npm test` and gate every PR.

The catalog is at
[`.claude/skills/vegastack-audit/references/regression-pins.md`](../../.claude/skills/vegastack-audit/references/regression-pins.md)
— the audit skill's `regression-prevention` category checks that every
documented pattern has its pin here.

## Current pins

| File | Pattern banned | Originally fixed in |
|---|---|---|
| `pinned-actions.test.ts` | Floating `@v<N>` GitHub Action references in `.github/workflows/*.yml`. Forces commit-SHA pinning. | #64 |
| `no-proper-lockfile.test.ts` | Re-introduction of the unused `proper-lockfile` runtime dep. | rollup-B |
| `no-eager-heavy-imports.test.ts` | Static `import "sigstore"` (and other banned heavy modules) in cold-start files. | #84 |
| `no-host-archive-tools.test.ts` | Shelling out to host `tar`/`unzip`/`Expand-Archive`/`gunzip` outside `src/lib/safe-extract.ts`. | #75, #76 |
| `no-absolute-paths-in-fixtures.test.ts` | Machine-absolute paths embedded in committed `tests/fixtures/**/*.json` (e.g. `/Users/...`, `/private/tmp/...`). | round-4-S baseline incident |
| `wrangler-no-replace-with.test.ts` | `REPLACE_WITH_*` placeholders in `apps/dashboard/wrangler.toml`. | #78 |
| `doctor-complexity.test.ts` | `runDoctor` cyclomatic complexity above the project cap (15). | round-4-R |

## How to add a new pin

1. Resolve a bug. Identify the bad pattern.
2. Write the architectural test in this directory.
3. Add it to the table above with the issue/round it came from.
4. Add the pattern to `regression-pins.md` under the right heading (or a new one).

The pins should grow monotonically. Removal only happens when a pattern
becomes provably non-applicable (e.g., dropping support for a platform
that the pin was protecting).

## Why architectural tests over ESLint rules

ESLint rules are great when the pattern is local and lexical. But many
of these patterns require:
- Reading multiple files and asserting cross-file invariants
- Walking the repo (workflows, fixtures)
- Running a real check (typecheck output, complexity calculation)

Architectural tests in vitest can do all of that with the same
`describe`/`it` ergonomics as the rest of the suite, and they show up
in `npm test` so they fail loudly in PRs the same way functional tests
do. They cost ~10s of test runtime and prevent recurring bugs.
