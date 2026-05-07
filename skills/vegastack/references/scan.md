# /vegastack scan

Use this for secrets, dependency, GitHub Actions, container image, Kubernetes, IaC, or repository security checks.

Flow:

1. For current project scan, run `vegastack scan`.
2. For staged pre-commit equivalent, run `vegastack scan --staged`.
3. For machine-readable results, run `vegastack scan --json`.
4. For CI upload, use `vegastack scan --format sarif --output <path>`.
5. For image scanning, pass one or more `--image <ref>` values.

Valid categories are `secrets`, `actions`, `dependencies` (alias: `npm`), `containers`, `kubernetes`, and `iac`; pass them positionally, for example `vegastack scan secrets actions --json`.

`vegastack scan` may install missing scanner binaries by default. Use `--no-install-tools` for a read-only environment check that fails when a tool is missing.

Mutating scan commands:

- `vegastack scan enable --json` writes scan config into `.vegastack/vegastack.yml`.
- `vegastack scan enable --hook --json` also installs a local pre-commit hook.
- `vegastack scan hook install --force` mutates `.git/hooks/pre-commit`.
- `vegastack scan update-db` downloads vulnerability databases.

Read scan JSON from `findings[]`, `summary`, `tools[]`, and `failures[]`. A non-zero exit can still include valid JSON findings.

VegaStack wraps OSS scanners and should disclose them when relevant: Gitleaks, Trivy, OSV-Scanner, actionlint, and zizmor.

Do not print discovered secret values back to the user. Summarize file paths, rule IDs, and remediation steps.
