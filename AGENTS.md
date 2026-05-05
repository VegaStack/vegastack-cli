# AGENTS.md - vegastack-cli

This repo ships `@vegastack/cli`, a local-first VegaStack Registry harness for coding agents.

## Use The CLI

- Build grounded evidence: `vegastack ask "<query>"`.
- Exact source lookup: `vegastack search --entry <entry> "<literal>"`.
- Terraform-specific query: `vegastack ask --entry terraform --tf-provider <provider> "<query>"`.
- Project setup: `vegastack init`.
- Registry refresh: `vegastack registry update`.
- Health check: `vegastack doctor --verify-registry`.

Do not add compatibility shims for removed shortcut commands. Keep the public surface on `ask`, `search`, `init`, `registry update`, and `doctor`.

## Project State

`vegastack init` writes:

- `.vegastack/project.json`
- `.vegastack/vegastack-lock.json`
- `.vegastack/instructions/AGENTS.md`
- `.vegastack/instructions/CLAUDE.md`
- `.vegastack/instructions/README.md`

Registry data lives in the user's cache at `~/.config/vegastack/registry/`.

## Source Layout

| Path | Purpose |
| --- | --- |
| `src/cli.ts` | Commander entrypoint. |
| `src/commands/` | `init`, `ask`, `search`, `registry`, `doctor`, `skills`, `secrets`, `preview`, `update`. |
| `src/lib/registry.ts` | Signed Registry catalog fetch, archive download, extraction, artifact verification. |
| `src/lib/registry-search.ts` | Deterministic exact source search. |
| `src/lib/discover*` | Terraform Registry pack discovery internals used by `ask --entry terraform`. |
| `src/agents/` | Agent renderers for Claude Code, Codex, Cursor, Gemini, Continue, Aider. |
| `skills/vegastack/` | Shipped skill body and references. |
| `registry/skill-source/` | Canonical skill template. |
| `npm/` | npm bin and postinstall wrappers. |

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

## Style

- TypeScript, ESM, strict mode.
- stdout is for JSON/data; stderr is for human status.
- Keep public command names predictable: `ask`, `search`, `init`, `registry update`, `doctor`.
- Do not add compatibility shims for removed command names.
- Public docs should send bugs and feature requests to https://github.com/vegastack/vegastack-cli/issues.
- Use `team@vegastack.com` only for package metadata that requires an email field.
