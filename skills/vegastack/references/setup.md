# /vegastack setup

Use this for global machine setup.

Flow:

1. Run `vegastack setup --dry-run --json`.
2. Summarize global config path, managed tools, detected agent skills, and missing optional CLIs.
3. If the user agrees, run `vegastack setup --yes --json`.

This writes global state under `~/.vegastack/`, creates shared instructions under `~/.vegastack/instructions/`, installs recommended managed tools, and reconciles detected global agent skills. It must not create project files.
