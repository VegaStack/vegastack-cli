# /vegastack skills

Use this for agent skill registration across Claude Code, Codex, Cursor, Gemini, Continue, and Aider.

Flow:

1. For read-only status, run `vegastack skills status --agent all --json`.
2. For a non-mutating install plan, run `vegastack skills install --agent all --dry-run --json`.
3. To install for detected/global agents, prefer `vegastack skills reconcile --dry-run --json`, then `vegastack skills reconcile --json` after user confirmation.
4. To install a specific agent, run `vegastack skills install --agent <agent> --scope <global|project> --json`.
5. To uninstall, run `vegastack skills uninstall --agent <agent> --scope <global|project> --json` only after explicit confirmation.

Valid agents are `claude-code`, `codex`, `cursor`, `gemini`, `continue`, `aider`, and `all`. Valid scopes are `global` and `project`; not every renderer supports both scopes.

`install`, `uninstall`, and `reconcile` mutate agent directories or project files. Use `--force` only when the user agrees to overwrite existing files/symlinks.
