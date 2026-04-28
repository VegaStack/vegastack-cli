# Hostile-bundle threat model

**Audit:** A2 (security + supply-chain)
**Date:** 2026-04-28
**Code under review:** `npm/install.js`, `npm/safe-tar.js`, `src/commands/doctor.ts`,
`scripts/tag-release.js`, the bundle build/publish workflow.

## Scenario

An attacker has obtained one of the following capabilities:

| Capability | How they might get it |
|---|---|
| Write access to the bundle GH repo (`engg-vegastack-agent-tf-providers`) | compromised maintainer SSH key, GHA token leak |
| Write access to the R2 bucket | leaked `R2_SECRET_ACCESS_KEY` (no rotation policy yet — runbook says "rotate annually") |
| Compromised GitHub Releases asset upload (one tag) | `softprops/action-gh-release@<sha>` token, or compromised maintainer PAT |
| MITM on `github.com` / `bundles.vegastack.com` | unlikely on modern TLS but possible inside hostile networks |

The attacker uploads a malicious `vegastack-bundle-vX.Y.Z.tar.gz` and a
matching `.sha256` sidecar (the sidecar pairs trivially — they hash their
own tarball).

## Defence walkthrough — WITH OIDC publishing of the CLI in place

### Path 1: tarball name (legacy GH Releases path)

`npm/install.js#bundleUrl()` (L78–81) hits:

```
https://github.com/vegastack/vegastack-cli/releases/download/v${VERSION}/vegastack-bundle-v${VERSION}.tar.gz
```

The CLI then calls `expectedBundleSha()` (L103–111). When
`package.json#expectedBundleSha` is set to a real
`sha256-<hex>` value (which it will be after the first real release —
today it's the placeholder `sha256-PENDING-FIRST-RELEASE`):

- The CLI **trusts the package.json value over the network sidecar**
  (L320–344). Since `package.json` ships inside the npm tarball and that
  tarball is signed via npm OIDC trusted publishing → npm provenance →
  Sigstore Fulcio root, the attacker cannot forge `expectedBundleSha`
  without breaking the npm provenance chain.
- The actual download is streamed, SHA256-hashed, then compared
  **timing-safely** against the pinned hex (`sha256Equals`, L587–593).
- If the SHA mismatches, `install.js` **does not extract** (L362–368)
  and exits 0 (postinstall never fails npm install).

**Worst case:** denial of bundle install → `vegastack doctor` says
"bundle not installed". User is told to retry. **No code execution.**

### Path 2: tarball content
Even if the SHA matched (i.e. the attacker compromised both R2/GH AND
the CLI-tagging chain), `safe-tar.js` would still:

- gzip-magic check (L46–59) — refuses non-gzip streams
- single-pass `tar -tvzf` listing
- skip synthetic Pax/mtree/xattr entries
- reject absolute paths, drive letters, UNC, `..` traversal (L171–186)
- reject device files (`c`, `b`, `p`, `s`) (L188–190)
- reject symlinks/hardlinks with absolute targets or that escape the dest (L192–204)
- only THEN run `tar xzf … --no-same-owner`

**Worst case if SHA chain is also broken:** content stays inside
`~/.config/vegastack/bundle/`. No `/etc/passwd` overwrite, no
`/usr/local/bin/<malicious>`, no postinstall code execution from the
tarball itself (the bundle is data — markdown + JSON + manifest; it
contains no executable hooks).

The CLI does run `gray-matter` and `@iarna/toml` on bundle contents.
A malformed knowledge card or recipe might **crash the parser** but
neither library has a known RCE path on parse-only input.

### Path 3: lock-file abuse

`proper-lockfile@4.1.2` (L172–198) protects against parallel-install
corruption. `stale: 5 * 60_000` (5 min) reclaims a crashed install's
lock. Attacker who creates a fake lockfile gets at most a 5-minute DoS
window — recoverable.

### Path 4: redirect / proxy abuse
- L62 `ALLOWED_REDIRECT_SCHEMES = new Set(["https:"])` — refuses any
  redirect to `http://` / `file://` / `data://`.
- L460 redirect chain capped at 5 hops.
- L443 `redirect: "manual"` so the redirect target's scheme is
  re-validated per hop (does not delegate to fetch's auto-redirect).
- Proxy URLs are stripped of basic-auth before logging (L269–280).

### Path 5: log redaction
`redactUserPaths()` (L119–128) replaces `$HOME` and strips ANSI
sequences, so error output won't leak `/Users/<username>/`. It does
NOT mask the proxy hostname (only password) or `VEGASTACK_BUNDLE_URL`
(printed verbatim at L289). For a scope-of-v0.1 PII threat, that's
acceptable — those values come from the user's own env.

## Defence walkthrough — WITHOUT OIDC publishing in the chain

If the user installs an `0.x.y` build that pre-dates the
`expectedBundleSha` pin (or the field is the placeholder
`sha256-PENDING-FIRST-RELEASE`), `expectedBundleSha()` returns `null`
because the placeholder fails `HEX64.test()` (L109).

The CLI then **falls back to the network sidecar** (L337–344):

```
shaText = fetch("<url>.sha256")
expectedSha = first hex token from shaText
```

This is a TOFU (trust-on-first-use) hash. If the attacker controls the
`.tar.gz` AND the `.sha256` sidecar (which they will if they own R2 or
the GH Release), the CLI happily verifies the malicious tarball against
the malicious sidecar.

**Worst case here is bounded by `safe-tar.js`** — same path-traversal
defences as above. So a SHA-pin-bypassed attacker still cannot escape
the bundle dir, run code, or overwrite system files. They CAN ship
malicious knowledge cards/recipes that mislead an LLM agent
(prompt-injection style attack), and they CAN ship a bundle that
crashes the CLI parsers.

That bundle would be active until the user runs `vegastack refresh` against
the next legitimate release, at which point the SHA would be
re-checked against whatever the v0.1 chain provides.

**Critical observation:** the v0.1 first-release placeholder
(`sha256-PENDING-FIRST-RELEASE`) means **the very first 0.1.0 install
runs in the weaker TOFU mode**. Once `scripts/tag-release.js` runs
on the first real release, `package.json#expectedBundleSha` flips to a
real hex value and the strong path engages from v0.1.1 onward.

## What the CLI does NOT verify

This is the central audit finding. The bundle pipeline emits
`.sigstore` files (`build-and-publish.yml` L198–204, L221–224) but:

1. **`npm/install.js` never reads `.sigstore` files** — confirmed by
   `grep -rn "sigstore\|cosign\|fulcio\|rekor" src/ npm/` returning only
   doc comments.
2. **`vegastack doctor --verify-bundle` validates JSON-Schema only**
   (`doctor.ts` L160–211) — it parses each `MANIFEST.json` and checks
   structural keys; it does NOT call `cosign verify-blob` or walk Rekor.
3. **`vegastack doctor --verify-attestations` is documented in `INSTALL.md`
   L51–65 but does not exist in `cli.ts`.** The only flag wired up is
   `--verify-bundle`.

So the entire `cosign sign-blob` + Sigstore Fulcio chain on the bundle
side is **observable but not enforced** in v0.1. Sigstore is
defence-in-depth that an attacker could simply ignore: they replace
the `.sigstore` with garbage and the CLI never notices.

The pinned-SHA path in `package.json` is what actually defends users —
it depends on npm OIDC trusted publishing + npm provenance signing the
`package.json` via the npm tarball's Sigstore bundle. That chain IS
verified by npm itself when the user runs `npm install` (npm 11+ does
this automatically; `npm audit signatures` re-verifies). So the trust
model is:

```
user trusts npm provenance signature on the @vegastack/cli tarball
        ↓
npm provenance signs all files in tarball, including package.json
        ↓
package.json has expectedBundleSha pinned (post-first-release)
        ↓
install.js verifies bundle download against that pin (timing-safe)
        ↓
safe-tar.js refuses any path-traversal / device / abs-symlink entries
        ↓
bundle is data only; no postinstall side-effect from the bundle itself
```

The `.sigstore` files on the bundle side are **available for v0.2+ to
verify**, and a paranoid user can run `cosign verify-blob` manually,
but **v0.1 ships with no in-CLI Sigstore verification**.

## Summary of attacker outcomes

| Capability | With OIDC + post-first-release SHA pin | Without OIDC / first-release placeholder |
|---|---|---|
| MITM `github.com` (TLS-CT-bypass) | denied: pinned SHA wins, sidecar disagreement → warn loudly + use pinned | TOFU bypass: sidecar trusted, malicious bundle installed but path-confined |
| Compromised R2 bucket | denied: pinned SHA wins | TOFU bypass: ditto |
| Compromised GH Release asset | denied: ditto | TOFU bypass: ditto |
| All three + npm publisher token forged | OIDC publishing has no long-lived token to forge — attacker must compromise GitHub OIDC issuer or Sigstore Fulcio (basically nation-state) | same |
| Malicious bundle content (after install) | data-only; agents may be prompt-injected via tampered knowledge cards (out of v0.1 scope) | same |

## Outstanding risks

1. **`expectedBundleSha` placeholder ships in v0.1.0 first install.**
   Users who `npm install -g @vegastack/cli@0.1.0` immediately at GA
   run TOFU. Recommend either (a) cut a no-op `0.1.1` immediately
   after the first cron build so the pin is real, or (b) make
   `install.js` refuse the placeholder (`expectedBundleSha === "sha256-PENDING-FIRST-RELEASE"`)
   and force the user to upgrade. Lower-risk: option (a).

2. **`.sigstore` is published but unverified.** In a `cosign verify-blob`-
   and-Rekor-inclusion-proof world, an attacker with R2 access can
   silently swap the `.sigstore` for a no-op file and the CLI doesn't
   notice. Mitigation: schedule v0.2's `--verify-attestations` work; in
   the meantime call this out in `SECURITY.md` so paranoid users run
   `cosign verify-blob` manually.

3. **Sidecar-fetch on PINNED path is silent on non-200.** L334–336:
   when the corroborating sidecar fetch fails, the install proceeds.
   This is intentional (network is best-effort once we have the pin)
   but means a hostile network admin who returns 404 for `.sha256` URLs
   removes one defence layer. Acceptable trade-off; documented.

4. **`stageAsideExisting` does NOT preserve `bundle.previous`.** L569–
   580 renames to `bundle.stale-<random>` and `rmSync`s after success
   (L385). The `INSTALL.md` "Rollback" troubleshooting at L168
   ("`vegastack update --rollback` or reinstall") and the planning doc R5 §2
   ("vegastack update --rollback") promise rollback-via-`bundle.previous`,
   but no code keeps that artifact. Mid-install crash leaves the dir
   stage-aside until `cleanupTmp` runs; clean install removes it.
   Either implement true `bundle.previous` retention (1 generation, ~12
   MB) or fix the docs to say rollback is "reinstall the prior CLI
   version".

5. **First-release placeholder (`sha256-PENDING-FIRST-RELEASE`) and
   `expectedBundleVersion: "0.0.0"` are committed to main.** Recommend
   adding a `prepublishOnly` guard in `package.json` that rejects these
   exact values:

   ```json
   "prepublishOnly": "node -e \"const p=require('./package.json'); if(p.expectedBundleSha.includes('PENDING')||p.expectedBundleVersion==='0.0.0'){console.error('ERROR: bundle pin is unfilled placeholder; run scripts/tag-release.js first');process.exit(1)}\""
   ```

   Otherwise a future maintainer who runs `npm publish` manually would
   ship the placeholder and silently downgrade every user to TOFU.

## Bottom line

**With the SHA pin in place (post-first-release): strong defence.** The
combination of npm OIDC provenance + pinned hex SHA + path-traversal-
guarded extractor + data-only bundle gives an attacker who controls
R2/GH-Releases nothing more than a denial-of-bundle. A PII-leaking or
RCE-on-extract is not present in this v0.1 design.

**Without the SHA pin (first install of v0.1.0 or `expectedBundleSha`
empty): TOFU-grade.** Path-traversal guard still holds; no privilege
escalation; but the user installs whatever bytes the upstream CDN
serves. Sigstore is unused and so cannot save them. Cut a real-pin
0.1.1 ASAP after the first cron run.
