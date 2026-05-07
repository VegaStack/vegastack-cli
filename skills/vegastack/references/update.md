# /vegastack update

Use this to update the VegaStack CLI, project-selected Registry packs, managed tool binaries, and detected global agent skill registrations.

Flow:

1. For a dry status check, run `vegastack update --check`.
2. To update everything, run `vegastack update`.
3. To accept non-destructive prompts such as installing missing global skills, run `vegastack update --yes`.
4. To update only Registry packs, run `vegastack registry update`; this must not update CLI, tools, or skills.
5. For automation, run `vegastack update --yes --json`.

`vegastack update` mutates local/global state: it can update the npm CLI, project-selected Registry packs, managed tool binaries, and detected global agent skill registrations. Ask before running it unless the user explicitly requested the update.

Use `--no-cli`, `--no-registry`, or `--no-tools` to narrow the mutation scope. Use `--all-registry` only when the user wants every installed Registry pack updated, not just project-selected entries.

Do not push, publish, tag, or trigger release workflows as part of update.
