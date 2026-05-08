# /vegastack skills

Use this for agent skill registration across Claude Code, Codex, Cursor, Gemini, Continue, and Aider.

Flow:

1. For read-only status, run `vegastack skills status --host all --agent`.
2. For a non-mutating install plan, run `vegastack skills install --host all --dry-run --agent`.
3. To install for detected/global agent hosts, prefer `vegastack skills reconcile --dry-run --agent`, then `vegastack skills reconcile --agent` after user confirmation.
4. To install a specific agent host, run `vegastack skills install --host <host> --scope <global|project> --agent`.
5. To uninstall, run `vegastack skills uninstall --host <host> --scope <global|project> --agent` only after explicit confirmation.

Valid agents are `claude-code`, `codex`, `cursor`, `gemini`, `continue`, `aider`, and `all`. Valid scopes are `global` and `project`; not every renderer supports both scopes.

`install`, `uninstall`, and `reconcile` mutate agent directories or project files. Use `--force` only when the user agrees to overwrite existing files/symlinks.
