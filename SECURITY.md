# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `0.1.x` | ✅        |
| `< 0.1` | ❌        |

We support the latest published `0.x` minor on npm. Patch releases land on the most recent minor only. Once `1.0.0` ships, this table will list the LTS line.

## Threat model

`@vegastack/cli` is a local-only CLI. It does **not**:

- Send telemetry. The CLI never makes outbound network calls at query time.
- Take credentials. The Registry is static documentation and indexes; there is no auth flow.
- Execute remote code. Registry installs download text artifacts and JSON indexes only.

What the CLI **does** that has a security surface:

1. **Registry artifact download** — fetches `REGISTRY.json`, `ARTIFACTS.json`, and listed text artifacts from `https://cli-registry.vegastack.com/cli`.
2. **Filesystem writes** to the local Registry cache under the user's home directory.
3. **Filesystem writes** by `vegastack skills install` — scoped to known agent directories (`~/.claude/plugins/`, `~/.agents/skills/`, `<cwd>/.cursor/rules/`, `<cwd>/gemini-extension.json`, `<cwd>/CONTEXT.md`).
4. **Symlink creation** (Claude Code installer) — falls back to a recursive copy on Windows non-admin.
5. **Subprocess invocation** of managed search/scanning tools such as ripgrep and Gitleaks.

## Hardening summary (v0.1.0+)

The implementation goes beyond a typical npm postinstall script. Every item below is enforced in code and exercised by automated tests.

### Registry download

- **Checksum verified.** `ARTIFACTS.json` is verified against the root Registry catalog when a digest is published. Every listed file is verified against its SHA256 and byte size before install.
- **Path-confined.** Artifact paths must be relative, cannot contain backslashes, cannot be absolute, and cannot contain `..`.
- **Atomic cache swap.** Downloads are staged into a temporary directory and atomically promoted only after all files verify.

### Filesystem operations

- **Atomic Registry swap.** Existing cached packs are renamed aside before promotion; the old copy is restored if promotion fails.
- **Lock ownership tracking.** A process never deletes a lock it didn't create.
- **Backup on overwrite.** Every `--force` write to a user-edited file (`AGENTS.md`, `CONTEXT.md`, `.cursor/rules/*.mdc`) renames the existing copy to `*.bak-<timestamp>-<random>` first. Random suffix prevents collisions when multiple installers run within the same millisecond.
- **Path validation.** Any path crossing the user→library boundary goes through `validateSafeFilePath` / `validateSafeOutputDir` which:
  - reject control-char and bidi-override codepoints (Trojan Source defense);
  - resolve symlinks (`fs.realpathSync`) before authorization checks;
  - check containment against **realpath'd allowed roots** (closes the macOS `/var → /private/var` divergence).
- **Symlink fallback.** `linkOrCopyDir` tries a symlink first, falls back to a recursive copy on `EPERM`/`ENOTSUP`/`EACCES`. Distinguishes "doesn't exist" (`ENOENT`) from "permission denied" — the latter is surfaced rather than silently ignored.

### Subprocess invocation

- **No implicit Registry install in npm postinstall.** `npm/install.js` only prints guidance; Registry data is installed explicitly through `vegastack init` and refreshed with `vegastack registry update`.
- **Managed tool verification.** Managed binaries are downloaded from their official release channel, verified by SHA256 where the upstream publishes checksums, and stored under `~/.config/vegastack/tools/`.
- **Argument arrays, not shell strings.** Search and scanner subprocesses are invoked without shell interpolation.
- **Signal handlers.** Long-running install/update flows clean up tmp dirs before exiting.

### Error handling

- **Discriminated `VegaStackError` type** with stable exit codes (1–12). Each variant has a `hint()` so users see _problem → cause → fix_.
- **No silent catch-alls.** Every `try/catch` either rethrows or wraps into a typed error.
- **Postinstall is no-op.** Registry installation happens explicitly through `vegastack init`.

### Supply chain

- **Production deps are intentionally small and pure JavaScript.** Runtime dependencies are reviewed before release; avoid adding new runtime dependencies without a security and maintenance reason.
- **`npm audit --audit-level=moderate --omit=dev`** runs in CI on every push, every PR, and weekly via cron.
- **OSV-Scanner** runs in CI against `package-lock.json`.
- **CodeQL** static analysis runs on every PR.
- **Third-party GitHub Actions are pinned to commit SHAs** (with `# vX.Y.Z` comments so Dependabot can update them). First-party `actions/*` use `@v4` per GitHub's policy.
- **npm trusted publishing** is configured for GitHub Actions. Public releases publish with OIDC provenance and no long-lived npm token.
- **Dependabot** watches both npm and GitHub Actions, with grouped updates to keep PR noise low.

## Reporting a vulnerability

**Do not** open a public GitHub issue for security reports.

Email **security@vegastack.com** with:

- A description of the issue and its impact.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- Your name (for credit, optional) and how you'd like to be reached.

We will acknowledge receipt within **2 business days** and aim to issue a fix or detailed mitigation within **30 days**, depending on complexity. We follow coordinated disclosure: we'll work with you on a public advisory and CVE assignment once a fix is available.

## Hardening notes for operators

If you operate this CLI in a security-sensitive environment, consider:

- **Verify Registry digests yourself** before relying on mirrored content. `ARTIFACTS.json` records every file path, byte size, and SHA256.
- **Pin the npm version** (for example, `npm i -g @vegastack/cli@0.1.11-next.1` during prerelease testing) and consider `npm ci --ignore-scripts` to skip package lifecycle scripts; then run `vegastack init` inside each project under your own audit.
- **Restrict the CLI's filesystem writes** by running `vegastack skills install` only inside project directories you control.
- **Use `VEGASTACK_REGISTRY_DIR=/abs/path/to/cli/packs`** in air-gapped environments to point the CLI at a pre-synced local Registry tree.

## Acknowledgements

We're grateful to security researchers who help keep this project safe. With your permission, we'll list you here after the issue is resolved.
