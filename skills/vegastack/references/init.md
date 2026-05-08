# /vegastack init

Use this when the user explicitly invokes `/vegastack init` or asks to bootstrap VegaStack for the current repository.

Flow:

1. Run `vegastack init --dry-run --agent`.
2. Summarize detected stack, selected Registry packs, scan checks, agent hosts, and planned files.
3. Ask only the high-value setup questions that are not already obvious:
   - security posture: `standard` unless the user asks for stricter or minimal scanning.
   - pre-commit hook: enable fast staged scan when `.git` exists unless the user declines.
   - preview tunnels: enable managed cloudflared support by default, but do not expose anything until `preview`/`tunnel` runs.
   - CI mutation: do not edit CI files unless the user explicitly asks.
4. Run the CLI once with resolved non-interactive flags:
   - baseline: `vegastack init --yes --agent`
   - add `--scan` or `--no-scan`
   - add `--scan-hook` when pre-commit is enabled
   - add `--no-tunnels` when preview support is disabled
   - add `--no-skills` only if the user declines agent skill setup
5. Report the written files and next command to run.

Do not hand-write `.vegastack/vegastack.yml`, hooks, or VegaStack-managed instruction blocks. The CLI owns those files/blocks.
