# AGENTS.md - vegastack-cli

This repo ships `@vegastack/cli`, a local-first VegaStack Registry harness for coding agents.

## Use The CLI

- Build grounded evidence: `vegastack ask "<query>"`.
- Exact source lookup: `vegastack search --pack <pack> "<literal>"`.
- Terraform-specific query: `vegastack ask --pack terraform --tf-provider <provider> "<query>"`.
- Global first-run/status: `vegastack`.
- Project setup: `vegastack init`.
- Download every published pack: `vegastack registry install --all`.
- Registry refresh: `vegastack registry update`.
- Security scan: `vegastack scan`.
- Health check: `vegastack doctor --verify-registry`.

Do not add compatibility shims for removed shortcut commands. Keep the public surface predictable.

## Project State

`vegastack init` writes:

- `.vegastack/vegastack.yml`
- shared instruction files under `~/.vegastack/instructions/`
- small managed pointers in project `AGENTS.md` / `CLAUDE.md` when those agent hosts are detected

Registry data lives in the user's cache at `~/.vegastack/registry/`.

## Source Layout

| Path                         | Purpose                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `src/cli.ts`                 | Commander entrypoint.                                                                 |
| `src/commands/`              | `setup`, `init`, `ask`, `search`, `registry`, `doctor`, `skills`, `scan`, `preview`, `update`. |
| `src/lib/registry.ts`        | Signed Registry catalog fetch, archive download, extraction, artifact verification.   |
| `src/lib/registry-search.ts` | Deterministic exact source search.                                                    |
| `src/lib/discover*`          | Terraform Registry pack discovery internals used by `ask --pack terraform`.          |
| `src/agents/`                | Agent renderers for Claude Code, Codex, Cursor, Gemini, Continue, Aider.              |
| `skills/vegastack/`          | Shipped skill body and references.                                                    |
| `registry/skill-source/`     | Canonical skill template.                                                             |
| `npm/`                       | npm bin and postinstall wrappers.                                                     |

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

For local Registry testing:

```bash
VEGASTACK_REGISTRY_DIR=/Users/mk/projects/vegastack-cli-registry/cli/packs \
  node dist/cli.js doctor --verify-registry
```

## Contributor Workflows

Two contributor-facing skills run audits and fixes for this repo. Both Claude
Code (via `skills/`) and Codex (via this section of `AGENTS.md`) should pick
them up. They are not user-facing CLI commands.

- **`/vegastack-audit`** — production-readiness audit covering 11 categories
  (repo-hygiene, supply-chain, secrets, security, code-quality, code-review,
  test-coverage, cross-platform, performance, docs-and-ux, release-readiness).
  Writes a single timestamped report under `audits/audit-<epoch>-<iso>-<scope>.md`
  and (in standalone mode) opens deduped GitHub issues. See
  [`.claude/skills/vegastack-audit/SKILL.md`](.claude/skills/vegastack-audit/SKILL.md).

- **`/vegastack-fix`** — validate-then-fix loop with strict anti-bluff TDD:
  reproduces with a failing test, maps blast radius (grep + ts-morph), applies
  a minimal fix, runs full verification + agentic mutation review, posts
  evidence to the GitHub issue, auto-closes. Accepts a finding ID, GH issue
  URL/number, or free-text bug. See
  [`.claude/skills/vegastack-fix/SKILL.md`](.claude/skills/vegastack-fix/SKILL.md).

`/ship` chains both skills before any release: `vegastack-audit` runs in
**ephemeral mode** (no GitHub issues; findings stay local), then optional
`vegastack-fix --auto` resolves Critical/High findings, then the existing ship
flow proceeds. See `.claude/skills/ship/SKILL.md`.

## Release Gate

Do not push, tag, publish, dispatch release workflows, move npm dist-tags, or
trigger Registry/R2 publishing unless the maintainer gives explicit release
approval in the current conversation.

Implementation approval is not release approval. Phrases like "go ahead",
"proceed", "implement it", "fix it", "looks good", or "ship-ready" are approval
to edit and test only; they are not approval to run `git push`, `git tag`,
`gh workflow run`, `npm publish`, `npm dist-tag`, or any command that publishes
to npm, GitHub Releases, or R2.

Before any release action, show the exact commands that will publish or mutate
remote state, summarize the version/channel impact, and wait for a direct final
approval such as "push this branch", "publish 0.1.13-next.0 to next", "tag and
release 0.1.12 to latest", or "move latest to 0.1.12". If the approval is
ambiguous, stop and ask.

Read `.claude/skills/ship/SKILL.md` before any requested release work and follow
its stricter gate. These rules apply to all agents, including Codex and Claude
Code.

## Style

- TypeScript, ESM, strict mode.
- stdout is for JSON/data; stderr is for human status.
- Keep public command names predictable: `ask`, `search`, `init`, `registry install`, `registry update`, `scan`, `doctor`.
- Do not add compatibility shims for removed command names.
- Public docs should send bugs and feature requests to https://github.com/vegastack/vegastack-cli/issues.
- Use `team@vegastack.com` only for package metadata that requires an email field.
