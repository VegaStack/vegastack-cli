# vegastack - `@vegastack/cli`

Local-first knowledge harness for coding agents. VegaStack lets agents ground infrastructure, cloud operations, CI/CD, Terraform, Docker, Kubernetes, Helm, Supabase, AWS CLI, Jenkins, and related work in a local Registry cache instead of guessing from model memory.

```bash
npm i -g @vegastack/cli
vegastack init
vegastack ask "deploy this service safely"
vegastack search --entry jenkins "withCredentials"
vegastack doctor
vegastack skills install --agent all
```

## How It Works

- `vegastack init` detects the project stack, asks for confirmation, writes `.vegastack/project.json`, `.vegastack/vegastack-lock.json`, and `.vegastack/instructions/`, then downloads selected Registry entries into `~/.config/vegastack/registry/`.
- `vegastack ask "<query>"` reads the project lock and returns a JSON evidence envelope with citations from installed Registry entries.
- `vegastack search "<literal>"` performs deterministic exact search over local Registry files using VegaStack-managed ripgrep when available.
- Terraform uses the same surface: `vegastack ask --entry terraform --tf-provider aws "S3 bucket with versioning"`.
- Registry content is published by `vegastack-cli-registry` to `https://cli-registry.vegastack.com/cli`.

No Registry data is downloaded during npm postinstall.

For prerelease builds from `develop`, install the `next` tag:

```bash
npm i -g @vegastack/cli@next
```

## Commands

```bash
vegastack init                         # initialize .vegastack/ for this project
vegastack ask "github actions oidc"     # query project-selected Registry entries
vegastack ask --all "docker build cache"
vegastack ask --entry terraform --tf-provider aws "create an S3 bucket"
vegastack search --entry kubernetes "kind: Deployment"
vegastack registry list
vegastack registry update              # update project-selected Registry entries
vegastack registry update terraform --force
vegastack secrets enable
vegastack preview --tunnel
vegastack skills install --agent all
vegastack update
vegastack doctor --verify-registry
```

## Project Files

```text
.vegastack/
├── project.json
├── vegastack-lock.json
├── instructions/
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   └── README.md
└── .gitignore
```

The heavy docs cache lives outside the repo at `~/.config/vegastack/registry/`, so projects do not vendor docs.

## Agent Skills

```bash
vegastack skills install --agent all
vegastack skills status --agent all
vegastack skills uninstall --agent cursor --scope project
```

Supported renderers: Claude Code, Codex, Cursor, Gemini, Continue, and Aider.

## Security

- Registry catalog `REGISTRY.json` is verified with Sigstore provenance before downloads.
- Entry archives are downloaded by URL from the catalog, SHA256 checked, safely extracted, and verified against `ARTIFACTS.json`.
- Managed tools are pinned by the CLI release and SHA256 checked.
- Secrets scanning uses Gitleaks and is opt-in through `vegastack init` or `vegastack secrets enable`.

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
| `VEGASTACK_CONFIG_DIR` | Override `~/.config/vegastack`. |
| `VEGASTACK_REGISTRY_DIR` | Override local Registry cache. Useful for registry development. |
| `VEGASTACK_REGISTRY_URL` | Override published Registry URL. |
| `VEGASTACK_TOOLS_DIR` | Override managed tools cache. |
| `VEGASTACK_GITLEAKS_BIN` | Use an existing Gitleaks binary. |
| `VEGASTACK_CLOUDFLARED_BIN` | Use an existing cloudflared binary. |
| `VEGASTACK_SKIP_POSTINSTALL` | Silence postinstall guidance. |
| `NO_COLOR` | Disable colored output. |

## Releasing

Changesets owns versioning. GitHub Actions publishes to public npm with trusted publishing and provenance:

- `develop` prereleases publish as `@vegastack/cli@next`.
- `main` production releases publish as `@vegastack/cli@latest`.

For bugs and feature requests, open an issue at https://github.com/VegaStack/vegastack-cli/issues.
For security issues, follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © VegaStack Inc.
