# R2 bucket name reconciliation — patch set

**Audit:** A2 (security + supply-chain)
**Punch-list item:** #1
**Date:** 2026-04-28
**Status:** documented only — no edits applied (per the hard rules)

## Recommendation: `vegastack-bundles`

Three teams chose three different names. After grepping every reference
across both repos, the only viable single canonical name is
**`vegastack-bundles`**:

| Candidate | Pros | Cons | Verdict |
|---|---|---|---|
| `vegastack-cli-bundles` (E4) | Already in workflow + RELEASE.md | `cli` is redundant — the CLI is one consumer; E7 (MCP) and E8 (dashboard) are also reading the bucket. Renaming all three apps to include `cli` is wrong | reject |
| `vegastack-bundle` (E7) | short | singular form fights the directory layout (`/cas/sha256/<hex>` is many objects, not one); doesn't pluralize cleanly into the custom domain | reject |
| `bundles-vegastack-com` (E8) | mirrors the custom-domain `bundles.vegastack.com` | R2 bucket names allow dashes but the convention `<domain>-<tld>` only makes sense if the bucket is *the* origin; we already pin a custom domain; the indirection adds noise; also breaks if we ever move to a different TLD | reject |
| **`vegastack-bundles`** | matches custom domain `bundles.vegastack.com` semantically; plural matches the `cas/sha256/<hex>.tar.gz` + `bundles/<calver>/...` layout; org-prefixed (`vegastack-`) keeps the namespace clean for a future `vegastack-evals`, `vegastack-airgap`, etc. | requires edits in 9 files | **adopt** |

Trade-off: `bundles-vegastack-com` more obviously connotes "this bucket
backs `bundles.vegastack.com`". But once the custom domain is bound the
bucket name is internal to ops; pluralization and org-prefix matter
more long-term. The punch-list itself recommends `vegastack-bundles`
(line 12 of `docs/status/CROSS-TEAM-PUNCH-LIST.md`).

## Patch set — exact file:line edits

### CLI repo (`/Users/mk/projects/vegastack-cli/`)

#### 1. `apps/mcp/wrangler.toml` (E7)
- **L46:** `bucket_name = "vegastack-bundle"`         → `bucket_name = "vegastack-bundles"`
- **L47:** `preview_bucket_name = "vegastack-bundle-preview"` → `preview_bucket_name = "vegastack-bundles-preview"`

#### 2. `apps/mcp/README.md` (E7)
- **L7:**  `Cloudflare R2 bucket \`vegastack-bundle\`` → `Cloudflare R2 bucket \`vegastack-bundles\``
- **L62:** `wrangler r2 bucket create vegastack-bundle`         → `wrangler r2 bucket create vegastack-bundles`
- **L63:** `wrangler r2 bucket create vegastack-bundle-preview` → `wrangler r2 bucket create vegastack-bundles-preview`
- **L158:** `at the \`vegastack-bundle\` bucket` → `at the \`vegastack-bundles\` bucket`

#### 3. `apps/dashboard/wrangler.toml` (E8)
- **L20:** `bucket_name = "bundles-vegastack-com"`         → `bucket_name = "vegastack-bundles"`
- **L21:** `preview_bucket_name = "bundles-vegastack-com-preview"` → `preview_bucket_name = "vegastack-bundles-preview"`

#### 4. `apps/dashboard/README.md` (E8)
- **L57:** `wrangler.toml already binds bundles-vegastack-com.` → `wrangler.toml already binds vegastack-bundles.`
- **L84:** `R2 bucket \`bundles-vegastack-com\``               → `R2 bucket \`vegastack-bundles\``

#### 5. `docs/status/E4/bundle-RELEASE.md` (E4 status doc — informational; would also be edited if status doc ever ships into the bundle repo)
- **L46:** `Name: \`vegastack-cli-bundles\``                  → `Name: \`vegastack-bundles\``
- **L53:** `npx wrangler@latest r2 bucket create vegastack-cli-bundles` → `npx wrangler@latest r2 bucket create vegastack-bundles`
- **L107:** `select \`vegastack-cli-bundles\` only`            → `select \`vegastack-bundles\` only`
- **L122:** `R2_BUCKET | \`vegastack-cli-bundles\``            → `R2_BUCKET | \`vegastack-bundles\``

#### 6. `docs/status/E8/apps-dashboard-README.md` (mirror of #4)
- **L57:** as in `apps/dashboard/README.md` L57
- **L84:** as in `apps/dashboard/README.md` L84

#### 7. `docs/status/E8/STATUS.md`
- **L130:** Bind `bundles-vegastack-com` bucket → Bind `vegastack-bundles` bucket
- **L149:** Confirm the R2 bucket name is `bundles-vegastack-com` → Confirm the R2 bucket name is `vegastack-bundles`

#### 8. `docs/status/E7/STATUS.md`
- **L23:** `(\`BUNDLE\` → \`vegastack-bundle\`)`  → `(\`BUNDLE\` → \`vegastack-bundles\`)`
- **L144:** `pinned to \`vegastack-bundle\` (and \`vegastack-bundle-preview\`)` → `pinned to \`vegastack-bundles\` (and \`vegastack-bundles-preview\`)`

#### 9. `docs/status/E7/apps-mcp-README.md` (mirror of #2)
- **L7, L62, L63, L158:** as in `apps/mcp/README.md`

### Bundle repo (`/Users/mk/projects/engg-vegastack-agent-tf-providers/`)

#### 10. `terraform-providers/docs/RELEASE.md`
- **L46:** `Name: \`vegastack-cli-bundles\``                  → `Name: \`vegastack-bundles\``
- **L53:** `npx wrangler@latest r2 bucket create vegastack-cli-bundles` → `npx wrangler@latest r2 bucket create vegastack-bundles`
- **L107:** `select \`vegastack-cli-bundles\` only`            → `select \`vegastack-bundles\` only`
- **L122:** `R2_BUCKET | \`vegastack-cli-bundles\``            → `R2_BUCKET | \`vegastack-bundles\``

> Note: the workflow at `terraform-providers/.github/workflows/build-and-publish.yml`
> reads the bucket name from the GitHub secret `R2_BUCKET` (line 295), not
> hard-coded — so no workflow YAML edit is needed once the secret value is
> updated to `vegastack-bundles`.

## Files that DO NOT need editing

- `terraform-providers/.github/workflows/build-and-publish.yml` — reads
  `R2_BUCKET` from GH secrets (lines 295, 309, 318, 322, 326, 333). No
  hard-coded bucket name.
- `npm/install.js` — talks to `bundles.vegastack.com` (the custom domain,
  not the bucket name) and falls back to GitHub Releases. Bucket name is
  invisible to the CLI runtime.
- `scripts/tag-release.js` — same; reads `bundles.vegastack.com/manifest.json`.
- `docs/INSTALL.md`, `README.md`, `SECURITY.md` — describe URLs not buckets.
- All `vegastack-bundle-vX.Y.Z.tar.gz` filename references — that's the
  artifact filename, unrelated to the bucket name.

## User-side actions required (GitHub UI)

1. In the **bundle repo** (`vegastack/engg-vegastack-agent-tf-providers`)
   GitHub Actions secrets, set `R2_BUCKET=vegastack-bundles`.
2. In the **CLI repo** (`vegastack/vegastack-cli`) GitHub Actions secrets,
   set `R2_BUCKET=vegastack-bundles` (used by the eval-upload reusable
   workflow E4 added).
3. When provisioning the R2 bucket, name it `vegastack-bundles`. Custom
   domain `bundles.vegastack.com` binds to it.

## Verification commands (post-edit)

```bash
# Should return ZERO matches after edits land:
grep -rn "vegastack-cli-bundles\|bundles-vegastack-com" \
  /Users/mk/projects/vegastack-cli/ \
  /Users/mk/projects/engg-vegastack-agent-tf-providers/ \
  --include="*.toml" --include="*.md" --include="*.yml"

# All matches for the singular form should be in tests / artifacts that
# reference the *artifact filename* (vegastack-bundle-vX.Y.Z.tar.gz),
# never the bucket:
grep -rn "vegastack-bundle\b" /Users/mk/projects/vegastack-cli/ \
  --include="*.toml"   # → empty
grep -rn "vegastack-bundle\b" /Users/mk/projects/vegastack-cli/ \
  --include="*.md" | grep -v "\\.tar\\.gz"   # → empty after manual review
```
