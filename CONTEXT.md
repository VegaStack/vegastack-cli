# vegastack-cli — Gemini context

Use the `vegastack` CLI for infrastructure, cloud operations, CI/CD, Terraform/HCL, GitHub Actions, Docker, Kubernetes, Helm, Supabase, AWS CLI, Jenkins, and other project-selected Registry entries.

## How to query

```bash
vegastack ask "<the user's natural-language operations request>"
```

For exact citation lookup, use:

```bash
vegastack search --entry <registry-entry> "<literal query>"
```

Output is a JSON envelope with grounded evidence:

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

Registry entries are selected by `vegastack init`, installed into `~/.config/vegastack/registry/`, and locked per project in `.vegastack/vegastack-lock.json`. To refresh selected entries, run `vegastack registry update`.

## Full skill reference

For the complete workflow, examples, and CLI reference, read [skills/vegastack/SKILL.md](skills/vegastack/SKILL.md) and the files under [skills/vegastack/references/](skills/vegastack/references/).
