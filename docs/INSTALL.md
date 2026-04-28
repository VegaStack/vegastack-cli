# Installing `@vegastack/cli` (v0.1)

`vega` is a thin npm-distributed loader (~200 KB) plus a content bundle
(~12 MB compressed today, ~100 MB target). The npm package downloads the
bundle on first install via a `postinstall` script, verifies its SHA-256
+ Sigstore attestations, and atomically swaps it into place.

## Quick install

```bash
npm install -g @vegastack/cli
```

…then verify:

```bash
vega --version
vega doctor
```

## What `npm install` actually does

```
   npm install @vegastack/cli
              │
              ▼
   downloads ~200 KB loader from registry.npmjs.org
              │
              ▼
   runs npm/install.js (postinstall):
     1. Reads bundles.vegastack.com/manifest.json
        (latest channel by default; see VEGA_BUNDLE_CHANNEL).
     2. Diffs against ~/.config/vegastack/bundle (if present).
     3. Downloads only the per-provider shards whose sha256 changed
        (R2 content-addressed at cas/sha256/<hex>.tar.gz).
     4. Verifies each shard against its .sha256 sidecar AND its
        Sigstore .sigstore bundle (cosign verify-blob equivalent).
     5. Stages into ~/.config/vegastack/bundle.new, then atomically
        renames bundle -> bundle.previous and bundle.new -> bundle.
        Atomic at the OS level: POSIX rename(2) on Linux/macOS,
        MoveFileEx + MOVEFILE_REPLACE_EXISTING on Windows.
              │
              ▼
   `vega` is on $PATH; `vega doctor` confirms everything.
```

If `postinstall` is blocked in your environment (some CI systems disable
it), set `VEGA_SKIP_POSTINSTALL=1` and run `vega update` manually after
install to fetch the bundle.

## Verification: `vega doctor --verify-attestations`

`vega doctor` performs a fast health check (paths, bundle present,
schema version, agents detected). The `--verify-attestations` flag
additionally:

- Reads the local bundle's `expectedBundleSha` (set at CLI release time
  by `scripts/tag-release.js`, stored in this CLI's `package.json`).
- Re-hashes the bundle on disk and compares.
- Re-verifies each per-provider shard's `.sigstore` Sigstore bundle
  against the live Sigstore Fulcio root (online) or the pinned root
  (airgap mode, v0.2+).
- Walks Rekor for inclusion proofs of every shard signature.

E2 ships this command; v0.1 wires the data path so it Just Works.

## Bundle paths

The bundle lives in an OS-specific data directory:

| OS | Default bundle root |
|---|---|
| Linux / macOS | `~/.config/vegastack/bundle` |
| Windows | `%LOCALAPPDATA%\vegastack\bundle` |

Override with `VEGA_BUNDLE_DIR`. The previous bundle generation is kept
at `<root>.previous` for one-step rollback.

## Channels

v0.1 ships **only the `latest` channel** — every successful daily
build-and-publish run becomes the new `latest`.

The `stable` channel (≥7-day soak with eval lift unchanged or up) is
**coming in v0.2**. Once available it will be selectable via
`VEGA_BUNDLE_CHANNEL=stable npm install -g @vegastack/cli` or
`vega update --channel stable`.

## Air-gapped install (`vega install --offline <path>`)

**Available v0.2.** For regulated environments without npm registry or
GitHub egress, v0.2 will ship a quarterly `airgap-<CALVER>.tar.gz`
containing the npm package, the bundle, the Sigstore bundle, the SBOM,
and `verify.sh` / `verify.ps1` scripts. The flow will be:

```bash
# Download once on a connected machine, sneakernet to the target:
curl -O https://github.com/vegastack/vegastack-cli/releases/download/airgap-2026.Q3/airgap-2026.07.01.tar.gz

# On the target:
vega install --offline ./airgap-2026.07.01.tar.gz
```

`vega install --offline` will extract, verify SHA-256 + Sigstore against
a Fulcio root pinned in the CLI binary, and set `VEGA_OFFLINE=1` so the
runtime never tries to phone home for updates.

For v0.1, regulated users can manually mirror the bundle:

```bash
# On a connected workstation:
curl -O https://bundles.vegastack.com/bundles/2026.04.28/vegastack-bundle-2026.04.28.tar.gz
curl -O https://bundles.vegastack.com/bundles/2026.04.28/vegastack-bundle-2026.04.28.tar.gz.sha256
curl -O https://bundles.vegastack.com/bundles/2026.04.28/vegastack-bundle-2026.04.28.tar.gz.sigstore

# Sneakernet, then on the air-gapped host:
VEGA_BUNDLE_URL="file:///path/to/vegastack-bundle-2026.04.28.tar.gz" \
  npm install -g @vegastack/cli
```

## Environment variables

| Var | Effect |
|---|---|
| `VEGA_BUNDLE_DIR` | Override the bundle install root. |
| `VEGA_BUNDLE_URL` | Pull the full bundle from a custom URL (file:// works for offline). |
| `VEGA_BUNDLE_MANIFEST_URL` | Override the manifest URL (default `https://bundles.vegastack.com/manifest.json`). |
| `VEGA_BUNDLE_CHANNEL` | Channel to track: `latest` (default in v0.1). `stable` arrives v0.2. |
| `VEGA_SKIP_POSTINSTALL` | Skip the postinstall bundle fetch. Useful in CI / dev. |
| `VEGA_OFFLINE` | Disable all network calls (no update notifier, no manifest fetch). |
| `NO_UPDATE_NOTIFIER` / `VEGA_NO_UPDATE_NOTIFIER` | Suppress the weekly "newer CLI available" nag. |
| `DO_NOT_TRACK` | Disables both update notifier and (when telemetry ships) telemetry. |
| `CI` | If `true`, auto-suppresses update notifier and telemetry. |

## Supply-chain integrity

Every artifact `vega` consumes is verifiable:

- **npm package** — `npm install` checks the npm provenance attestation
  (Sigstore-backed, Rekor-logged) automatically. `npm audit signatures`
  re-verifies.
- **bundle full tarball** — `.sha256` sidecar + `.sigstore` Sigstore
  bundle. `cosign verify-blob --bundle <bundle>.sigstore <bundle>` works
  offline once the Fulcio root is pinned (v0.2).
- **bundle per-provider shards** — same: each shard at
  `cas/sha256/<hex>.tar.gz` ships with `.sha256` and `.sigstore`. The
  hash *is* the URL — tampering would have to break SHA-256.

## Troubleshooting

### `postinstall` failed to download the bundle

Likely network or DNS. Re-run with `vega doctor` to see the exact URL
that failed. Common fixes:

- Corporate proxy strips Range requests → set `VEGA_NO_RANGE=1` to fall
  back to a full-tarball download.
- Cloudflare R2 unreachable → the loader auto-falls-back to the GitHub
  Releases mirror; `vega doctor` will report "primary CDN unreachable,
  mirror used".

### "expectedBundleSha mismatch"

The bundle on disk doesn't match the SHA the CLI was tagged against.
Either:

- The bundle was tampered with on disk → run `vega update --rollback`
  or reinstall.
- A daily bundle update raced your CLI install → run `vega update` to
  bring the bundle to current.

### Windows long paths

If you see `ENAMETOOLONG`, enable long-path support:

```powershell
git config --global core.longpaths true
# And as Administrator:
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```
