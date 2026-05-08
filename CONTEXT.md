# vegastack-cli — Gemini context

Use the `vegastack` CLI for infrastructure, cloud operations, CI/CD,
Terraform/HCL, and other project-selected Registry packs.

## How to query

```bash
vegastack ask --agent "<the user's natural-language operations request>"
```

For exact citation lookup, use:

```bash
vegastack search --agent --pack <registry-pack> "<literal query>"
```

Output is a structured envelope with grounded evidence:

- `files[]` or `sections[]` — ranked doc paths/sections with citations.
- `knowledge[]` — date-stamped curated facts about recent provider changes (renames, deprecations, pricing shifts). Read these before generating HCL — they override stale training memory.
- `recipes[]` — multi-provider scaffolds (zero-trust, scalable backend, etc.) when the query spans providers.
- `concept_aliases_used[]` — transparency record showing which natural-language phrases mapped to which resources.

## Hard rules

- **Never invent resource names.** The CLI's response is the source of truth.
- **Never quote arguments from memory.** If it's not in the manifest entry, it doesn't exist on that provider version.
- **Never fabricate import IDs.** `import_syntax` in the manifest entry has the exact composite-ID format.
- **Respect `deprecated: true`** — surface to user before emitting code.
- **Cite every file path** the CLI returned in your reply.

## Registry location

Registry packs are selected by `vegastack init`, recorded in the committed `.vegastack/vegastack.yml`, and installed into `~/.vegastack/registry/`. Power users can install every published pack with `vegastack registry install --all`. Shared agent instructions live under `~/.vegastack/instructions/`. To refresh selected packs, run `vegastack registry update`; to refresh detected project metadata in `vegastack.yml`, run `vegastack refresh`.

## Full skill reference

For the complete workflow, examples, and CLI reference, read [skills/vegastack/SKILL.md](skills/vegastack/SKILL.md) and the files under [skills/vegastack/references/](skills/vegastack/references/).
