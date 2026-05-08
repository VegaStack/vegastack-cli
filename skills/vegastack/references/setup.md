# /vegastack

Use this for first-run global setup or current VegaStack status. `vegastack setup`
is still available when the user explicitly wants to re-run global setup.

Flow:

1. Run `vegastack --agent` for a read-only first-run/status check.
2. If setup is incomplete and the user wants to continue, run `vegastack` in an interactive terminal or `vegastack setup --yes --agent`.
3. If the user wants offline/power-user docs, run `vegastack registry install --all --agent`.
4. Summarize global config path, Registry cache path, managed tools, detected agent skills, and next command.

Global setup writes state under `~/.vegastack/`, creates shared instructions
under `~/.vegastack/instructions/`, installs recommended managed tools, and
reconciles detected global agent skills. It must not create project files.
