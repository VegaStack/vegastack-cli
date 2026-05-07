# /vegastack ask

Use this for ops, cloud, IaC, CI/CD, Terraform, Kubernetes, Docker, Supabase, Jenkins, GitHub Actions, preview, or deployment questions.

Flow:

1. If `.vegastack/vegastack.yml` is missing, recommend `/vegastack init`; for a quick read-only answer, use `vegastack ask --all`.
2. Run `vegastack ask "<query>"`; the CLI caches fresh detection and includes already-installed supplemental entries when the repo changed.
3. For known cross-pack questions, repeat `--entry`, for example `vegastack ask --entry cloudflare --entry github-actions "deploy Worker from CI"`.
4. For broad cross-pack questions, use `vegastack ask --all "<query>"` only when the user asks for broad search or the project is not initialized.
5. For Terraform provider-specific work, prefer `vegastack ask --entry terraform --tf-provider <provider> "<query>"`.
6. Cite returned citations, knowledge cards, recipes, or result file paths.

For deployment questions with an obvious target not selected in `.vegastack/vegastack.yml`, add a targeted `--entry` when the pack is installed or use `--all` for a read-only broad lookup. Examples: Vercel deploys should include `--entry vercel` when available; Cloudflare Worker deploys should include `--entry cloudflare --entry github-actions` when CI is involved.

Do not answer from model memory when VegaStack returns relevant local evidence.
