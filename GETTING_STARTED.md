# Getting Started with VegaStack CLI

VegaStack is a local-first knowledge harness for coding agents. It installs
official VegaStack Registry packs in your home directory, then lets agents
answer operations, infrastructure, CI/CD, Terraform, Kubernetes, Docker,
Cloudflare, and related questions with local citations.

## 1. Install

```bash
npm i -g @vegastack/cli
```

Prerelease builds from `develop` are published with the `next` tag:

```bash
npm i -g @vegastack/cli@next
```

Check the installed version:

```bash
vegastack --version
```

## 2. Run VegaStack Once

```bash
vegastack
```

On a new machine, `vegastack` starts Interactive Mode and guides first-run
setup. It creates:

```text
~/.vegastack/config.json
~/.vegastack/registry/
~/.vegastack/tools/
~/.vegastack/instructions/
```

It installs recommended managed tools such as ripgrep, writes shared agent
instructions, and can optionally download every Registry pack for offline use.

For non-interactive setup, use Agent Mode:

```bash
vegastack --agent
vegastack setup --yes --agent
```

Interactive Mode is the default for humans. Agent Mode is for coding agents and
automation: it emits structured output on stdout and avoids prompts.

## 3. Initialize a Project

Inside a repository:

```bash
cd /path/to/project
vegastack init
```

`init` detects project signals such as GitHub Actions workflows, Dockerfiles,
Terraform files, Kubernetes manifests, Cloudflare Wrangler config, Vercel config,
Jenkinsfiles, Helm charts, and other supported operations surfaces. It writes:

```text
.vegastack/vegastack.yml
```

Registry docs stay in your home directory at `~/.vegastack/registry/`; they are
not vendored into the project.

For agents or scripts:

```bash
vegastack init --dry-run --agent
vegastack init --yes --agent
```

## 4. Ask Grounded Questions

After project init:

```bash
vegastack ask "deploy this service safely"
vegastack ask "github actions oidc to aws"
vegastack search --pack kubernetes "kind: Deployment"
```

Agent Mode for the same workflow:

```bash
vegastack ask --agent "deploy this service safely"
vegastack search --agent --pack kubernetes "kind: Deployment"
```

Before project init, provide explicit scope:

```bash
vegastack ask --pack cloudflare "wrangler deploy"
vegastack ask --pack cloudflare --pack github-actions "deploy Worker from CI"
vegastack search --pack github-actions "id-token: write"
vegastack ask --all "docker build cache"
```

Unscoped `ask` and `search` require `vegastack init` so the CLI has a
deterministic project-selected pack set.

Terraform provider-specific lookup uses the same pack surface:

```bash
vegastack ask --pack terraform --tf-provider aws "create an S3 bucket with versioning"
```

## 5. Download Registry Packs

Most users should let `vegastack init` download only the packs detected for a
project. Power users who want offline access to every published pack can run:

```bash
vegastack registry install --all
```

Install or update one pack:

```bash
vegastack registry install cloudflare
vegastack registry update cloudflare
```

Repair or re-download all published packs:

```bash
vegastack registry install --all --force
```

List the local Registry state:

```bash
vegastack registry list
vegastack registry list --agent
```

## 6. Use From Agents

VegaStack ships an agent skill for Claude Code, Codex, Cursor, Gemini, Continue,
and Aider. Check or install skill registration with:

```bash
vegastack skills status --host all
vegastack skills reconcile
```

For agents or scripts:

```bash
vegastack skills status --host all --agent
vegastack skills reconcile --dry-run --agent
vegastack skills reconcile --agent
```

Inside supported agents, use `/vegastack init` to bootstrap a repo and
`/vegastack ask ...` or direct operations questions to ground answers in local
Registry evidence.

## 7. Keep Things Updated

Update project-selected Registry packs:

```bash
vegastack registry update
```

Update every installed pack:

```bash
vegastack registry update --all
```

Check CLI updates without installing:

```bash
vegastack update --check
```

Update the CLI, Registry packs, and managed tools in one flow:

```bash
vegastack update
```

## 8. Security Scanning

Enable project scan config during init, or later:

```bash
vegastack scan enable
vegastack scan --staged
vegastack scan secrets actions
```

VegaStack scan wraps open-source scanners: Gitleaks, Trivy, OSV-Scanner,
actionlint, and zizmor. Scanner tools are pinned and checksum-verified by the
CLI.

## 9. Common Scenarios

Cloudflare Worker deploy from CI:

```bash
vegastack ask --pack cloudflare --pack github-actions "deploy Worker from GitHub Actions"
vegastack search --pack cloudflare "wrangler deploy"
```

Kubernetes manifest lookup:

```bash
vegastack ask --pack kubernetes "deployment liveness probe"
vegastack search --pack kubernetes "readinessProbe"
```

Jenkins credentials syntax:

```bash
vegastack search --pack jenkins "withCredentials"
```

Terraform AWS resource shape:

```bash
vegastack ask --pack terraform --tf-provider aws "s3 bucket versioning"
```

## Troubleshooting

Check local health:

```bash
vegastack doctor
vegastack doctor --verify-registry
vegastack doctor --agent
```

If `ask` says the project is not initialized, either run `vegastack init` or add
explicit scope with `--pack <pack>` or `--all`.

If a Registry pack is missing, run:

```bash
vegastack registry install <pack>
```

For bugs and feature requests, open an issue at
https://github.com/vegastack/vegastack-cli/issues.
