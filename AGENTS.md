# AGENTS.md — vegastack-cli

This file is read by Codex, Cursor, Gemini, and any agent that follows the AGENTS.md convention. It tells the agent what this repo is, how to use it, and the rules.

## What this repo ships

`@vegastack/cli` — an npm-installable knowledge harness for coding agents. After `npm i -g @vegastack/cli` and `vegastack skills install`, the agent gains:

- A bundled docs library for **31 Terraform providers** (~9,000 markdown files, ~97 MB on disk after extract).
- A deterministic discovery CLI: `vegastack tf "<query>"` returns a JSON envelope with ranked files, knowledge cards (recent-change facts), recipes (multi-provider scaffolds), and concept aliases.
- An [Anthropic Agent Skills Standard](https://agentskills.io/specification) skill body at `skills/vegastack/SKILL.md` — read this for the full agent-side mental model.

## Skill router

This project ships ONE skill (`vegastack`) for v0.1.x. v0.2 may split it into:

- `tf-discover` — resource/argument/import-id lookup (the heavy CLI invocation path)
- `tf-recipes` — cross-provider topology recipes
- `tf-knowledge` — recent renames / deprecations / native-feature replacements

For v0.1.x, agents call `vegastack tf "<query>"` directly. The router pattern is documented here so v0.2's split is non-breaking: the dispatcher will live at this same router section and will only add new skill names, never rename or remove `vegastack`.

## When to use it

Trigger on any of these:

- "create a `<resource>`", "terraform for `<service>`", "how do I deploy X on Y"
- "what arguments does `<resource>` accept", "is `<resource>` deprecated", "import `<resource>`"
- Multi-provider topology: zero-trust, scalable backend, GKE+Cloudflare, GitHub Actions → EKS
- Anything about _recent_ provider changes (renames, deprecations, pricing shifts)

When in doubt, trigger. An invented resource name will fail `terraform plan`.

## How to query

```bash
vegastack tf "<the user's natural-language Terraform request>"
```

The response is a single JSON envelope on stdout. Read these arrays in order:

1. **`knowledge[]`** — date-stamped curated cards capturing what training memory gets wrong. Read first; cite each card's `authoritative_source`.
2. **`recipes[]`** — multi-provider scaffolds with templated HCL. Use when the prompt spans providers.
3. **`files[]`** — ranked doc files. Each top-K entry includes `manifest_entry` (full schema: required/optional/computed args, enum values, import syntax, deprecation flag, recommended companions) and `example_usage` (the canonical HCL block) **inline** in v0.2+. In v0.1 follow up with `jq` against the bundle's MANIFEST.json files.
4. **`concept_aliases_used[]`** — transparency record. Surface to the user.

Cite every file path returned in `citations[]` (or in `files[].path`) at the end of your reply.

## Hard rules

- **Never invent resource names.** If `vegastack tf` doesn't return it, it doesn't exist on this provider version.
- **Never quote arguments from memory.** If it's not in `manifest_entry.required_args`/`optional_args`/`computed_attrs`, it doesn't exist.
- **Never fabricate import IDs.** `manifest_entry.import_syntax` has the exact composite-ID format.
- **Respect `deprecated: true`** — surface to the user before emitting code.
- **Pin provider version.** Read the bundle's root `MANIFEST.json` (`cat $VEGASTACK_BUNDLE/MANIFEST.json`) for `upstream_sha` / `branch` / `synced_at` fields.
- **One provider per `vegastack tf` call.** Multi-provider work uses the recipes channel.

## Repo layout (where to look for what)

| Path                                   | Purpose                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`                           | CLI entry (commander.js)                                                                                                                  |
| `src/commands/`                        | `doctor`, `install`, `refresh`, `skills` (install/uninstall/status), `tf`                                                                 |
| `src/agents/`                          | Per-agent installers: `claude-code`, `codex`, `cursor`, `gemini`                                                                          |
| `src/lib/`                             | `paths.ts` (canonical filesystem locations), `bundle.ts` (status), `discover.ts` (calls Python harness in v0.1; native in v0.2), `log.ts` |
| `npm/install.js`                       | Postinstall: download bundle from GitHub Releases, SHA256 verify, extract                                                                 |
| `npm/run.js`                           | npm bin entry, delegates to compiled `dist/cli.js`                                                                                        |
| `skills/vegastack/`               | The shipped Anthropic Agent Skills skill (SKILL.md + references/)                                                                         |
| `.claude-plugin/plugin.json`           | Claude Code plugin manifest                                                                                                               |
| `.agents/skills/vegastack/`       | Symlink to `skills/vegastack/` for Codex                                                                                             |
| `cursor-rule.mdc`                      | Cursor rule template (copied to `<cwd>/.cursor/rules/` on install)                                                                        |
| `gemini-extension.json` + `CONTEXT.md` | Gemini Code Assist integration                                                                                                            |
| `PORT-ROADMAP.md`                      | Plan to drop Python in v0.2 (read this before changing the harness shape)                                                                 |

## Development workflow

```bash
npm install               # installs deps; postinstall tries to fetch bundle (warns if 404)
npm run typecheck         # tsc --noEmit
npm run build             # tsc -p tsconfig.build.json → dist/
npm test                  # vitest

# Smoke-test against the upstream repo's docs (no bundle download needed):
VEGASTACK_BUNDLE_DIR=/path/to/engg-vegastack-agent-tf-providers/terraform-providers \
  node dist/cli.js doctor

# Build a local bundle from the upstream repo and install it via file://:
( cd ../engg-vegastack-agent-tf-providers && bash scripts/build_bundle.sh --version 0.1.0 )
VEGASTACK_BUNDLE_URL=file:///path/to/dist/vegastack-bundle-v0.1.0.tar.gz \
VEGASTACK_BUNDLE_DIR=/tmp/test-install \
  node npm/install.js
```

## Releases (changesets)

```bash
npx changeset           # add a changeset for your PR (patch / minor / major)
git commit && git push  # changesets/action opens a release PR on main
# merge → version bumps → tag pushes → release.yml builds + npm publishes
```

## Style

- TypeScript, ESM, `"strict": true`, `noUncheckedIndexedAccess: true`. Keep dependencies minimal (currently: commander, kleur, prompts).
- Per-agent installers are small classes (~60 lines each); add new agents by implementing `AgentInstaller` in `src/agents/<name>.ts` and registering in `src/agents/index.ts`.
- Output: stdout for data (JSON envelopes), stderr for human-readable status. Default to TTY-aware coloring via kleur; disable for `NO_COLOR=1`.

## Where the docs come from

The 97 MB doc bundle is built by a separate repo:

- **`vegastack/engg-vegastack-agent-tf-providers`** — daily cron (02:00 UTC) syncs upstream provider repos, builds per-provider `MANIFEST.json` with deterministic indexes, runs validation, then 03:30 UTC builds `vegastack-bundle-vYYYY.MM.DD.tar.gz` and uploads it as a release asset on this repo (`vegastack-cli`).

This repo (`vegastack-cli`) only ships the CLI + skill content. Doc content lives upstream.
