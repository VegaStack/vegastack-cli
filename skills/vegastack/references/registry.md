# /vegastack registry

Use this for local Registry pack cache operations.

Flow:

1. For read-only published/local state, run `vegastack registry list --agent`.
2. For local cache state only, run `vegastack registry status --agent`.
3. To download one pack, run `vegastack registry install <pack> --agent`.
4. To download every published pack, run `vegastack registry install --all --agent`.
5. To update project-selected packs, run `vegastack registry update --agent`.
6. To update one pack, run `vegastack registry update <pack> --agent`.
7. Use `registry update --all` only when the user wants every installed Registry pack updated.
8. Use `--force` only when repairing stale/corrupt cache or when the user asks to re-download.

`registry install` and `registry update` mutate `~/.vegastack/registry/` and may
use the network. Ask before running them unless the user explicitly requested a
Registry download or update.
