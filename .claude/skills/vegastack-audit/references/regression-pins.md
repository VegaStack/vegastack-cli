# Regression-Prevention Pins (audit category 12)

After a fix lands, the next audit must verify the fix won't silently regress.
The mechanism is an **architectural test** that fails if the bad pattern
re-appears. Without it, fix #N+1 (touching the same file for unrelated reasons)
can re-introduce the original bug.

This category catalogs the **regression-prevention patterns** an audit
should look for. Each pattern is `(architectural-test exists?, where to
look for the bad pattern)`. Findings here are typically `Low` — quality
gaps, not user-facing bugs — but they compound over time.

## Patterns to check per audit run

### `import "<heavy-module>"` in cold-start path

**Bad pattern:** static `import` of `sigstore`, large native packages, or
the entire commands surface inside `src/cli.ts` or any module reachable
from `--help`.

**Pin:** `tests/architecture/no-eager-heavy-imports.test.ts` reads
`src/cli.ts` and `src/lib/registry-signature.ts` and asserts no static
`import` of names in a banned-list. Add modules to the banned-list as new
heavy deps land.

**Why:** every static import inflates cold start by tens of ms. The
discovery loop here is "cold start grew" → grep `cli.ts` for new
top-level imports → either move behind a dynamic `import()` inside the
command's `.action()` handler, or add the module to the architectural
test's allowlist with a comment justifying it.

### `spawnSync("npm" | "vegastack" | "<.cmd-shimmed>")` outside the helper

**Bad pattern:** bare `child_process.spawnSync` of binaries that ship as
`.cmd` shims on Windows. Node 20.10+ refuses to exec those without
`shell: true` (CVE-2024-27980 mitigation).

**Pin:** `tests/architecture/no-bare-cmd-spawn.test.ts` greps `src/` for
`spawnSync("npm"|"vegastack"|"npx"|"yarn"|"pnpm")` and asserts zero
matches outside `src/lib/spawn-cmd.ts`. All those calls must go through
`spawnCmdSync`.

### `tar -xzf` / `unzip` / `Expand-Archive` shell-out

**Bad pattern:** shelling to host extractors. Risks:
- `unzip` not present on Alpine/musl
- `Expand-Archive` not present on pwsh-only Windows
- Neither validates entry types pre-write (zip-slip, symlink escape, device files)

**Pin:** `tests/architecture/no-host-archive-tools.test.ts` greps `src/`
for execution of `tar`/`unzip`/`Expand-Archive`/`gunzip` and asserts zero
matches outside `src/lib/safe-extract.ts`.

### Floating `@v<N>` GitHub Action references

**Bad pattern:** `uses: actions/checkout@v4` (tag) instead of
`uses: actions/checkout@<40-char-sha>  # v4`. Supply-chain compromise
vector if the tag gets retagged.

**Pin:** `tests/architecture/pinned-actions.test.ts` walks
`.github/workflows/*.yml` and asserts every `uses:` ends in a 40-char
SHA. Already exists from the round-1 #64 fix.

### Cyclomatic complexity over the project's threshold

**Bad pattern:** new code that pushes a function over the
project-defined complexity cap (currently 15). Drives an asymptote of
"impossible to refactor without a characterization fixture."

**Pin:** ESLint rule `complexity: ["error", 15]` plus per-file pin tests
for hot-path functions (e.g. `tests/commands/doctor-complexity.test.ts`).
The audit category looks for `npx eslint --rule '{"complexity":["error",15]}' src` exit code != 0.

### `REPLACE_WITH_*` placeholders in committed config

**Bad pattern:** any committed file that says
`REPLACE_WITH_<thing>` and would fail at deploy/run-time. The committed
state must be deploy-ready (or the placeholder must be commented-out
documentation).

**Pin:** generic `tests/architecture/no-replace-with.test.ts` walks the
repo and asserts no file (outside its own commented sections) contains
that token.

### Absolute paths in committed test fixtures

**Bad pattern:** baseline JSON files that contain hard-coded absolute
paths from where they were generated. Breaks the suite for anyone who
clones into a different parent directory.

**Pin:** `tests/architecture/no-absolute-paths-in-fixtures.test.ts`
walks `tests/fixtures/**/*.json` and asserts no string starts with `/`
followed by a real-looking system path (`/Users/`, `/private/tmp/`,
`/home/`, `C:\\`). Comparison fixtures must be repo-relative.

### Non-atomic file writes in `lib/`

**Bad pattern:** `fs.writeFileSync(...)` for any file that the same
process or sibling processes might read. A power-loss during write
leaves a truncated file that `JSON.parse` chokes on.

**Pin:** `tests/architecture/atomic-writes.test.ts` greps `src/lib/` for
direct `fs.writeFileSync` and asserts each call site is either:
- Inside `src/lib/fs-utils.ts::atomicWriteFileSync` (the helper itself), OR
- Annotated with `// architectural: writeFileSync ok because <reason>`.

### `// @ts-ignore` / `// @ts-expect-error` without explanation

**Bad pattern:** suppression comments without a follow-up justification.
Usually a sign that a bug was hidden rather than fixed.

**Pin:** `tests/architecture/justified-ts-suppressions.test.ts` reads
all `.ts` files; for every `@ts-ignore`/`@ts-expect-error` line, asserts
the line above contains an explanation comment with at least 30 chars.

## How the audit category runs

For each pattern above:
1. Check if the architectural test file exists.
2. If yes — confirm it's in the regular test suite (gets run).
3. If no — emit a finding (severity Low) with cited evidence:
   "regression pin missing for <pattern>; recommend
   `tests/architecture/<file>.test.ts` per references/regression-pins.md".

The audit subagent for `regression-prevention` should produce ≤8 findings
per run. The category is intentionally small: the pins it recommends are
high-leverage and stable across releases.

## When to add a new pattern to this catalog

Whenever a `/vegastack-fix` round resolves an issue and the fix has the
shape "this could regress if a future change does X again":
1. Write the architectural test as part of the fix's GREEN commit.
2. Add the pattern to this catalog under the right heading (or a new
   one).
3. Update the audit category's expected-pin list.

This catalog grows monotonically. Rare to remove patterns — only when a
pattern is provably no longer applicable (e.g., we drop support for
Windows entirely → ban-bare-spawnSync becomes moot).
