# /vegastack detect

Use this when the user explicitly wants to inspect repo detection. Normal project-aware commands already cache fresh detection.

Flow:

1. Run `vegastack detect --json`.
2. Use detected package manager, commands, framework, CI, deploy, container, and IaC facts.
3. If status is `needs_input`, ask the returned questions before generating files.
4. If `stale.changed` is true, mention that normal project-aware commands cache detection automatically; use `/vegastack refresh` only to update committed `.vegastack/vegastack.yml`.

Do not guess package manager, runtime, or deploy target when detection returned a value.
