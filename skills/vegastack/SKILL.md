---
name: vegastack
description: |
  Use when the user asks about infrastructure, cloud operations, deployment,
  CI/CD, Terraform/HCL, GitHub Actions, Docker, Kubernetes, Helm, Supabase,
  AWS CLI, or any provider/service in a provision/configure/migrate/debug
  context. VegaStack is a local-first knowledge harness: it routes the query
  through project-selected registry entries and returns citations from the
  local cache. Trigger on "deploy", "provision", "configure", "import",
  "migrate", "write workflow", "Dockerfile", "kubectl", "helm chart",
  "supabase", "*.tf", "*.hcl", and cloud/SaaS operational tasks.

  Do NOT use for: pure application code with no infrastructure or operations
  context; general pricing comparisons; high-level business strategy; CDK /
  Pulumi / Crossplane unless the user asks for adjacent Terraform or provider
  docs.
license: MIT
allowed-tools: Bash(vegastack:*) Bash(jq:*) Read Grep Glob
metadata:
  homepage: https://github.com/vegastack/vegastack-cli
  schema_version: "2"
  registry_version: "dev"
  providers_count: "31"
---

# Dispatch

Requires Node >=18 and `@vegastack/cli` on PATH. Run `vegastack init` once per project.

If the current repository contains `.vegastack/instructions/`, read the matching project-local instruction file first:

- Codex / AGENTS.md-compatible agents: `.vegastack/instructions/AGENTS.md`
- Claude Code: `.vegastack/instructions/CLAUDE.md`

If `.vegastack/project.json` or `.vegastack/vegastack-lock.json` exists, treat those files as the source of truth for active registry entries. If they do not exist and the user is asking an ops/cloud/IaC/CI/CD question, tell them to run `vegastack init` before relying on VegaStack grounding.

Default command:

```bash
vegastack ask "<the user's request, in natural language>"
```

Use `vegastack ask --all "<query>"` only when the user explicitly wants a broad local search outside the project lock.

Use `vegastack search --entry <registry-entry> "<literal text>"` for exact source lookup or debugging weak evidence.

For Terraform/HCL work, use `vegastack ask --entry terraform --tf-provider <provider> "<query>"`.

# Query Shaping

The agent may use its own language understanding to make the CLI query more
precise, but the answer must still be grounded only in VegaStack results.

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
vegastack ask --entry github-actions "oidc aws permissions id-token trust policy"
vegastack search --entry github-actions "id-token: write"
vegastack search --entry jenkins "withCredentials"
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
3. `files[]` or `results[]` — ranked local docs with citations and entry-specific metadata.
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

Load those references only when the query specifically needs that Terraform detail.
