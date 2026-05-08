# /vegastack skills

Use this for agent skill registration across the six supported hosts:
**claude-code, codex, cursor, gemini, continue, aider** (plus `all`).

`--host` accepts a single name from that list, a comma-separated list (e.g.
`--host claude-code,codex`), or `all`. `--scope` is `global` or `project`;
not every host supports both — for example, `cursor` is project-only and
`gemini` (modern renderer) defaults to `global` under `~/.gemini/extensions/vegastack/`.

The host list is the single source of truth in `src/agents/index.ts`
(`ALL_RENDERER_NAMES`) and `src/cli.ts` (`VALID_AGENT_HOSTS`); a
regression test in `tests/architecture/templates-and-host-list.test.ts` keeps this
file in sync with that registry.

## Flow

1. For read-only status, run `vegastack skills status --host all --agent`.
2. For a non-mutating install plan, run `vegastack skills install --host all --dry-run --agent`.
3. To install for detected/global agent hosts, prefer `vegastack skills reconcile --dry-run --agent`, then `vegastack skills reconcile --agent` after user confirmation.
4. To install a specific agent host, run `vegastack skills install --host <host> --scope <global|project> --agent`.
5. To uninstall, run `vegastack skills uninstall --host <host> --scope <global|project> --agent` only after explicit confirmation.

`install`, `uninstall`, and `reconcile` mutate agent directories or project files. Use `--force` only when the user agrees to overwrite existing files/symlinks.

## Per-host install footprint

| Host | Default scope | Where files land |
|---|---|---|
| `claude-code` | global / project | `~/.claude/plugins/marketplace/vegastack/` (global), `<cwd>/.claude/plugins/.../` (project) |
| `codex` | global / project | `~/.agents/skills/vegastack/` symlink + optional `~/.codex/AGENTS.md` |
| `cursor` | project only | `<cwd>/.cursor/rules/vegastack-cli.mdc` |
| `gemini` | global / project | `~/.gemini/extensions/vegastack/{gemini-extension.json,skills/vegastack/SKILL.md,commands/vegastack.toml}` |
| `continue` | global / project | `~/.continue/mcpServers/vegastack.yaml` (global), `<cwd>/.continue/...` (project) |
| `aider` | global / project | `<scope>/CONVENTIONS.vegastack.md` + `<scope>/.aider.conf.yml` `read[]` patch |
