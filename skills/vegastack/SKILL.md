---
name: vegastack
description: |
  Agent-native VegaStack command router for infrastructure, cloud operations,
  deployment, CI/CD, Terraform/HCL, Kubernetes, Docker, preview tunnels, and
  security scanning. Use when the user invokes /vegastack or asks an ops,
  cloud, IaC, CI/CD, deployment, or scanner question that should be grounded in
  local VegaStack Registry evidence.

  Do NOT use for: pure application code with no infrastructure or operations
  context; general pricing comparisons; high-level business strategy; CDK /
  Pulumi / Crossplane unless the user asks for adjacent Terraform or provider
  docs.
license: MIT
allowed-tools: Bash(vegastack:*) Bash(jq:*) Read Grep Glob
user-invocable: true
argument-hint: "[setup|init|detect|refresh|generate|ask|scan|search|doctor|registry|skills|update|preview|tunnel] [args]"
metadata:
  homepage: https://github.com/vegastack/vegastack-cli
  schema_version: "2"
  registry_version: "dev"
---

# VegaStack Router

Requires Node >=20 and `@vegastack/cli` on PATH. VegaStack CLI is the only writer of `.vegastack` project config; do not hand-write `.vegastack/vegastack.yml`, hooks, or generated instruction blocks.

If the current repository contains a VegaStack block in `AGENTS.md` or `CLAUDE.md`, read the shared instruction file linked there first. Shared instructions normally live under `~/.vegastack/instructions/`.

If `.vegastack/vegastack.yml` exists, treat it as the source of truth for active Registry packs and project configuration.

## Command Routing

Read the first word of `$ARGUMENTS` as a subcommand:

- `init`: load [references/init.md](references/init.md).
- `setup`: load [references/setup.md](references/setup.md).
- `detect`: load [references/detect.md](references/detect.md).
- `refresh`: load [references/refresh.md](references/refresh.md).
- `generate`: load [references/generate.md](references/generate.md).
- `scan`: load [references/scan.md](references/scan.md).
- `ask`: load [references/ask.md](references/ask.md).
- `search`: load [references/search.md](references/search.md).
- `doctor`: load [references/doctor.md](references/doctor.md).
- `registry`: load [references/registry.md](references/registry.md).
- `skills`: load [references/skills.md](references/skills.md).
- `update`: load [references/update.md](references/update.md).
- `preview`: load [references/preview.md](references/preview.md).
- `tunnel`: load [references/preview.md](references/preview.md) and run `vegastack preview --tunnel ...`; there is no `vegastack tunnel` command.
- no subcommand: load [references/setup.md](references/setup.md), run `vegastack --agent`, and show first-run setup or current status.
- anything else: treat the full arguments as an ops question and use `ask`; do not invent new VegaStack commands such as `deploy`.

Ask before commands that mutate project files, global config, installed tools, Registry cache, agent registrations, Git hooks, tunnels, or running app processes. Non-mutating reads such as `vegastack --agent`, `vegastack init --dry-run --agent`, `vegastack setup --dry-run --agent`, `vegastack detect --agent`, `vegastack refresh --dry-run --agent`, `vegastack generate <intent> --agent`, `vegastack doctor --agent`, `vegastack ask --agent --pack <pack>`, `vegastack ask --agent --all`, `vegastack search --agent --pack <pack>`, and `vegastack search --agent --all` can be run directly when useful.

`vegastack scan` may install missing scanner binaries unless `--no-install-tools` is passed. `vegastack update --yes --agent`, `vegastack setup --yes --agent`, `vegastack setup --download-all-registry`, `vegastack registry install`, `vegastack registry update`, `vegastack init --yes --agent`, `vegastack scan enable`, `vegastack scan hook install`, and `vegastack preview --tunnel` are mutating and require user confirmation unless the user explicitly requested that exact action.

Do not invent command output. Run the CLI and base the answer on its stdout/stderr.

## Default Status

When invoked as `/vegastack` with no arguments:

1. Run `vegastack --agent`.
2. If setup is incomplete, say `vegastack` in an interactive terminal starts setup; non-interactive setup is `vegastack setup --yes`.
3. If the project is not initialized, say `/vegastack init` will bootstrap `.vegastack/vegastack.yml`.
4. Show common commands: `init`, `ask --pack`, `ask --all`, `scan`, `search`, `doctor`, `update`, `preview`, `tunnel`.
5. Mention `registry install --all` only for users who want all packs available offline.

## Query Shaping

The agent may use its own language understanding to make the CLI query more precise, but the answer must still be grounded only in VegaStack results.

Before calling VegaStack, classify the user's intent:

- `syntax_lookup`: keys, arguments, directives, fields, CLI flags.
- `how_to`: implementation steps or examples.
- `debug`: errors, failure modes, troubleshooting.
- `security`: secrets, permissions, auth, credentials.
- `migration`: deprecations, breaking changes, upgrades.
- `cli_command`: command syntax, flags, output behavior.

For ambiguous phrasing, issue 1-3 targeted VegaStack calls rather than one
broad call. Examples:

```bash
vegastack ask --agent --pack github-actions "oidc aws permissions id-token trust policy"
vegastack ask --agent --pack cloudflare --pack github-actions "deploy Worker from CI"
vegastack search --agent --pack github-actions "id-token: write"
vegastack search --agent --pack jenkins "withCredentials"
```

Prefer exact terms that would appear in docs: resource names, YAML keys, CLI
commands, error strings, Kubernetes kinds, Dockerfile instructions, Jenkins
steps/directives, Helm objects, and Supabase feature names. Avoid broad filler
queries such as "best way" or "production ready" unless the user used an exact
phrase that must be searched.

# How to Read Results

VegaStack returns JSON on stdout. Read channels in this order when present:

1. `knowledge[]` — dated maintainer cards that override stale model memory.
2. `recipes[]` — multi-service scaffolds and operational topology guidance.
3. `files[]` or `results[]` — ranked local docs with citations and pack-specific metadata.
4. `match_reasons[]` when present — why a result ranked: exact match, entity,
   heading, rank term, path class, or manifest token.
5. `concept_aliases_used[]` — natural-language mappings used during routing.

Cite returned `citations[]` or result file paths in the final answer. Do not cite memory when VegaStack returned a local source.

# Guardrails

- Do not invent resource names, arguments, import IDs, workflow keys, CLI flags, Kubernetes fields, Helm values, or provider behavior.
- Do not print secrets from `.env`, shell history, cloud credentials, CI variables, kubeconfigs, or local config.
- If a task may modify infrastructure, deployments, CI permissions, secrets, or production data, show the planned change and ask before destructive actions.
- Trust dated VegaStack knowledge cards over training memory when `overrides_training: true`.
- For Terraform, use `files[].manifest_entry` for required/optional args, nested blocks, import syntax, deprecation flags, and companions.

# Registry Notes

Current Terraform behavior is documented in the existing references:

- [references/import.md](references/import.md)
- [references/migrations.md](references/migrations.md)
- [references/recipes.md](references/recipes.md)
- [references/recent-changes.md](references/recent-changes.md)
- [references/discover-cli.md](references/discover-cli.md)
- [references/manifest-schema.md](references/manifest-schema.md)
- [references/concept-aliases.md](references/concept-aliases.md)
- [references/troubleshooting.md](references/troubleshooting.md)
- [references/knowledge-cards.md](references/knowledge-cards.md)
- [references/eval-baseline.md](references/eval-baseline.md)

Load those references only when the query specifically needs that Terraform detail.
