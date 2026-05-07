# /vegastack search

Use this for exact source lookup, literal config keys, error strings, workflow keys, resource names, or verifying weak evidence.

Flow:

1. Run `vegastack search --entry <entry> "<literal>"` when the Registry entry is known.
2. Repeat `--entry` for known cross-pack exact lookup, for example `vegastack search --entry cloudflare --entry github-actions "deployment"`.
3. Use `vegastack search --all "<literal>"` for broad exact lookup across installed packs.
4. Without `--entry` or `--all`, the CLI caches fresh detection and includes already-installed supplemental entries when the repo changed.
5. Use `--regex` only when the user asks for pattern matching or the literal search is insufficient.
6. Cite the returned file paths and snippets.

Prefer exact terms that appear in docs: YAML keys, Terraform arguments, Kubernetes kinds, CLI flags, error strings, and workflow permissions.
