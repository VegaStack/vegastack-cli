# /vegastack registry

Use this for local Registry pack cache operations.

Flow:

1. For read-only published/local state, run `vegastack registry list --json`.
2. For local cache state only, run `vegastack registry status --json`.
3. To update project-selected entries, run `vegastack registry update --json`.
4. To update one entry, run `vegastack registry update <entry> --json`.
5. Use `--all` only when the user wants every installed Registry pack updated.
6. Use `--force` only when repairing stale/corrupt cache or when the user asks to re-download.

`registry update` mutates `~/.vegastack/registry/` and may use the network. Ask before running it unless the user explicitly requested a Registry update.
