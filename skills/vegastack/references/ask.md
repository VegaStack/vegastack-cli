# /vegastack ask

Use this for ops, cloud, IaC, CI/CD, Terraform, Kubernetes, Docker, Supabase, Jenkins, GitHub Actions, preview, or deployment questions.

Flow:

1. If `.vegastack/vegastack.yml` is missing, use explicit scope for a read-only answer: `vegastack ask --agent --pack <pack>` when the pack is known, or `vegastack ask --agent --all` when the user wants broad search across installed packs.
2. Run `vegastack ask --agent "<query>"`; the CLI caches fresh detection and includes already-installed supplemental packs when the repo changed.
3. For known cross-pack questions, repeat `--pack`, for example `vegastack ask --agent --pack cloudflare --pack github-actions "deploy Worker from CI"`.
4. For broad cross-pack questions, use `vegastack ask --agent --all "<query>"` only when the user asks for broad search or the project is not initialized.
5. For Terraform provider-specific work, prefer `vegastack ask --agent --pack terraform --tf-provider <provider> "<query>"`.
6. Cite returned citations, knowledge cards, recipes, or result file paths.

For deployment questions with an obvious target not selected in `.vegastack/vegastack.yml`, add a targeted `--pack` when the pack is installed or use `--all` for a read-only broad lookup. Examples: Vercel deploys should include `--pack vercel` when available; Cloudflare Worker deploys should include `--pack cloudflare --pack github-actions` when CI is involved.

Unscoped `vegastack ask --agent "<query>"` requires project init so the CLI has a
deterministic selected pack set. If a needed pack is missing, ask before running
`vegastack registry install <pack>` or `vegastack registry install --all`.

Do not answer from model memory when VegaStack returns relevant local evidence.
