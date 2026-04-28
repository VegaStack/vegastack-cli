# vegastack — `@vegastack/cli`

A deterministic, offline knowledge harness for coding agents. One npm install gives **Claude Code, Codex, Cursor, and Gemini** local, citable competence over **31 Terraform providers** — without web search, MCPs, or model-knowledge gaps.

```bash
npm i -g @vegastack/cli         # ~5 MB CLI + ~12 MB compressed bundle (97 MB on disk after extract)
vegastack doctor                     # verify environment
vegastack skills install --agent all # register skills with all installed agents
```

[![npm](https://img.shields.io/npm/v/@vegastack/cli.svg)](https://www.npmjs.com/package/@vegastack/cli)
[![CI](https://github.com/vegastack/vegastack-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/vegastack/vegastack-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What's inside

- **31 Terraform providers' upstream docs** mirrored daily from their GitHub repos — `aws`, `azure`, `gcp`, `cloudflare`, `kubernetes`, `helm`, `vault`, `digitalocean`, `github`, `gitlab`, `vercel`, `netlify`, `datadog`, `grafana`, `splunk`, `pagerduty`, `okta`, `auth0`, `crowdstrike`, `1password`, `mongodb-atlas`, `snowflake`, `redis-cloud`, `clickhouse`, `pinecone`, `ansible`, `random`, `tls`, `time`, `local`, `external`.
- **Per-provider `MANIFEST.json`** — resource schemas, argument lists, enum values, import syntax, deprecation flags, HCL reference graph, recommended companions.
- **`vegastack tf <query>`** — a deterministic discovery CLI. Returns one JSON envelope with `files[]`, `knowledge[]` (curated recent-change facts), `recipes[]` (multi-provider scaffolds), `concept_aliases_used[]` (natural-language → resource mapping). Top-K results arrive with full schemas inline.
- **Spec-compliant skill** for the [Anthropic Agent Skills Standard](https://agentskills.io/specification), packaged as a Claude Code plugin and installable into Codex (`.agents/skills/`), Cursor (`.cursor/rules/`), and Gemini (`gemini-extension.json`).

## How this differs from `hashicorp/agent-skills`

HashiCorp shipped a competing agent-skills bundle in February 2026. They're complementary, not competitive:

| Aspect       | `hashicorp/agent-skills`                                                                                | `@vegastack/cli`                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Audience     | Provider authors                                                                                        | Provider consumers (devops/SRE/platform/sec engineers)                                                          |
| What it ships | "How to write a Terraform provider", "Run acceptance tests", azure-verified-modules patterns           | Per-resource manifest, import-id syntax, deprecation flags, recipes, knowledge cards for 31 providers           |
| Installs to  | Claude Code skills                                                                                      | Claude Code / Codex / Cursor / Gemini / Continue / Aider via npm                                                |
| License      | MPL-2.0                                                                                                 | MIT                                                                                                             |

Both can be installed side-by-side. Use `hashicorp/agent-skills` when authoring or testing your own provider; use `@vegastack/cli` when writing or modifying Terraform configurations that consume providers.

## Install

> **v0.1 status:** internal-only release via **GitHub Packages**. The public-npm + skill-registry install paths below are reserved for the v1.0 public ship; they will not resolve a package today. Use the "Install (internal — GitHub Packages)" section first.

### Install (internal — GitHub Packages)

`@vegastack/cli` is published to GitHub Packages under the `VegaStack` org. Three steps:

**1. Create a GitHub PAT with `read:packages` scope**

Go to <https://github.com/settings/tokens?type=beta> → Generate new token → resource access: `VegaStack` org → permissions: **Packages → Read-only**. Save the token (`ghp_...`).

**2. Authenticate npm to the GitHub Packages registry**

Add to `~/.npmrc` (create if missing):

```ini
@vegastack:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_YOUR_PAT_HERE
```

**3. Install the CLI**

```bash
# Global (recommended for CLI tools):
npm i -g @vegastack/cli

# Or local to a project:
npm i @vegastack/cli
```

The npm postinstall downloads the docs bundle (~12 MB) from `https://bundles.vegastack.com/cli/...` (Cloudflare R2). It's content-addressed and SHA-verified; on R2 outage it falls back to GitHub Releases of the bundle repo. After install:

```bash
vegastack doctor   # should report bundle found
vegastack tf "S3 bucket with versioning enabled"
```

To point at a local bundle tree instead (development against an unpublished build), set `VEGASTACK_BUNDLE_DIR` to the absolute path of the bundle's `terraform-providers/` directory before running any vegastack command.

To skip the postinstall network fetch entirely (silent), prefix install with:

```bash
VEGASTACK_SKIP_POSTINSTALL=1 npm i -g @vegastack/cli
```

### Install (public — coming with v1.0)

```bash
# These paths will resolve once v1.0 ships publicly. Not active in v0.1.
npm i -g @vegastack/cli                # public npm registry
npx skills add @vegastack/cli          # Skills.sh
tessl install @vegastack/cli           # Tessl
/plugin install vegastack-cli          # Claude Code plugin marketplace
```

```bash
vegastack doctor
# ✓ Node.js: v20.10.0
# ✓ Docs bundle: v2026.04.28 at /Users/.../.config/vegastack/bundle (31 providers, schema_version=1, generated ...)
# ✓ jq (optional): jq-1.7.1
# ✓ ripgrep (optional): ripgrep 14.1.0
```

> **Native TypeScript runtime**: `vegastack tf` is fully native — no Python, no shell-outs to a foreign runtime. Top-K results arrive with the full manifest schema (`required_args`, `optional_args`, `import_syntax`, `deprecated`, …) and the inline `## Example Usage` block, so a typical agent task collapses from ~15 tool calls to 1–2. Add `--debug` to see per-stage timings.

## Register the skill with your coding agent(s)

```bash
# Install for ALL detected agents at once:
vegastack skills install --agent all

# Or pick:
vegastack skills install --agent claude-code               # global (~/.claude/plugins/)
vegastack skills install --agent codex                     # global (~/.agents/skills/)
vegastack skills install --agent cursor --scope project    # writes .cursor/rules/vegastack-cli.mdc
vegastack skills install --agent gemini --scope project    # writes gemini-extension.json + CONTEXT.md

# What's currently registered?
vegastack skills status --agent all

# Cleanup:
vegastack skills uninstall --agent cursor --scope project
```

`--scope global` writes to your home dir; `--scope project` writes to the current working directory. Cursor and Gemini are project-scoped only (their config files live next to your code). Add `--dry-run` to preview without writing.

| Agent           | Scope            | Files written by `vegastack skills install`                                                              |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| **Claude Code** | global           | `~/.claude/plugins/vegastack-cli/` (symlink to package; auto-updates with the CLI)        |
| **Codex**       | global / project | `~/.agents/skills/vegastack/` (or `<cwd>/.agents/skills/...`); optionally `~/.codex/AGENTS.md` |
| **Cursor**      | project only     | `<cwd>/.cursor/rules/vegastack-cli.mdc`                                                   |
| **Gemini**      | project only     | `<cwd>/gemini-extension.json` + `<cwd>/CONTEXT.md`                                                  |

## Use it

Once installed, your agent auto-detects the skill on Terraform-related prompts. You can also invoke `vegastack` directly:

```bash
vegastack tf "create an S3 bucket with versioning enabled"
# → JSON envelope; files[].manifest_entry has the full schema; .example_usage has the canonical HCL block.

vegastack tf "import an existing Cloudflare DNS record"
# → cloudflare_dns_record (NOT the deprecated v4 cloudflare_record); import_syntax inline.

vegastack tf "zero-trust internal app cloudflare access aws alb okta" --max 20
# → recipes[] surfaces the multi-provider scaffold; files[] from each provider.

vegastack refresh    # pull a newer bundle (when upstream docs change)
```

The agent reads the response and writes citable HCL. The docs are always local, always fresh, always deterministic — no network calls at query time.

## How is this better than asking an LLM directly?

| Failure mode                                                 | LLM alone   | With vegastack                                               |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------- |
| Invented resource name (`aws_lb_v2`)                         | common      | impossible — null lookups raise an explicit error       |
| Stale rename (`cloudflare_record` → `cloudflare_dns_record`) | silent fail | knowledge card surfaces the rename                      |
| Fabricated import-ID format                                  | common      | `import_syntax` returns the exact composite-ID format   |
| Missed soft-dependency (EC2 needs VPC + subnet + SG)         | common      | `recommended_companions` widens the response            |
| "Protect from bots" → wrong Cloudflare resource              | common      | concept aliases map natural language to right resources |
| Multi-provider scaffold (zero-trust, scalable backend)       | error-prone | recipes ship working composable HCL fragments           |

iter-1 benchmark on 4 representative tasks (S3 versioning, Cloudflare DNS import, k8s deployment, ECS+RDS+Datadog stack):

| Configuration                            | Pass rate        | Time     | Tokens  |
| ---------------------------------------- | ---------------- | -------- | ------- |
| **with-skill**                           | **100% (39/39)** | 110s avg | 43k avg |
| baseline (no docs, training memory only) | 74% (31/39)      | 59s avg  | 20k avg |

The ~2× cost above was measured against v0.1's Python harness; v0.2 collapses it via enrichment (single-call responses with full schemas + example usage inline). See [PORT-ROADMAP.md](PORT-ROADMAP.md) for the design details.

## Layout

```
@vegastack/cli/
├── .claude-plugin/plugin.json     # Claude Code plugin manifest
├── .agents/skills/vegastack/ # Codex skill location (symlink to ./skills/vegastack/)
├── AGENTS.md                      # Codex / generic-agent project instructions
├── CLAUDE.md                      # Defers to AGENTS.md
├── cursor-rule.mdc                # Drop-in Cursor rule template
├── gemini-extension.json          # Gemini Code Assist extension
├── CONTEXT.md                     # Gemini agent context
├── skills/vegastack/
│   ├── SKILL.md                   # The Anthropic Agent Skills standard skill
│   └── references/                # 5 reference files (CLI, manifest, knowledge, recipes, aliases)
├── npm/
│   ├── install.js                 # postinstall: downloads bundle from GH Releases
│   └── run.js                     # npm bin entry, delegates to dist/cli.js
├── src/                           # TypeScript source
│   ├── cli.ts                     # commander.js entry
│   ├── commands/                  # doctor, install, refresh, skills, tf
│   ├── agents/                    # claude-code, codex, cursor, gemini
│   └── lib/                       # paths, log, bundle, discover
├── dist/                          # compiled JS (published, not committed)
├── docs/                          # docs site sources
├── tests/                         # vitest specs
└── PORT-ROADMAP.md                # historical: v0.2 native-TS port plan (now shipped)
```

## Development

```bash
git clone https://github.com/vegastack/vegastack-cli.git
cd vegastack-cli
npm install                    # postinstall fails harmlessly if no bundle yet
npm run build                  # tsc → dist/

# Run against the upstream repo's bundle for local testing:
VEGASTACK_BUNDLE_DIR=/Users/you/projects/engg-vegastack-agent-tf-providers/terraform-providers \
  node dist/cli.js doctor

# Build a local bundle and use it via file://:
( cd /Users/you/projects/engg-vegastack-agent-tf-providers && \
  bash scripts/build_bundle.sh --version $(date +%Y.%m.%d) )
VEGASTACK_BUNDLE_URL=file:///path/to/dist/vegastack-bundle-vYYYY.MM.DD.tar.gz \
VEGASTACK_BUNDLE_DIR=/tmp/test-bundle \
  node npm/install.js
```

## Releasing (internal maintainers)

This repo ships an `/ship` Claude Code skill at `.claude/skills/ship/SKILL.md` that handles the full release cycle. It's project-local — it only triggers inside this repo, never on other projects.

**When to invoke:** every time you cut a v0.1.x release. Trigger phrases include `/ship`, "cut a release", "ship the cli", "publish a new version", "tag v0.1.x", "let's release this".

**What it does, in order:**

1. **Pre-flight** — runs build + typecheck + tests + lint across all 3 codebases (CLI 398 tests, `apps/mcp` 19, `apps/dashboard` 9). Aborts if anything fails.
2. **Diff analysis** — `git diff` + `git status` + `git log` + reads the latest version actually published to GitHub Packages (`gh api …/orgs/VegaStack/packages/npm/cli/versions`) so the version chronology check uses the source of truth, not local `package.json` state which can drift.
3. **Doc audit** — exhaustive grep across every `.md` file (excluding `docs/{planning,status,contracts,evals}/**` which are frozen historical / spec records) for stale references to anything that changed in the diff. Updates inline.
4. **Drafts version + changelog + commit message + GH release notes** — defaults to patch unless the diff scope calls for minor. Never suggests major. Validates the proposed version against the latest GitHub Packages version. Presents everything; waits for your confirmation.
5. **Bumps version** in `package.json`, `apps/mcp/package.json`, and `apps/dashboard/package.json` (kept in sync). Prepends the changelog entry.
6. **Waits for explicit `push` confirmation.** Will not commit, push, tag, or release until you say so.
7. **Executes ship** — stages files by name (never `-A`), commits with conventional-commit message + `Co-Authored-By` trailer, `git pull --rebase`, `git push`, `git tag v<version>`, `git push --tags`. The tag push is the trigger for `.github/workflows/publish-internal.yml` which publishes the npm package to GitHub Packages.
8. **Post-ship verification** — `gh run watch` until the workflow exits 0, confirms the version landed in GH Packages, prints an install snippet for testers.

**Safety gates baked in:**

- Never bypasses the `prepublishOnly` bundle-pin guard locally (only CI does, via `VEGASTACK_ALLOW_PENDING_BUNDLE_SHA=1`).
- Never invokes `gh workflow run publish-internal.yml` — the tag push is the only correct trigger.
- Never modifies `release.yml` (the dormant public-npm path).
- Never touches the bundle repo (`engg-vegastack-agent-tf-providers`) — it has its own release cron.
- Never deploys `apps/mcp` or `apps/dashboard` — Cloudflare Workers Builds owns those, redeploying automatically on push to main.
- Never `git add -A`, never force-push.

**Prerequisites:** `gh` CLI authenticated to GitHub (`gh auth status`), git remote configured for the repo, GitHub Actions secrets in place (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME=vegastack-agent-kb`).

## How it's distributed

This repo publishes the **CLI** to npm as `@vegastack/cli`. The **docs bundle** is built daily by the upstream `vegastack/engg-vegastack-agent-tf-providers` pipeline and uploaded to this repo's GitHub Releases as a tarball. The CLI's postinstall downloads the latest release matching the installed CLI version (or via `VEGASTACK_BUNDLE_URL`).

| Repo                                          | Role                          | Cadence                            |
| --------------------------------------------- | ----------------------------- | ---------------------------------- |
| `vegastack/vegastack-cli` (this)              | CLI source, npm publish       | semver, on PR merge via Changesets |
| `vegastack/engg-vegastack-agent-tf-providers` | Daily docs sync, bundle build | nightly cron 02:00 UTC             |

## Environment variables

| Variable                     | Default                                                 | Purpose                                                                                              |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `VEGASTACK_BUNDLE_DIR`            | `~/.config/vegastack/bundle`                            | Where the docs bundle lives after install. Override to test alternate bundles.                       |
| `VEGASTACK_BUNDLE_URL`            | `https://github.com/.../vegastack-bundle-vX.Y.Z.tar.gz` | Override the download URL. Use `file:///path/to/bundle.tar.gz` for offline / air-gapped installs.    |
| `VEGASTACK_SKIP_POSTINSTALL`      | (unset)                                                 | Set to `1` to skip the postinstall download (useful in CI when you provision the bundle separately). |
| `VEGASTACK_BUNDLE_TIMEOUT_MS`     | `60000`                                                 | Per-attempt fetch timeout.                                                                           |
| `VEGASTACK_BUNDLE_RETRIES`        | `2`                                                     | Number of retries on transient failures (3 attempts total).                                          |
| `HTTPS_PROXY` / `HTTP_PROXY` | (unset)                                                 | Standard proxy URLs; `vegastack install` routes the bundle download through `undici`'s ProxyAgent.        |
| `NO_PROXY`                   | (unset)                                                 | Comma-separated host substrings to bypass the proxy. `*` disables proxying entirely.                 |
| `NO_COLOR`                   | (unset)                                                 | Set to disable colored output.                                                                       |

## Troubleshooting

### Postinstall failed but `vegastack doctor` says "bundle missing"

Run `vegastack install` (or `vegastack refresh` to force a fresh download). If it still fails, the troubleshooting tree:

```
network unreachable          → check `curl -fI <bundle URL>` from the same shell
HTTP 403 / rate limit         → wait a minute and retry; GitHub anonymous limits are generous
behind a corporate proxy      → set HTTPS_PROXY (and NO_PROXY); see "Proxied / air-gapped" below
SHA256 mismatch on every try  → file a security report — see SECURITY.md
"tar binary not found"        → on Windows < 1809: install bsdtar or git-bash; on Alpine: `apk add tar`
```

`vegastack doctor --json` produces machine-readable output that's the cleanest thing to attach to a bug report.

### Proxied / air-gapped installs

The CLI honors `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` automatically (via Node's bundled `undici`). If the proxy can't reach GitHub Releases, fall back to a local file:

```bash
# 1. Mirror the bundle by hand:
curl -L -O https://github.com/vegastack/vegastack-cli/releases/download/v0.1.0/vegastack-bundle-v0.1.0.tar.gz
curl -L -O https://github.com/vegastack/vegastack-cli/releases/download/v0.1.0/vegastack-bundle-v0.1.0.tar.gz.sha256

# 2. Point the installer at the local copy:
VEGASTACK_BUNDLE_URL=file:///abs/path/to/vegastack-bundle-v0.1.0.tar.gz \
  npm i -g @vegastack/cli
```

For corporate distribution, host the tarball + sidecar `.sha256` on an internal server (HTTPS only) and set `VEGASTACK_BUNDLE_URL` org-wide. The SHA256 verification still applies.

### Sudo / global-install path question

`npm i -g @vegastack/cli` (with or without `sudo`) downloads the bundle to **the invoking user's** `~/.config/vegastack/bundle/` — not `/root/`. The CLI binary lives in npm's global prefix (`/usr/local/lib/node_modules/...` typically), but bundle data follows `$HOME` of whoever runs `vegastack`. If multiple users on the machine each want their own bundle, that's already how it works.

### Windows symlinks fail with `EPERM`

`vegastack skills install --agent claude-code` tries to symlink the package into `~/.claude/plugins/`. Symlinks on Windows require either:

- **Developer Mode** enabled (Settings → For Developers, Win10 1703+), or
- Running the shell as Administrator.

If neither applies, the installer **falls back to a recursive copy** automatically — same end state, but you'll need to re-run `vegastack skills install --force` after each `npm i -g @vegastack/cli@latest` to pick up CLI updates. Enabling Developer Mode is recommended.

### `vegastack tf` exits 4 (BundleMissing)

The bundle is missing from disk. Either the postinstall didn't complete, or `VEGASTACK_BUNDLE_DIR` is pointed somewhere wrong. Run `vegastack doctor` for the diagnosis, then `vegastack install` to fix.

### `npx @vegastack/cli` doesn't have a bundle

`npx` skips postinstall. For full functionality, `npm i -g @vegastack/cli` first. `npx` will work for the skill-management commands (`vegastack skills ...`) but not for `vegastack tf`.

## Related

- [PORT-ROADMAP.md](PORT-ROADMAP.md) — v0.2 plan: native TypeScript discover, enrichment, common-query cache.
- [STYLE.md](STYLE.md) — style + design guide for code reviewers.
- [CONTRIBUTING.md](CONTRIBUTING.md) — PR workflow, changeset rules.
- [SECURITY.md](SECURITY.md) — threat model + vulnerability disclosure.

## License

[MIT](LICENSE) © Vegastack Inc.
