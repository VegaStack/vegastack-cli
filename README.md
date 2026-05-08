# vegastack - `@vegastack/cli`

Local-first knowledge harness for coding agents. VegaStack lets agents ground
infrastructure, cloud operations, CI/CD, Terraform, and project operations work
in local Registry docs instead of guessing from model memory.

```bash
npm i -g @vegastack/cli
vegastack
vegastack init
vegastack ask "deploy this service safely"
vegastack search --pack jenkins "withCredentials"
vegastack doctor
```

For the step-by-step guide, see [GETTING_STARTED.md](GETTING_STARTED.md).

**Supported agents:** Claude Code, Codex, Cursor, Gemini, Continue, Aider. Run `vegastack skills install --host all --agent` to register the skill with every detected host (or pick one with `--host claude-code` etc.).

## How It Works

- `vegastack` runs first-time global setup or shows local status when setup already exists.
- `vegastack init` detects the current project, writes `.vegastack/vegastack.yml`, and downloads selected Registry packs into `~/.vegastack/registry/`.
- `vegastack ask "<query>"` builds a grounded JSON evidence envelope from project-selected packs.
- `vegastack search "<literal>"` performs deterministic exact lookup over local Registry files.
- Before project init, use explicit scope: `vegastack ask --pack cloudflare "wrangler deploy"` or `vegastack search --all "id-token: write"`.
- `vegastack registry install --all` downloads every published pack for offline or power-user use.
- `vegastack scan` runs project security checks through pinned open-source scanners selected during init.
- Terraform uses the same surface: `vegastack ask --pack terraform --tf-provider aws "S3 bucket with versioning"`.

No Registry data or managed tool binary is downloaded during npm postinstall.
Postinstall only performs best-effort global skill registration for detected
agent hosts so `/vegastack` is available immediately.

For prerelease builds from `develop`, install the `next` tag:

```bash
npm i -g @vegastack/cli@next
```

## Common Commands

```bash
vegastack                                # first-run setup or local status
vegastack init                           # initialize .vegastack/ for this project
vegastack detect --agent                  # inspect project stack without writing
vegastack ask "github actions oidc"       # query project-selected Registry packs
vegastack ask --pack cloudflare "D1 binding"
vegastack ask --all "docker build cache"
vegastack ask --pack terraform --tf-provider aws "create an S3 bucket"
vegastack search --pack kubernetes "kind: Deployment"
vegastack registry list
vegastack registry install --all          # download every published Registry pack
vegastack registry update                 # update project-selected Registry packs
vegastack registry update --all           # update every installed Registry pack
vegastack scan --staged
vegastack skills reconcile
vegastack update --check
vegastack doctor --verify-registry
```

`vegastack` defaults to Interactive Mode for humans. Add `--agent` when an
agent or script needs structured output and no prompts:

```bash
vegastack --agent
vegastack --agent doctor
vegastack ask --agent --pack cloudflare "wrangler deploy"
```

`--agent` writes a structured envelope to stdout (status to stderr). For
`vegastack ask` the envelope shape is roughly:

```jsonc
{
  "status": "ok",
  "query": "github actions oidc to aws",
  "mode": "registry-docs",
  "registry_packs": ["docker", "github-actions"],
  "knowledge": [{ "id": "...", "title": "...", "overrides_training": true }],
  "results": [
    {
      "registry_pack": "github-actions",
      "path": "content/.../oidc-in-aws.md",
      "score": 1494,
      "match_reasons": ["heading", "exact"]
    }
  ],
  "citations": ["github-actions:content/.../oidc-in-aws.md"],
  "concept_aliases_used": [{ "registry_pack": "github-actions", "phrase": "oidc", "tokens": [...] }]
}
```

`vegastack search` returns `{ query, mode, engine, registry_packs, matches[], citations[] }`.
Errors emit `{ "kind": "...", "message": "...", "exitCode": <code>, "hint": "..." }` to
stdout with a non-zero exit. See [`src/cli.ts`](src/cli.ts) for the full exit-code table.

## Project Files

```text
.vegastack/
└── vegastack.yml
```

The heavy docs cache lives outside the repo at `~/.vegastack/registry/`, and
shared agent instructions live at `~/.vegastack/instructions/`, so projects do
not vendor docs or duplicate common instructions.

## Security

- Registry catalog `REGISTRY.json` is verified with Sigstore provenance before downloads.
- Pack archives are downloaded by URL from the catalog, SHA256 checked, safely extracted, and verified against `ARTIFACTS.json`.
- Managed tools are pinned by the CLI release and SHA256 checked.
- `vegastack scan` wraps OSS scanners with disclosed upstream projects: [Gitleaks](https://github.com/gitleaks/gitleaks), [Trivy](https://github.com/aquasecurity/trivy), [OSV-Scanner](https://github.com/google/osv-scanner), [actionlint](https://github.com/rhysd/actionlint), and [zizmor](https://github.com/zizmorcore/zizmor).

## Development

```bash
npm install
npm run typecheck
npm run build
npm test

VEGASTACK_REGISTRY_DIR=/Users/you/projects/vegastack-cli-registry/cli/packs \
  node dist/cli.js doctor --verify-registry
```

## Environment

| Variable | Purpose |
| --- | --- |
| `VEGASTACK_CONFIG_DIR` | Override `~/.vegastack`. |
| `VEGASTACK_REGISTRY_DIR` | Override local Registry cache. Useful for registry development. |
| `VEGASTACK_REGISTRY_URL` | Override published Registry URL. |
| `VEGASTACK_TOOLS_DIR` | Override managed tools cache. |
| `VEGASTACK_GITLEAKS_BIN` | Use an existing Gitleaks binary. |
| `VEGASTACK_TRIVY_BIN` | Use an existing Trivy binary. |
| `VEGASTACK_OSV_SCANNER_BIN` | Use an existing OSV-Scanner binary. |
| `VEGASTACK_ACTIONLINT_BIN` | Use an existing actionlint binary. |
| `VEGASTACK_ZIZMOR_BIN` | Use an existing zizmor binary. |
| `VEGASTACK_CLOUDFLARED_BIN` | Use an existing cloudflared binary. |
| `VEGASTACK_SKIP_POSTINSTALL` | Silence postinstall guidance. |
| `VEGASTACK_SKIP_SKILL_INSTALL` | Skip postinstall agent skill registration. |
| `VEGASTACK_POSTINSTALL_TIMEOUT_MS` | Timeout for postinstall skill registration. |
| `NO_COLOR` | Disable colored output. |

## Releasing

Changesets owns versioning. GitHub Actions publishes to public npm with trusted
publishing and provenance:

- `develop` prereleases publish as `@vegastack/cli@next`.
- `main` production releases publish as `@vegastack/cli@latest`.

For bugs and feature requests, open an issue at
https://github.com/vegastack/vegastack-cli/issues. For security issues, follow
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © VegaStack Inc.
