# /vegastack search

Use this for exact source lookup, literal config keys, error strings, workflow keys, resource names, or verifying weak evidence.

Flow:

1. Run `vegastack search --agent --pack <pack> "<literal>"` when the Registry pack is known.
2. Repeat `--pack` for known cross-pack exact lookup, for example `vegastack search --agent --pack cloudflare --pack github-actions "deployment"`.
3. Use `vegastack search --agent --all "<literal>"` for broad exact lookup across installed packs.
4. Without `--pack` or `--all`, the CLI requires project init, caches fresh detection, and includes already-installed supplemental packs when the repo changed.
5. Use `--regex` only when the user asks for pattern matching or the literal search is insufficient.
6. Cite the returned file paths and snippets.

Prefer exact terms that appear in docs: YAML keys, Terraform arguments, Kubernetes kinds, CLI flags, error strings, and workflow permissions.

Before project init, use `--pack <pack>` or `--all`; unscoped search has no
deterministic selected pack set.
