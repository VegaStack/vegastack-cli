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
- Take credentials. The bundle is static documentation; there is no auth flow.
- Execute remote code. The only network call is the one-time postinstall download of the docs bundle (or a `vega install` / `vega refresh` invocation).

What the CLI **does** that has a security surface:

1. **Bundle download** during postinstall — fetches `vegastack-bundle-vX.Y.Z.tar.gz` from GitHub Releases over HTTPS, with a sidecar `.sha256` for integrity.
2. **Tarball extraction** to `~/.config/vegastack/bundle/`.
3. **Filesystem writes** by `vega skills install` — scoped to known agent directories (`~/.claude/plugins/`, `~/.agents/skills/`, `<cwd>/.cursor/rules/`, `<cwd>/gemini-extension.json`, `<cwd>/CONTEXT.md`).
4. **Symlink creation** (Claude Code installer) — falls back to a recursive copy on Windows non-admin.
5. **Subprocess invocation** of `python3` (v0.1 only — v0.2 drops this), `tar`, `du`, `jq`, `rg` from the user's `PATH`.

## Hardening summary (v0.1.0+)

The implementation goes beyond a typical npm postinstall script. Every item below is enforced in code and exercised by automated tests.

### Bundle download

- **HTTPS-only.** Non-`https://` URLs are refused (the only exception is `file://` for offline / air-gapped installs).
- **Manual redirect handling.** Each redirect hop is inspected; redirects to non-`https://` schemes (e.g., `file://`, `gopher://`) are rejected.
- **Bounded fetch.** Per-attempt timeout (default 60s, configurable via `VEGA_BUNDLE_TIMEOUT_MS`); 3 retries with exponential backoff capped at 8s.
- **Streaming download.** The tarball is hashed and written in chunks; we never load the whole file into memory. Streams are aborted as soon as `MAX_BUNDLE_BYTES` (500 MB) is exceeded.
- **Size sanity bounds.** Tarball must be `≥ 1 KB` (rejects HTML error pages) and `≤ 500 MB` (rejects bombs).
- **Constant-time SHA256 compare.** Verification uses `crypto.timingSafeEqual` against a hex-validated `.sha256` sidecar. The sidecar itself is capped at 1 KB so a malicious server can't tunnel data through it.
- **Proxy support.** `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` honored via Node's bundled `undici.ProxyAgent`. Proxy URL credentials are redacted from logs.

### Tarball extraction

- **Gzip magic-bytes check** before invoking `tar`.
- **Two-phase extraction.** First: `tar tzf` (LIST), validate every entry path against a strict allowlist (no absolute paths, no `..`, no drive letters, no UNC). Second: `tar xzf -C dest --no-same-owner` (EXTRACT). Any path-traversal attempt aborts before extraction begins; the destination is left untouched.
- **Symlink/hardlink target validation.** Every link's target must resolve inside the destination dir. Absolute-target links and dotdot-escapes are refused.
- **Refuses device files.** Character/block/FIFO/socket entries (which have no place in our content) are rejected up-front.
- **Robust parser.** GNU tar and BSD tar produce different verbose-listing formats; we use `tar tzf` (paths) plus `tar tvzf` (types) and align by index, so a malformed line never silently slips through.

### Filesystem operations

- **Atomic version write.** `.version` is written to `.version.tmp-<rand>` and renamed into place — no partial-state on a crash mid-write.
- **Atomic bundle swap.** Existing bundle is renamed aside before extraction; only deleted after the new extraction succeeds.
- **Bundle-dir lock.** `*.lock` file with `O_EXCL` semantics prevents two `npm i` runs from corrupting each other. Stale locks (>10 min old) are auto-reclaimed.
- **Lock ownership tracking.** A process never deletes a lock it didn't create.
- **Backup on overwrite.** Every `--force` write to a user-edited file (`AGENTS.md`, `CONTEXT.md`, `.cursor/rules/*.mdc`) renames the existing copy to `*.bak-<timestamp>-<random>` first. Random suffix prevents collisions when multiple installers run within the same millisecond.
- **Path validation.** Any path crossing the user→library boundary goes through `validateSafeFilePath` / `validateSafeOutputDir` which:
  - reject control-char and bidi-override codepoints (Trojan Source defense);
  - resolve symlinks (`fs.realpathSync`) before authorization checks;
  - check containment against **realpath'd allowed roots** (closes the macOS `/var → /private/var` divergence).
- **Symlink fallback.** `linkOrCopyDir` tries a symlink first, falls back to a recursive copy on `EPERM`/`ENOTSUP`/`EACCES`. Distinguishes "doesn't exist" (`ENOENT`) from "permission denied" — the latter is surfaced rather than silently ignored.

### Subprocess invocation

- **`process.execPath` for Node spawns.** `vega install` and `vega refresh` re-launch `npm/install.js` via `process.execPath`, not the bare `node` from `PATH` — defends against a malicious `node` shim earlier on the user's PATH.
- **Allowlisted env to subprocesses.** The Python harness receives only `PATH`, `HOME`, `USER`, `LANG`/`LC_*`, `TZ`, `TMPDIR`, `SystemRoot`, `ComSpec`, `PATHEXT`, plus our own `VEGA_*` vars. `GITHUB_TOKEN`, `AWS_*`, `NPM_TOKEN`, etc. are not exposed.
- **Signal handlers.** `SIGINT`/`SIGTERM`/`SIGHUP` clean up tmp dirs and release the lock before exiting.
- **Output redaction.** Every stderr line in `npm/install.js` runs through `redactUserPaths`, which strips `$HOME` from paths and ANSI escape sequences before logging. Error stack traces also flow through this filter.

### Error handling

- **Discriminated `VegaError` type** with stable exit codes (1–12). Each variant has a `hint()` so users see _problem → cause → fix_.
- **No silent catch-alls.** Every `try/catch` either rethrows or wraps into a typed error.
- **Postinstall never fails npm install.** Failures exit 0 with a clear recovery instruction, so a transient network issue doesn't block the whole install. Operators who need fail-closed behavior can use `VEGA_SKIP_POSTINSTALL=1` plus a follow-up `vega install` step under their own audit.

### Supply chain

- **Production deps:** 3 (`commander`, `kleur`, `prompts`). No native modules.
- **`npm audit --audit-level=moderate --omit=dev`** runs in CI on every push, every PR, and weekly via cron.
- **OSV-Scanner** runs in CI against `package-lock.json`.
- **CodeQL** static analysis runs on every PR.
- **Third-party GitHub Actions are pinned to commit SHAs** (with `# vX.Y.Z` comments so Dependabot can update them). First-party `actions/*` use `@v4` per GitHub's policy.
- **`provenance: true`** in `npm publish` (publishes SLSA build provenance via npm's attested-publish flow).
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

- **Verify the bundle SHA256 yourself** before relying on it. Each release on GitHub publishes both `vegastack-bundle-vX.Y.Z.tar.gz` and a `…tar.gz.sha256` sidecar.
- **Pin the npm version** (e.g. `npm i -g @vegastack/cli@0.1.0`) and consider `npm ci --ignore-scripts` to skip the postinstall, then run `vega install` later under your own audit.
- **Restrict the CLI's filesystem writes** by running `vega skills install` only inside project directories you control.
- **Set `VEGA_BUNDLE_URL=file:///abs/path`** in air-gapped environments to avoid the GitHub Releases fetch entirely.
- **For internal redistribution**, host the tarball + `.sha256` sidecar on an HTTPS-only internal mirror. The CLI's redirect-scheme check ensures even a misconfigured redirector can't downgrade the channel.

## Acknowledgements

We're grateful to security researchers who help keep this project safe. With your permission, we'll list you here after the issue is resolved.
