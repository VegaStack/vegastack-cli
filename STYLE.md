# STYLE.md — review-time guidance for `@vegastack/cli`

This file is for code reviewers. Cite it in PR comments by section.

## Architecture invariants

1. **CLI is a thin wrapper.** `src/cli.ts` only wires commander → command
   handlers. No business logic. If `cli.ts` is growing past ~200 lines, extract.
2. **Each command is a pure function** of its parsed options. Side effects live
   inside the command handler; they don't escape into the wiring layer.
3. **Per-agent installers implement `AgentInstaller`** (`src/agents/types.ts`).
   New agents go in `src/agents/<name>.ts` plus one line in `src/agents/index.ts`.
4. **`src/lib/` is the dependency floor.** Modules in `lib/` may import each
   other but must not import from `commands/`, `agents/`, or `cli.ts`.

## Errors

- **Throw `VegaStackError`**, never plain `Error`, in command handlers. Each variant
  has a stable exit code and a `hint()` so the user gets _problem → cause → fix_.
- **Catch only what you understand.** `try/catch` should narrow to a specific
  `VegaStackError` subtype or rethrow.
- **Never silently swallow errors.** If a path is "best-effort," call it out
  with `log.warn` and continue.

## Filesystem writes

- **Always honor `--dry-run`.** Every code path that writes must check
  `ctx.dryRun` first and emit `would …` notes instead.
- **Never overwrite user-edited files without `--force`.** This applies to
  Codex `AGENTS.md`, Gemini `CONTEXT.md`, and any future agent's project files.
- **Path safety:** any path that comes from user input (CLI args, environment
  variables, config files) goes through `validate.ts` first. Never pass
  un-validated paths to `fs.*Sync` or `child_process.spawn`.
- **Symlinks must have a fallback.** On Windows, `fs.symlinkSync` throws
  `EPERM` for non-admin users. Wrap in try/catch and copy recursively on failure.

## Output

- **stdout = data, stderr = status.** This is non-negotiable; downstream pipes
  depend on it.
- **structured envelope shape is part of the public API.** Don't reorder fields or
  rename keys without a major version bump.
- **`--agent` mode must be machine-perfect.** No color codes, no extra newlines,
  no partial output on error. JSON in, JSON out.
- **Honor `NO_COLOR` and `TERM=dumb`.** `kleur` does this automatically;
  `process.stderr.isTTY` is the canonical check.

## Dependencies

- **Three runtime deps total:** `commander`, `kleur`, `prompts`. Adding a
  fourth requires a paragraph in the PR explaining why a Node built-in won't do.
- **No native modules.** Anything requiring `node-gyp` is rejected.
- **Prefer `node:`-prefixed imports** for built-ins (`node:fs`, `node:path`).
  Linting will eventually enforce this.

## Tests

- **Every new command, agent, or lib module ships with tests.** No exceptions.
- **Tests don't share state across files.** Use `withTmpDir` from
  `tests/setup.ts` for any test that touches the filesystem.
- **Mock `process.platform` in agent tests** to verify Windows fallbacks
  without needing a Windows runner.
- **Snapshot tests for JSON output** (e.g. `vegastack doctor --agent`) should mask
  per-machine paths via `expect.stringMatching` or normalize-then-snapshot.

## Helpers (rare; v0.2+)

If you're adding a helper command, it must:

- Compose at least two CLI calls or transform the response in a non-trivial way.
- Do something that can't be expressed as a one-liner shell pipeline of
  existing commands. (If it can, document the pipeline instead.)
- Have a unit test plus an integration test against real Registry data.

Lifted from gws-cli's helper anti-pattern list:

- ❌ Wrapping a single API call with prettier flags.
- ❌ Re-implementing arguments that already exist on the underlying API.
- ❌ Adding a "helper" that just renames an existing command.

## PR scope

- **One topic per PR.** Refactors, dep bumps, and feature work go in separate
  PRs. CI gates this loosely (the changeset enforcement); reviewers enforce it
  strictly.
- **Changesets are mandatory** for any change in `src/`, `npm/`, or `skills/`.
  Pure docs / CI / tests changes don't need one.
- **Rebase, don't merge.** Keep the history linear.
