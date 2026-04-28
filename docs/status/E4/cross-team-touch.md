# E4 cross-team touch notes

## E6 — `.github/workflows/evals.yml`

Per brief: "NEW — gets created by E6, but you add the workflow step that
uploads eval reports to R2 for the dashboard (E8) to consume."

To avoid colliding with E6's parallel work on `evals.yml`, E4 ships the
upload step as a **separate, reusable workflow** at
`.github/workflows/evals-upload-r2.yml`. It is a `workflow_call` reusable
workflow that takes a `report-path` input and uploads everything under
that directory to `bundles.vegastack.com/evals/` in R2.

E6 should add a final step to their `evals.yml` job that calls:

```yaml
upload:
  needs: run-evals
  uses: ./.github/workflows/evals-upload-r2.yml
  with:
    report-path: evals/reports
  secrets: inherit
```

This keeps the upload contract owned by E4 (the release-infra team) and
the eval runner owned by E6.

## E2 — `package.json` field name

E4 added two new top-level fields to `package.json`:
- `expectedBundleVersion` (string, CalVer e.g. "2026.04.28")
- `expectedBundleSha`     (string, "sha256-<hex>" prefix)

E2 should read these via `JSON.parse(readFileSync(packageJsonPath))`
and compare against the bundle on disk (sha256 of the unpacked bundle
manifest, or the cached value from the postinstall step). If the bundle
present on disk does not match, surface as a `vegastack doctor` warning and
suggest `vegastack update`.

`expectedBundleSha` is `sha256-PENDING-FIRST-RELEASE` until the first
`tag-release.js` run pulls a real value from R2.

## E1 — bundle manifest schema validator

E4's bundle build workflow calls `python3 scripts/validate_manifest.py`
(produced by E1) on every per-provider manifest. It must `exit 0` for
valid manifests and non-zero with a clear stderr message for invalid
ones. If E1 ships with a different filename or invocation pattern,
update `bundle/.github/workflows/build-and-publish.yml` step
"Validate manifests".

## E8 — dashboard CORS

E4's `bundle/docs/RELEASE.md` documents the CORS rule that allows
`https://evals.vegastack.com` to fetch:
- `bundles.vegastack.com/manifest.json`
- `bundles.vegastack.com/evals/**`

E8 must use exactly that origin (configured via the `@astrojs/cloudflare`
deployment) for the CORS preflight to pass.
