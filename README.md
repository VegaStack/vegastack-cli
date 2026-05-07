# vegastack - `@vegastack/cli`

Local-first knowledge harness for coding agents. VegaStack lets agents ground
infrastructure, cloud operations, CI/CD, Terraform, and other project-selected
Registry entries in a local cache instead of guessing from model memory.

```bash
npm i -g @vegastack/cli
vegastack setup
vegastack init
vegastack detect --json
vegastack generate github-action vercel --json
vegastack ask "deploy this service safely"
vegastack search --entry jenkins "withCredentials"
vegastack scan
vegastack doctor
```

Inside supported agents, use `/vegastack init` for the conversational bootstrap.

## How It Works

- `vegastack init` detects the project stack, asks for confirmation, writes committed `.vegastack/vegastack.yml`, writes shared instructions under `~/.vegastack/instructions/`, appends small agent pointers when relevant, then downloads selected Registry entries into `~/.vegastack/registry/`.
- `vegastack detect --json` reports current repo stack facts without writing.
- `vegastack refresh` manually updates `.vegastack/vegastack.yml`; project-aware commands cache fresh detection under `~/.vegastack/cache/` before they run.
- `vegastack generate <intent> --json` returns an agent workflow contract for ops file creation; the agent still writes files.
- `vegastack ask "<query>"` reads `.vegastack/vegastack.yml`, caches fresh detection, adds already-installed supplemental entries when the repo changed, and returns a JSON evidence envelope with citations.
- `vegastack search "<literal>"` performs deterministic exact search over local Registry files, with the same auto-refresh when no `--entry` or `--all` is passed.
- `vegastack scan` runs project security checks through pinned open-source scanners selected during init.
- Terraform uses the same surface: `vegastack ask --entry terraform --tf-provider aws "S3 bucket with versioning"`.
- Registry content is published by `vegastack-cli-registry` to `https://cli-registry.vegastack.com/cli`.

No Registry data or managed tool binary is downloaded during npm postinstall. Postinstall only performs best-effort global skill registration for detected agent hosts so `/vegastack` is available immediately.

For prerelease builds from `develop`, install the `next` tag:

```bash
npm i -g @vegastack/cli@next
```

## Commands

```bash
vegastack init                         # initialize .vegastack/ for this project
vegastack setup                        # configure ~/.vegastack global tools and skills
vegastack detect --json
vegastack refresh --dry-run --json
vegastack generate github-action vercel --json
vegastack ask "github actions oidc"     # query project-selected Registry entries
vegastack ask --all "docker build cache"
vegastack ask --entry terraform --tf-provider aws "create an S3 bucket"
vegastack ask --entry cloudflare --entry github-actions "deploy Worker from CI"
vegastack search --entry kubernetes "kind: Deployment"
vegastack search --entry cloudflare --entry github-actions "deployment"
vegastack registry list
vegastack registry update              # update project-selected Registry entries
vegastack registry update terraform --force
vegastack scan
vegastack scan secrets actions
vegastack scan --staged
vegastack preview --tunnel
vegastack skills install --agent all
vegastack skills reconcile             # install missing global skills for detected agents
vegastack update
vegastack doctor --verify-registry
```

## Project Files

```text
.vegastack/
└── vegastack.yml
```

The heavy docs cache lives outside the repo at `~/.vegastack/registry/`, and shared agent instructions live at `~/.vegastack/instructions/`, so projects do not vendor docs or duplicate common instructions.

## Scan Config

`vegastack scan` is configured from `.vegastack/vegastack.yml`. VegaStack keeps the common policy small and uses native scanner config files for advanced behavior.

```yaml
schema_version: 1
scan:
  enabled: true
  offline: false
  checks:
    secrets:
      enabled: true
      engine: gitleaks
      history: false
    actions:
      enabled: true
      engines:
        - actionlint
        - zizmor
      zizmor_persona: regular
    dependencies:
      enabled: true
      engines:
        - osv-scanner
        - trivy
      ecosystems:
        - npm
  pre_commit:
    enabled: true
    mode: fast-staged
    checks:
      - secrets
      - actions
  policy:
    fail_on:
      - critical
      - high
    redact_secrets: true
```

Native scanner files remain supported. Gitleaks uses `scan.tools.gitleaks.native_config_path`, then `.gitleaks.toml` when present. Trivy supports `scan.tools.trivy.native_config_path` and otherwise lets Trivy auto-load `trivy.yaml`. OSV-Scanner supports `scan.tools["osv-scanner"].native_config_path` and otherwise lets OSV apply directory-local `osv-scanner.toml` files. actionlint supports `scan.tools.actionlint.native_config_path` and otherwise auto-loads `.github/actionlint.yaml` or `.github/actionlint.yml`. zizmor supports `scan.tools.zizmor.native_config_path` and otherwise uses zizmor's local discovery.

Advanced users can set `ignore_native_config: true` per tool to bypass repository-native config where the scanner supports it, and `extra_args` per tool for flags VegaStack does not abstract.

## Agent Skills

```bash
vegastack skills install --agent all
vegastack skills reconcile
vegastack skills status --agent all
vegastack skills uninstall --agent cursor --scope project
```

The npm postinstall and `vegastack update --yes` both use the same detected-agent reconciliation path. Renderer implementations live in `src/agents/`; use `vegastack skills status --agent all` to see the current installed surfaces.

## Security

- Registry catalog `REGISTRY.json` is verified with Sigstore provenance before downloads.
- Entry archives are downloaded by URL from the catalog, SHA256 checked, safely extracted, and verified against `ARTIFACTS.json`.
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

| Variable                     | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `VEGASTACK_CONFIG_DIR`       | Override `~/.vegastack`.                                 |
| `VEGASTACK_REGISTRY_DIR`     | Override local Registry cache. Useful for registry development. |
| `VEGASTACK_REGISTRY_URL`     | Override published Registry URL.                                |
| `VEGASTACK_TOOLS_DIR`        | Override managed tools cache.                                   |
| `VEGASTACK_GITLEAKS_BIN`     | Use an existing Gitleaks binary.                                |
| `VEGASTACK_TRIVY_BIN`        | Use an existing Trivy binary.                                   |
| `VEGASTACK_OSV_SCANNER_BIN`  | Use an existing OSV-Scanner binary.                             |
| `VEGASTACK_ACTIONLINT_BIN`   | Use an existing actionlint binary.                              |
| `VEGASTACK_ZIZMOR_BIN`       | Use an existing zizmor binary.                                  |
| `VEGASTACK_CLOUDFLARED_BIN`  | Use an existing cloudflared binary.                             |
| `VEGASTACK_SKIP_POSTINSTALL` | Silence postinstall guidance.                                   |
| `VEGASTACK_SKIP_SKILL_INSTALL` | Skip postinstall agent skill registration.                     |
| `VEGASTACK_POSTINSTALL_TIMEOUT_MS` | Timeout for postinstall skill registration.               |
| `NO_COLOR`                   | Disable colored output.                                         |

## Releasing

Changesets owns versioning. GitHub Actions publishes to public npm with trusted publishing and provenance:

- `develop` prereleases publish as `@vegastack/cli@next`.
- `main` production releases publish as `@vegastack/cli@latest`.

For bugs and feature requests, open an issue at https://github.com/vegastack/vegastack-cli/issues.
For security issues, follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © VegaStack Inc.
