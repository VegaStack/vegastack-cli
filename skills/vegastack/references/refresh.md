# /vegastack refresh

Use this when shared project config should be updated after the repo's stack changes.

Flow:

1. Run `vegastack refresh --dry-run --agent`.
2. Summarize changed detection fields and recommended Registry packs.
3. If the user agrees, run `vegastack refresh --yes --agent`.

This updates `.vegastack/vegastack.yml` only. It must not edit source files.
