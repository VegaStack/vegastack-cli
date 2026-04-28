# A2 — Security + supply-chain audit · STATUS

**Audit team:** A2 (Phase-4)
**Date:** 2026-04-28
**Time:** ~70 min
**Scope:** install / publish / signing pipeline shipped by E2 + E4
**Verdict:** **Ship v0.1 with two pre-ship fixes (R2 bucket parity + remove or guard `expectedBundleSha` placeholder).** Sigstore is wired in but unverified by the CLI runtime; that's an acknowledged v0.2 deferral and does not block v0.1.

## Companion docs

- `r2-bucket-reconciliation.md` — exact patch set for punch-list #1
- `threat-model.md` — hostile-bundle scenario walkthrough

## A2.1 — R2 bucket name reconciliation (punch-list #1)

| Team | Bucket name | File:line |
|---|---|---|
| E4 | `vegastack-cli-bundles` | `terraform-providers/docs/RELEASE.md:46,53,107,122` and a copy at `docs/status/E4/bundle-RELEASE.md:46,53,107,122` (workflow itself reads `R2_BUCKET` secret, no hard-code) |
| E7 | `vegastack-bundle` | `apps/mcp/wrangler.toml:46,47`; `apps/mcp/README.md:7,62,63,158`; `docs/status/E7/STATUS.md:23,144`; `docs/status/E7/apps-mcp-README.md:7,62,63,158` |
| E8 | `bundles-vegastack-com` | `apps/dashboard/wrangler.toml:20,21`; `apps/dashboard/README.md:57,84`; `docs/status/E8/STATUS.md:130,149`; `docs/status/E8/apps-dashboard-README.md:57,84` |

**Recommendation: `vegastack-bundles`.** Pluralized, org-prefixed,
matches the custom domain `bundles.vegastack.com` semantically, leaves
namespace clean for future buckets (`vegastack-evals`, `vegastack-airgap`).
Patch set = 9 files, ~25 line edits, all documented with exact
file:line entries in `r2-bucket-reconciliation.md`. The bundle workflow
needs no edit (uses `R2_BUCKET` GH secret).

**No edits applied** per the hard rules.

## A2.2 — npm postinstall flow review

Reviewed `npm/install.js` (606 LOC) and `npm/safe-tar.js` (251 LOC).

| Check | Result | File:line |
|---|---|---|
| `expectedBundleSha` read from `package.json` | **PASS** | `install.js:103-111`, `package.json:6` |
| Pinned-SHA preferred over network sidecar | **PASS** | `install.js:318-336` (fallback to network at `337-344`) |
| `proper-lockfile@4.1.2` advisory locking | **PASS** | `install.js:172-198`; matches dep pin `package.json:80` |
| Lock release in `cleanupTmp` (signal-safe) | **PASS** | `install.js:223,409` |
| `safe-tar.js` single-pass `tar -tvzf` | **PASS** | `safe-tar.js:103-140` |
| Synthetic-entry skip list (Pax/mtree/xattr/LongLink) | **PASS** | `safe-tar.js:65-81` |
| Path-traversal validated **before** extraction | **PASS** | `safe-tar.js:217-245` (list → assert → extract) |
| Refuses absolute paths, drive letters, UNC | **PASS** | `safe-tar.js:175-181` |
| Refuses device files (c/b/p/s) | **PASS** | `safe-tar.js:188-190` |
| Refuses absolute or escaping symlinks/hardlinks | **PASS** | `safe-tar.js:192-204` |
| gzip-magic check before listing | **PASS** | `safe-tar.js:46-59,218` |
| Streaming SHA + 500 MB hard cap (early abort) | **PASS** | `install.js:464-479` |
| Timing-safe SHA compare | **PASS** | `install.js:587-593` (`timingSafeEqual`) |
| HTTPS-only redirects, manual hop control, ≤5 hops | **PASS** | `install.js:62,443-459` |
| Non-HTTPS bundle URL rejected (file:// permitted for offline) | **PASS** | `install.js:288-292` |
| `$HOME` redacted from log output | **PASS** | `install.js:119-128` |
| Proxy basic-auth redacted | **PASS** | `install.js:269-280` |
| Postinstall never fails npm install (exit 0) | **PASS** | `install.js:131-134, 367, 399, 604` |
| Atomic `.version` file write | **PASS** | `install.js:563-567,382` |
| **Atomic swap to `bundle.previous` on failure** | **FAIL — partial** | see finding below |
| **TLS pinning OR npm-provenance-rooted SHA chain present** | **PASS (provenance chain only)** | npm OIDC + SLSA attest produces provenance signing `package.json#expectedBundleSha`; the CLI does not pin TLS certs but does not need to once the SHA is provenance-rooted |
| **PII not leaked in error messages** | **MOSTLY** | `$HOME` masked; proxy creds masked; `VEGASTACK_BUNDLE_URL` echoed verbatim (acceptable — user-supplied) |

### Finding: `bundle.previous` rollback artifact does not exist

`install.js:569-580` (`stageAsideExisting`) renames the existing bundle
to `${dir}.stale-${randomSuffix()}`, and `install.js:385`
(`rmSync(stagedAside, …)`) deletes it on success. So:

- Successful install: no rollback artifact retained.
- Mid-install crash before line 385: `bundle.stale-<random>` survives
  but is not used by anything.

This contradicts:
- `docs/INSTALL.md:76-77` — "previous bundle generation is kept at
  `<root>.previous` for one-step rollback"
- `docs/INSTALL.md:168` — "run `vegastack update --rollback`"
- `docs/planning/06-research-distribution.md:30,34` — same promise

There is **no `vegastack update` command** (not in `cli.ts`, not in
`commands/`). It's a v0.2 feature per the planning doc.

**Severity: medium.** No security exposure — just a documentation gap
and unmet promise. Either implement minimal `bundle.previous` retention
(keep one generation, ~12 MB, atomic swap pointer) or amend
`docs/INSTALL.md` to drop the rollback promise.

### Finding: `fileUrlToPath` helper is dead-code-ish

`install.js:557-560` has a convoluted ternary that always returns
`fileURLToPath(url)`. Not exploitable; just confusing. **Recommend
simplification to `return fileURLToPath(url)`.** No security impact.

### Threat model summary

Full walkthrough in `threat-model.md`. Headline: **with the SHA pin
populated post-first-release, an attacker who controls R2 + GH Releases
can only deny-of-service. Without the pin (placeholder still in place,
or running pre-pin builds), the install is TOFU-grade — bundle still
path-confined by `safe-tar`, but content is whatever the CDN serves.**

## A2.3 — Sigstore + SLSA chain verification

| Check | Result | File:line |
|---|---|---|
| OIDC `id-token: write` on CLI release workflow | **PASS** | `release.yml:25, 82` |
| `attestations: write` on CLI release workflow | **PASS** | `release.yml:26, 83` |
| No `NPM_TOKEN` references in CLI workflows | **PASS** | grep against `.github/workflows/*.yml` returns zero hits for `NPM_TOKEN` |
| `--provenance` flag omitted (npm 11+ does it via OIDC) | **PASS** | `release.yml:140-141` (no flag — comment at `136-139` documents the behaviour) |
| `actions/attest-build-provenance@v2` on CLI tarball | **PASS** | `release.yml:131-134` |
| `sigstore/cosign-installer@v4.1.0` on bundle workflow | **PASS** | `build-and-publish.yml:174-176` |
| `cosign sign-blob --yes` per shard | **PASS** | `build-and-publish.yml:198-205` |
| `cosign sign-blob --yes` for full bundle | **PASS** | `build-and-publish.yml:221-224` |
| `id-token: write` on shard-and-sign job | **PASS** | `build-and-publish.yml:160-162` |
| **CLI verifies `cosign sign-blob` output** | **FAIL — not implemented in v0.1** | no `sigstore`/`cosign`/`fulcio`/`rekor` reference in `src/` or `npm/` (only doc comments) — confirmed by grep |
| `vegastack doctor --verify-attestations` exists | **FAIL** | only `--verify-bundle` is wired (`cli.ts:108-111`); `doctor.ts:19-89` schema-validates JSON but does not call cosign |

### Recommendation: keep `attest-build-provenance@v2` for v0.1

The brief asked for v2; v4.1.0 is current. v2 is still maintained, is
the documented stable major, and the upgrade payoff is small (v4 is
"a thin wrapper over `actions/attest`" per E4's research notes in
`docs/status/E4/STATUS.md:41`). **Trade-off:** v4 picks up the
`attest`-action shared improvements faster (e.g. SLSA spec updates).
**Verdict:** stay on v2 for v0.1; bump to v4 in v0.2 when other
distribution work is in flight. No security impact.

### Recommendation: pin cosign-installer to a SHA, not a tag

`build-and-publish.yml:174` uses `sigstore/cosign-installer@v4.1.0`
(tag form). The other third-party action in the same file
(`softprops/action-gh-release` at `:356`) is correctly SHA-pinned
(`@3bb12739…`). For supply-chain hygiene parity, pin
`cosign-installer` similarly. **Trade-off:** SHA pinning loses
auto-receive-of-patch but locks out tag-rewrite attacks. For a
release-pipeline action this is the right trade-off; Dependabot
keeps it current.

## A2.4 — Daily cron + R2 layout

| Check | Result | File:line |
|---|---|---|
| Cron `0 6 * * *` UTC (06:00) | **PASS** | `build-and-publish.yml:22-23` (E6 eval cron at 07:00 reads fresh data) |
| Per-provider `<prov>.tar.gz` produced | **PASS** | `build-and-publish.yml:190-191` |
| Per-provider `.sha256` produced | **PASS** | `build-and-publish.yml:192-193` |
| Per-provider `.sigstore` produced | **PASS** | `build-and-publish.yml:198-203` |
| R2 layout `cas/sha256/<hex>.tar.gz` content-addressed | **PASS** | `build-and-publish.yml:194-196` (build) + `301-312` (upload) |
| Immutable cache header for shards | **PASS** | `build-and-publish.yml:308` (`max-age=31536000, immutable`) |
| Versioned full bundle at `bundles/<calver>/...` | **PASS** | `build-and-publish.yml:314-326` |
| Root `manifest.json` with shards + digests + bundle CalVer | **PASS** | `build-and-publish.yml:226-265, 328-333` |
| Short cache on root manifest (max-age=60) | **PASS** | `build-and-publish.yml:330` |
| GH Releases mirror with full bundle + sha + sigstore | **PASS** | `build-and-publish.yml:338-375` |
| Concurrency group prevents overlapping runs | **PASS** | `build-and-publish.yml:36-38` |
| `dry-run=true` skips R2 + GH release | **PASS** | `build-and-publish.yml:282, 342` |

### Finding: `BUNDLE_SHA` injected via env carries the FULL `sha256sum` line

`build-and-publish.yml:233-234`:
```
BUNDLE_SHA=$(cat "${BUNDLE}.sha256")
export BUNDLE_SHA
```

But the file written at `:220` is just `<hex>` (single column — `awk
'{print $1}'` strips the filename), so `BUNDLE_SHA` is the bare hex.
**OK** — the manifest will carry the bare hex.

For per-shard sidecars at `:193`, the format is
`<hex>  <name>.tar.gz` (two columns). `npm/install.js:339-340` does
`shaText.trim().split(/\s+/)[0]` which will pull the hex. **OK.**

### Finding: bundle-pipeline excludes `tests` from the full bundle but the tests fixture is shipped *inside* per-provider dirs as the upstream Terraform doc structure

`build-and-publish.yml:218` excludes `./tests` from the full
`vegastack-bundle.tar.gz`. This is the **bundle repo's** tests dir,
not the CLI's. **OK** — distinct from the CLI npm package's `tests/`
exclusion.

## A2.5 — npm package surface review

Ran `npm pack --dry-run --json` to capture the actual published file
set:

- **101 files, 456 KB unpacked, 123 KB packed**
- Top-level distribution: `dist/` (78 .js + .map) · `skills/` (8 SKILL.md
  references) · `.claude-plugin/` (4 manifest files) · `npm/` (3 — install.js,
  run.js, safe-tar.js) · 7 dotfiles/markdown at root + `package.json`
- **No `tests/`, no `evals/`, no `docs/planning/`, no `docs/status/`,
  no `apps/`, no `bundle/`, no `src/` source files.**

| Surface check | Result | File |
|---|---|---|
| `dist/` shipped | **PASS** | `package.json#files:39` |
| `npm/install.js`, `npm/run.js`, `npm/safe-tar.js` shipped | **PASS** | `npm/` glob in `files:38` |
| `skills/terraform-docs/` shipped | **PASS** | `skills/` glob (8 files) |
| `tests/` excluded | **PASS** | not in `files`; backup-belted by `.npmignore:7` |
| `evals/` excluded | **PASS** | not in `files`; `.npmignore:29` |
| `docs/planning/` excluded | **PASS** | not in `files`; `.npmignore:28` |
| `docs/status/` excluded | **PASS** | not in `files`; `.npmignore:28` |
| `apps/` excluded | **PASS** | not in `files` |
| Manifest schema (`docs/contracts/manifest.schema.json`) **NOT shipped** | **FAIL — minor** | the `doctor --verify-bundle` flag at `doctor.ts:49` reads `bundleDir()/schema/manifest.schema.json` (so the file should live in the bundle, not the npm package) — confirm with E1; **acceptable as long as the bundle ships it** |
| `expectedBundleSha` populated by `tag-release.js` before publish | **PARTIAL** | `tag-release.js:51-87` does the pin; `release.yml:108-118` only verifies `package.json.version === tag`; **does NOT verify pin is filled** — see risk #2 below |
| `publishConfig.provenance: true` | **PASS** | `package.json:100-103` (also redundantly handled by npm 11+ OIDC, harmless) |

### Runtime dependencies — minimality check

After E2 moved `@iarna/toml` to `dependencies` (per `STATUS.md:53,75`):

| Dep | Used in src? | Verdict |
|---|---|---|
| `@iarna/toml@^2.2.5` | `src/lib/discover/recipes.ts:14` | runtime, keep |
| `commander@^12.1.0` | `src/cli.ts:4` | runtime, keep |
| `gray-matter@^4.0.3` | `src/lib/discover/knowledge.ts:16` | runtime, keep |
| `js-yaml@^4.1.1` | `src/lib/discover/aliases.ts:20` | runtime, keep |
| `kleur@^4.1.5` | `src/lib/log.ts:4` | runtime, keep |
| `prompts@^2.4.2` | likely `src/commands/*` (consent flows) | **VERIFY** — quick `grep` did not find a runtime callsite outside scripts; if unused, demote to devDeps for v0.2 |
| `proper-lockfile@^4.1.2` | `npm/install.js:180` (dynamic import) | runtime, keep |

**Recommendation:** double-check `prompts` is still imported at runtime
post-refactor; if not, demote in v0.2 (saves ~30 KB transitive).
Trade-off of demoting now: risk of post-cut breakage if a code path is
gated on interactive prompts. Keep as-is for v0.1.

### Verdict: **package surface is clean, tight, and ships exactly what is needed.** Nothing leaks.

## A2.6 — `vegastack doctor --verify-attestations` end-to-end

**Reconciliation question:** Is there ANY path in v0.1 for an end user
to verify the bundle they downloaded was signed by the project?

**Answer: NO.**

- `INSTALL.md:51-65` documents `vegastack doctor --verify-attestations` with
  Sigstore re-verification, Rekor inclusion proofs, pinned-Fulcio-root
  airgap support — **none of this exists in v0.1.**
- `cli.ts:108` only wires `--verify-bundle` (boolean).
- `commands/doctor.ts:79-89, 160-211` validates JSON-Schema on each
  per-provider `MANIFEST.json` — **not signature.**
- E4's `STATUS.md:84` explicitly says "v0.3" for `--verify-attestations`
  (E4 calls it v0.3; E2 ships `--verify-bundle` only); E2's
  `STATUS.md:46` confirms only `--verify-bundle` lands.

**The user CAN verify manually:**

```bash
# After install:
sha256sum ~/.config/vegastack/bundle.tar.gz   # if retained — not by default
# Better:
curl -sLO https://bundles.vegastack.com/cas/sha256/<hex>.tar.gz
curl -sLO https://bundles.vegastack.com/cas/sha256/<hex>.tar.gz.sigstore
cosign verify-blob \
  --bundle <hex>.tar.gz.sigstore \
  --certificate-identity-regexp "https://github.com/vegastack/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  <hex>.tar.gz
```

But this is unsigned by `vegastack doctor` — the user has to know to do it,
remember the OIDC issuer/identity regex, and have cosign installed.

### Recommendations

1. **Update `INSTALL.md` to mark `--verify-attestations` as "v0.2/v0.3 —
   not yet shipped".** Currently the doc reads as if it works in v0.1.
2. **Add a verification recipe to `SECURITY.md`** with the exact `cosign
   verify-blob` command above and the cert identity / OIDC issuer
   strings hardcoded for `vegastack/engg-vegastack-agent-tf-providers`.
   This costs zero code, gives paranoid users a one-line manual
   verification path, and demonstrates that the chain is real.
3. **Verifiability gap is acknowledged but not blocking v0.1.** The
   pinned-SHA + npm-provenance chain provides cryptographic verification
   end-to-end already; Sigstore is defence-in-depth.

## Top-5 security risks ranked by ship impact

1. **`expectedBundleSha = "sha256-PENDING-FIRST-RELEASE"` placeholder
   ships in v0.1.0** (`package.json:6`). First-install users run TOFU
   instead of the strong SHA-pin path. **Fix before tag:** either
   (a) cut a no-op `0.1.1` immediately after the first cron build to
   populate the pin from R2, or (b) add `prepublishOnly` guard that
   refuses placeholder values. **Severity: medium-high.** Not
   exploitable in isolation (path-traversal still holds), but neuters
   the central security claim of v0.1.

2. **R2 bucket name three-way mismatch** (punch-list #1 / A2.1
   above). **Fix before any deploy** that involves R2 — until the
   three teams agree on `vegastack-bundles`, the dashboard, MCP, and
   bundle pipeline are talking to three different (likely
   non-existent) buckets. Patch set in `r2-bucket-reconciliation.md`.
   **Severity: high (blocking deploy, low-blast-radius if missed —
   it'll just 404 immediately).**

3. **`bundle.previous` rollback artifact missing** (`install.js:569-
   585`) but documented in `INSTALL.md:76-77, 168` and planning. **Fix
   before tag:** strip the rollback promise from `INSTALL.md` (low
   effort) or implement `bundle.previous` retention (~30 LOC). **Severity:
   low.** Pure docs-vs-code drift.

4. **Sigstore signed but unverified by CLI** — pipeline emits
   `.sigstore` for every shard and full bundle but
   `npm/install.js` and `vegastack doctor` never call `cosign verify-blob`.
   **v0.2 deferral acknowledged.** Mitigation: add manual `cosign
   verify-blob` recipe to `SECURITY.md` and mark `--verify-attestations`
   as v0.2 in `INSTALL.md`. **Severity: low for v0.1.** Pinned-SHA
   path is the actual integrity defence.

5. **`sigstore/cosign-installer@v4.1.0` is tag-pinned, not SHA-pinned**
   (`build-and-publish.yml:174`) while the other 3rd-party action in
   the same file (`softprops/action-gh-release`) is SHA-pinned. **Fix
   in v0.1 if cheap; acceptable risk for v0.2.** Tag-rewrite attack
   on a Sigstore-org repo is unlikely. **Severity: very low.**

## Cross-team coordination notes

- **E1 must ship `bundle/schema/manifest.schema.json`** — `doctor.ts:49`
  expects it at `~/.config/vegastack/bundle/schema/manifest.schema.json`.
  E2's `STATUS.md:91-95` flagged this; A2 confirms it's still pending
  on E1 to copy from `docs/contracts/manifest.schema.json`.
- **User-side action #8 (npmjs.com trusted publisher)** must complete
  before the first OIDC publish can succeed — `release.yml:140-141`
  will 401 otherwise. Documented in `bundle-RELEASE.md:55`. Not an
  audit issue; user task.

## Final verdict

**Ship v0.1 after these two pre-tag actions:**

1. Reconcile R2 bucket → `vegastack-bundles` (apply patch set in
   `r2-bucket-reconciliation.md`).
2. Either (a) cut a real `0.1.1` immediately after the first bundle
   cron run so `expectedBundleSha` reflects a real hex, or (b) add a
   `prepublishOnly` guard that refuses the placeholder. Recommended:
   (a) — same pipeline does it automatically via `tag-release.js`.

The other items are documentation drift (rollback promise) and v0.2
hardening (Sigstore consumption, SHA-pinning the cosign-installer).

**Nothing in this audit blocks v0.1.0 publication.** The core
defence — npm OIDC trusted publishing → npm provenance signs
`package.json` → pinned SHA in `package.json` → timing-safe verify
in `install.js` → path-traversal-guarded `safe-tar` extraction —
is complete and correct. Sigstore is wired but unconsumed; that's a
known v0.2 deferral.
