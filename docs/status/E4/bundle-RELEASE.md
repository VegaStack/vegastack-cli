# Bundle release pipeline — operator runbook (v0.1)

This document describes how to bring up and operate the daily bundle
release train for `@vegastack/cli`. Last updated: 2026-04-28 (v0.1 cut).

## What this pipeline does

`.github/workflows/build-and-publish.yml` runs every day at 06:00 UTC
(11:30 IST / 23:00 PT previous day). It:

1. Syncs upstream Terraform provider docs.
2. Builds per-provider `MANIFEST.json` files via `scripts/manifest_builder.py`.
3. Builds companion + alias indexes via `scripts/build_companions.py` and
   `scripts/build_aliases.py`.
4. Validates every manifest against `schema/manifest.schema.json` via
   `scripts/validate_manifest.py` — fails the run if any provider is
   non-conforming.
5. Tars each provider individually as `<provider>.tar.gz`, computes
   SHA-256 sidecars, and signs each shard with `cosign sign-blob` (keyless,
   OIDC, Sigstore Fulcio) to produce `.sigstore` bundles.
6. Uploads the content-addressed shards (`cas/sha256/<hex>.tar.gz`) to
   Cloudflare R2 with a forever cache header (the address *is* the digest,
   so the body is immutable).
7. Mirrors the **full bundle.tar.gz** to GitHub Releases as the
   corporate-firewall fallback (R5 §3 — the CLI prefers R2 and falls
   back to GH Releases on R2 outage).
8. Re-publishes the **root manifest.json** at
   `https://bundles.vegastack.com/manifest.json` listing every shard digest
   plus the bundle CalVer for the `latest` channel.

## v0.1 deltas vs the long-form plan

- **Only the `latest` channel ships.** `stable` (≥7-day soak + eval lift
  unchanged) is documented here as **coming in v0.2**.
- **No airgap quarterly drop.** Deferred to v0.2 (R5 §8).
- **Bundle is cosign-signed; CLI tarball is not** (npm provenance suffices
  for the npm package per the team brief).

## First-time R2 setup (one-time, ~15 min)

### 1. Create the R2 bucket

Via Cloudflare dashboard:

1. **Storage & Databases → R2** → **Create bucket**.
2. Name: `vegastack-bundles` (or another canonical name; capture the
   exact name in the GitHub secret `R2_BUCKET` below).
3. Location: **Automatic** (R2 is Anycast; no region pin needed).

Or via `wrangler` CLI (≥ v4.85.0 as of April 2026):

```bash
npx wrangler@latest r2 bucket create vegastack-bundles
```

### 2. Bind a custom domain

1. **R2 bucket → Settings → Custom Domains → Connect Domain**.
2. Enter `bundles.vegastack.com`. Cloudflare provisions the cert
   automatically (assuming the zone is on Cloudflare DNS).
3. Verify resolution: `dig bundles.vegastack.com +short` should return
   Cloudflare IPs.

### 3. Configure CORS (so the dashboard can fetch eval reports)

The Astro dashboard (`apps/dashboard/`, deployed to Cloudflare Workers
by team E8) lives at `https://evals.vegastack.com`. It fetches
`/manifest.json` and `/evals/latest/report.json` from R2. R2 needs an
explicit CORS rule, or the browser will refuse the response.

**R2 bucket → Settings → CORS Policy → Add CORS Policy**, paste:

```json
[
  {
    "AllowedOrigins": [
      "https://evals.vegastack.com",
      "https://*.evals.vegastack.com",
      "http://localhost:4321",
      "http://localhost:8788"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

The `localhost` entries cover Astro dev (`4321`) and `wrangler dev`
(`8788`). E8 must use exactly `https://evals.vegastack.com` in
production for the preflight to succeed.

E7 (MCP server, `apps/mcp/`) reads R2 server-side — Workers can be
granted read-only access via an R2 binding in `wrangler.toml`, no CORS
needed.

### 4. Create R2 API tokens for GitHub Actions

R2 speaks the S3 API. The cleanest path for GitHub Actions is to skip
`aws-actions/configure-aws-credentials` (which tries to talk to AWS STS
even when targeting R2) and supply credentials directly to the AWS CLI v2
that ships preinstalled on `ubuntu-latest`.

1. **R2 → Manage API Tokens → Create API Token**.
2. Permissions: **Object Read & Write**.
3. Specify bucket: select `vegastack-bundles` only.
4. TTL: **Forever** (rotate annually as a separate manual chore).
5. Save the **Access Key ID** and **Secret Access Key** — you only see
   the secret once.

### 5. Add GitHub repo secrets

In **vegastack/engg-vegastack-agent-tf-providers → Settings → Secrets
and variables → Actions**, add:

| Name | Value |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account ID (visible in the R2 dashboard URL) |
| `R2_ACCESS_KEY_ID` | from step 4 |
| `R2_SECRET_ACCESS_KEY` | from step 4 |
| `R2_BUCKET` | `vegastack-bundles` (or whatever you named it) |

The same three R2 secrets must also be added to the **vegastack-cli** repo
so its `evals-upload-r2.yml` reusable workflow can write eval reports.

## First-time test (manual trigger)

Before relying on the cron, smoke-test the pipeline:

```bash
gh workflow run build-and-publish.yml \
  --repo vegastack/engg-vegastack-agent-tf-providers \
  -f dry-run=true
```

`dry-run=true` runs the full build + sign + manifest pipeline but skips
the R2 upload + GH release mirror. Verify the workflow succeeds and the
artifact `dist-<CALVER>` contains the expected `.tar.gz`, `.sha256`, and
`.sigstore` files.

Then run a real publish:

```bash
gh workflow run build-and-publish.yml \
  --repo vegastack/engg-vegastack-agent-tf-providers
```

Confirm:

- `https://bundles.vegastack.com/manifest.json` returns the new CalVer.
- `https://bundles.vegastack.com/cas/sha256/<one-shard-hex>.tar.gz`
  downloads.
- `https://github.com/vegastack/engg-vegastack-agent-tf-providers/releases/tag/bundle-v<CALVER>`
  shows the full bundle.

## Daily cron schedule

The cron is `0 6 * * *` (06:00 UTC). To change cadence, edit the
`schedule:` block in `.github/workflows/build-and-publish.yml`.

To **temporarily disable** the cron without deleting the workflow:

```bash
gh workflow disable build-and-publish.yml \
  --repo vegastack/engg-vegastack-agent-tf-providers
```

## Troubleshooting

### "scripts/validate_manifest.py is missing"

E1 owns the validator. If the workflow exits at this step, sync with E1
on the script's filename and invocation pattern, then update the
"Validate every manifest against schema" step.

### `cosign sign-blob` fails with "no identity tokens"

The `id-token: write` permission must be set at the job level (not just
the workflow). Sigstore's keyless flow requires the GitHub OIDC token.

### R2 upload fails with "InvalidAccessKeyId"

The R2 token has been rotated or scoped to a different bucket. Re-create
per step 4 above and update the GitHub secret.

### R2 upload fails with "getaddrinfo ENOTFOUND sts.auto.amazonaws.com"

You are using `aws-actions/configure-aws-credentials` instead of bare
env-var auth. Remove that action — the workflow in this repo deliberately
sets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` directly because R2
does not have an STS endpoint.

## Coming in v0.2

- **`stable` channel.** Bundle promoted to `stable` after ≥7 days on
  `latest` with eval lift unchanged or improving. `vega install --channel stable`
  pins to it. Promotion command: `vega-bot promote stable <CALVER>`.
- **Quarterly airgap drop.** `airgap-<CALVER>.tar.gz` containing the
  bundle + Sigstore bundle + verify.sh / verify.ps1 + pinned Fulcio
  root, downloadable from GH Releases. `vega install --offline <path>`
  on the user side.
- **CLI tarball cosign signing.** v0.1 ships npm provenance only; v0.2
  adds `cosign sign-blob` for the npm tarball as well, for parity.
- **CycloneDX SBOM** for both npm package and bundle.
