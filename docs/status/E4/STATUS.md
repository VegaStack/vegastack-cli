# E4 — Distribution + auto-update — STATUS

**Status:** READY TO COMMIT (no commit made; the user reviews diffs).
**Time:** ~75 min wall-clock.
**Build/typecheck/lint:**
- `actionlint` on all 4 workflows → **EXIT 0** (clean).
- `npx vitest run tests/scripts/` → **7/7 passing**.
- `prettier --check` on all touched JS/JSON → **EXIT 0**.
- `npm run typecheck` — pre-existing E1/E2-owned errors in
  `tests/integration/discover-{native,parity}.test.ts` (out of my scope);
  my new test file is clean.

## What changed

### CLI repo `/Users/mk/projects/vegastack-cli/`

| File | Change | LOC delta |
|---|---|---|
| `.github/workflows/release.yml` | Refactored to OIDC trusted publishing; added `actions/attest-build-provenance@v2` for SLSA L3; bumped to `actions/setup-node@v6`; added `workflow_dispatch` for manual first-time test; added `permissions: id-token: write` + `attestations: write`; removed all `NPM_TOKEN` references | +130 / -50 |
| `.github/workflows/release-changesets.yml` | Removed `NPM_TOKEN` env (publish moved to release.yml); bumped to `actions/setup-node@v6`; clarified that `tag-release.js` performs the bundle pin then cuts the tag | +10 / -10 |
| `.github/workflows/evals-upload-r2.yml` | NEW — reusable `workflow_call` that uploads eval reports to R2 under `evals/<YYYY-MM-DD>/` and `evals/latest/`. E6 calls this from their `evals.yml`. | +60 |
| `.changeset/config.json` | Switched changelog to `@changesets/changelog-github` with repo config | +3 / -1 |
| `package.json` | Added `expectedBundleVersion` + `expectedBundleSha` top-level fields (E2 reads); added `@changesets/changelog-github@^0.6.0` devDep | +3 |
| `scripts/tag-release.js` | Major extension — fetches bundle CalVer + sha256 from R2 manifest; pins them into `package.json`; commits + pushes; then runs idempotent tag flow. Pure pin function exported for unit tests. | +130 / -3 |
| `tests/scripts/tag-release.test.ts` | NEW — 7 tests covering pin idempotency, channel selection, sha-prefix handling, flat manifest fallback, missing-channel + missing-fields error paths | +95 |
| `CONTRIBUTING.md` | Added Wrangler "every non-breaking change ships as patch" rule paragraph | +9 |
| `docs/INSTALL.md` | NEW — end-user install doc covering npm install → postinstall → R2 fetch → atomic swap; `vega doctor --verify-attestations`; airgap path noted as v0.2; env vars; troubleshooting; channel matrix | +160 |

### Bundle repo `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/`

| File | Change | LOC delta |
|---|---|---|
| `.github/workflows/build-and-publish.yml` | NEW — daily cron `0 6 * * *` UTC; 3 jobs (build / shard-and-sign / publish-r2 + github-release); calls E1's `manifest_builder.py`, `build_companions.py`, `build_aliases.py`, `validate_manifest.py`; tars per-provider; `cosign sign-blob` per shard via `sigstore/cosign-installer@v4.1.0` (cosign v3.0.6); uploads content-addressed shards to R2; writes root `manifest.json`; mirrors full bundle to GH Releases | +260 |
| `docs/RELEASE.md` | NEW — operator runbook: pipeline overview, R2 first-time setup (bucket, custom domain `bundles.vegastack.com`, CORS for `evals.vegastack.com`, API tokens, GH secrets), first-time test via `gh workflow run --dry-run`, troubleshooting, v0.2 deltas (`stable` channel, airgap drop) | +150 |

## Web-search → version pins

- `actions/setup-node@v6` — current major as of April 2026 (auto-cache from packageManager field; supports Node 24 runtime).
- `sigstore/cosign-installer@v4.1.0` — required for cosign 3.x line; latest stable.
- `cosign v3.0.6` — current GA cosign release (April 6, 2026).
- `actions/attest-build-provenance@v2` — pinned to v2 per brief; v4.1.0 is also available but is a thin wrapper over `actions/attest`. v2 is still maintained and the documented stable major.
- `@changesets/changelog-github@^0.6.0` — current stable.
- npm trusted publishing — **GA since 2025-07-31** ([GitHub blog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)). With OIDC, npm CLI 11+ publishes provenance automatically — `--provenance` flag no longer needed (we omit it from `npm publish`).
- Cloudflare R2 + GitHub Actions — `aws-actions/configure-aws-credentials` does NOT work cleanly with R2 (tries `sts.auto.amazonaws.com`). Documented pattern: set `AWS_ACCESS_KEY_ID/SECRET/_REGION=auto` directly and use AWS CLI v2 (preinstalled on `ubuntu-latest`) with `--endpoint-url https://<acct>.r2.cloudflarestorage.com`. Implemented this way in both `evals-upload-r2.yml` and `build-and-publish.yml`.
- `wrangler 4.85.0` — referenced in RELEASE.md (`npx wrangler@latest r2 bucket create`).
- `actionlint v1.7.12` — installed locally via Homebrew; ran against all 4 workflows.

No new packages installed (changeset already had `@changesets/cli` deeply pinned at `^2.27.1`; only added `@changesets/changelog-github` to devDeps as a string entry — `npm install` will resolve at first user-side install).

## What's BLOCKED

- **E1 must ship** `scripts/manifest_builder.py`, `scripts/build_companions.py`, `scripts/build_aliases.py`, `scripts/validate_manifest.py` in the bundle repo. The build workflow `::error::`'s loudly if `manifest_builder.py` or `validate_manifest.py` is missing (warns for the optional companions/aliases). This is the daily-cron contract.
- **R2 bucket + custom domain** must be provisioned by ops (one-time, ~15 min, runbook in `bundle/docs/RELEASE.md`). Until that lands, `workflow_dispatch -f dry-run=true` is the only safe trigger — it builds + signs + validates locally.
- **GitHub repo secrets** must be added in both repos: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Documented in `RELEASE.md`.
- **npm trusted publisher** registration on npmjs.com for `@vegastack/cli` — one-time setup that maps the package to `vegastack/vegastack-cli` repo + `release.yml` workflow. Without this, the OIDC publish step will 401.

## Cross-team contracts

See `cross-team-touch.md` for the full notes on E1/E2/E6/E8 hand-offs.

Headline:
- **E2** reads `package.json.expectedBundleVersion` + `expectedBundleSha`. Names locked.
- **E6** calls `evals-upload-r2.yml` as a reusable workflow from their `evals.yml`. The contract is `with: report-path: <dir>` + `secrets: inherit`.
- **E8** must use `https://evals.vegastack.com` as origin — the R2 CORS rule documented in `RELEASE.md` allow-lists exactly that origin (plus localhost dev ports).
- **E7** binds R2 server-side via Workers binding in their `wrangler.toml` — no CORS needed.

## Contract issues raised

None. The `manifest.schema.json` and `discover-types.ts` contracts are read-only consumers for me; nothing flagged.

## What's left for the audit team

1. End-to-end test of `release.yml` requires the npmjs.com trusted-publisher entry plus a real tag — I've added `workflow_dispatch` so it can be invoked once that's set up without cutting a real semver tag.
2. Daily cron in `build-and-publish.yml` needs ~24h to actually fire. The runbook has the `dry-run=true` smoke-test path for immediate verification.
3. Verify the bundle pin round-trip: cut a fake `vega-bot` PR merge → `tag-release.js` should fetch from R2 → write to `package.json` → commit → tag → trigger publish.
4. Confirm the `cosign sign-blob` keyless flow works end-to-end on a Sigstore-Fulcio test cert (the workflow has `id-token: write` set per-job).
5. CORS rule on R2 needs functional verification by E8 against the deployed dashboard.

## Out of scope (per v0.1 overrides + brief explicit "what NOT to do")

- Airgap quarterly drop — noted as v0.2 in INSTALL.md and RELEASE.md.
- PostHog telemetry — E2 ships the no-op stubs.
- `stable` channel — documented as v0.2 in RELEASE.md (only `latest` ships in v0.1).
- Cosign-signing the **CLI** tarball — npm provenance is sufficient per brief; only the **bundle** is cosign-signed.
- `vega update`, `update-notifier`, `bundle-paths.ts`, `npm/install.js` per-shard fetcher — these belong to the auto-update scope; the brief restricted me to the release-pipeline scope (workflows + tag-release.js + docs + changesets config + package.json fields). The CLI runtime side of the auto-update story is for E2 (or a follow-up E4 cycle) to wire.
