# R5 — Shipping, Distribution & Auto-Update Stack (2026)

**Status quo (v0.1):** npm-published @vegastack/cli, postinstall pulls single vegastack-bundle-vX.Y.Z.tar.gz from GitHub Releases, SHA256 sidecar verification, atomic swap, changesets/action → npm publish --provenance. ~12 MB compressed today, 31 providers; target ~100 MB.

## 1. Daily release train on npm
Exemplars: wrangler (4.85.x weekly+), claude-code (2.1.120 multiple/wk), vercel (changesets), pnpm. Two patterns dominate:
- **Changesets + GitHub Actions** (Vercel/Cloudflare/Anthropic) — every PR drops .changeset/*.md; bot opens "Version Packages" PR; merge → npm publish. **What we already run.**
- release-please (Google), semantic-release (legacy, being phased out).

Wrangler explicitly **broke strict semver** in 2025: every non-breaking change ships as patch so users upgrade aggressively. For a knowledge-bundle CLI where *content* changes daily but *code surface* is stable, this is right call.

Versioning: **CalVer for bundle, semver for CLI.** CLI binary stays 0.x.y until APIs stabilize; bundle tagged 2026.04.28 in .bundle-version. Decouples "shipped CLI bug fix" from "providers refreshed today."

Pre-release channels: npm dist-tag gives latest, next, canary. Mirror Claude Code two-channel: latest (today's bundle), stable (~7-day lag, regression-checked).

**RECOMMENDATION:** Keep changesets. Adopt CalVer (YYYY.MM.DD[.N]) for docs bundle, decouple from CLI semver. Two npm dist-tags — latest (daily), stable (weekly post-soak). Wrangler "everything is a patch" rule for CLI.

## 2. Auto-update UX
update-notifier de facto but maintenance mode; alternatives: simple-update-notifier (smaller), roll your own (fetch https://registry.npmjs.org/<pkg>/latest, cache to ~/.config/vegastack/update-cache.json). Anthropic/Vercel/Cloudflare all roll own.

Behaviors observed:
- gh — silent check, single-line nag at bottom of --help and after long commands.
- aws-cli v2 — does NOT self-update; relies on package manager.
- cargo-binstall — replaces itself in place (cargo binstall --self-update).
- claude-code (native) — background self-update on a channel; npm install does not auto-update.

For a knowledge harness, **the bundle is the hot path, not the CLI**. Bimodal:
- **Bundle:** check daily, auto-pull silently if manifest.json digest changed AND user on latest channel. Bundle changes append-only docs — low blast radius.
- **CLI binary:** check weekly, nag once per week with one-line note + opt-out env (NO_UPDATE_NOTIFIER=1, VEGASTACK_NO_UPDATE_NOTIFIER=1, also honor DO_NOT_TRACK=1).
- **vegastack update** — explicit command bumping both, with rollback (keep N-1 bundle in ~/.config/vegastack/bundle.previous, atomic-swap pointer; vegastack update --rollback).

When to nag vs. silent: nag for CLI binary upgrades (require user action, may have CLI-arg changes), silent for bundle refresh (additive, hash-verified, atomic swap safe).

**RECOMMENDATION:** Silent bundle auto-refresh on latest channel (24h check, off-thread, atomic swap, rollback dir). Weekly update-notifier-style nag for npm CLI itself. Honor NO_UPDATE_NOTIFIER, DO_NOT_TRACK, CI, VEGASTACK_OFFLINE=1. Add vegastack update [--rollback] [--channel stable|latest].

## 3. Bundle distribution

| Option | Install time | Update time | Integrity | Cost @ 10k DAU | Offline / firewall |
|---|---|---|---|---|---|
| npm pkg only (no postinstall) | Slowest (100 MB pkg) | Forces full reinstall | npm provenance | Free, but bloats lock files | Works through corp npm mirrors |
| GitHub Releases (current) | ~3-5s for 12 MB, 30s for 100 MB | Same as install | SHA256 + npm provenance | $0 | GH often allow-listed |
| **Cloudflare R2 (versioned keys)** | Fastest globally (Anycast) | Range requests possible | SHA256 + sigstore bundle | Storage $0.015/GB/mo, **egress $0** | Custom domain; some corps block |
| **Content-addressed (/bundles/sha256/<digest>)** | Same as R2 | **Best** — only changed shards refetched | Hash *is* the address | Same as R2 | Same as R2 |

For 100 MB updated daily: full-tarball-on-GH-Releases costs nothing but pushes ~100 MB × DAU update bandwidth. R2 with **content-addressed shards** (split bundle into per-provider tarballs keyed by sha256) lets us re-download only providers that changed today (~3-5 of 31). Daily transfer drops 100 MB → 10-15 MB per active user.

GitHub Releases sneaky downside at scale: rate-limited (60/hr unauth, 5000/hr auth), LFS-style CDN occasionally slow from APAC. R2's free egress + Anycast meaningful win. But: don't lose GH Releases as fallback. Sigstore provenance + corp-firewall friendliness keeps GH Releases as canonical mirror.

**RECOMMENDATION:** Hybrid. Primary CDN = Cloudflare R2 with content-addressed per-provider shards (bundles/<calver>/manifest.json listing providers/aws/sha256-<hex>.tar.gz). Mirror full tarball to GitHub Releases for fallback / firewall-restricted. npm package contains only loader + manifest schema, never the bundle itself.

## 4. Integrity / supply chain
2026 enterprise baseline:
1. **npm provenance attestations** (Sigstore-signed, Rekor-logged). Already enabled.
2. **Trusted publishing** (OIDC; no long-lived NPM_TOKEN in GitHub secrets). Live in npm late 2024. We still use NPM_TOKEN — should switch.
3. **Sigstore bundles for tarball itself.** cosign sign-blob --yes vegastack-bundle-*.tar.gz produces .sigstore bundle pairing with .sha256 sidecar. Verifiable offline once Fulcio/Rekor public keys pinned.
4. **SLSA Level 3 build provenance.** actions/attest-build-provenance@v1 generates in-toto statement embedded in Sigstore bundle.
5. **SBOM**: CycloneDX JSON for npm package + separate SBOM enumerating provider versions in bundle. Ship as bundle-sbom.cdx.json.
6. **sha256 pin lists**: keep .sha256 sidecar; for content-addressed mode the digest *is* the URL.
7. **Dependency review**: dependabot already on. Add npm audit signatures to CI.

NOT: in-toto layouts (overkill), GPG (deprecated by Sigstore), homegrown signature schemes.

**RECOMMENDATION:** Keep npm provenance. Switch to OIDC trusted publishing (kill NPM_TOKEN). Add cosign sign-blob + actions/attest-build-provenance for tarball. Ship CycloneDX SBOM. Document vegastack doctor --verify-attestations checking Sigstore bundle + Rekor inclusion proof.

## 5. Cross-OS issues
**Python dependency.** Today discover.py shelled via python3. Three options:
- **Pure Node port** — week of work, removes dep entirely, indexes are MB-scale JSON so V8 handles it. **Best for cross-OS.**
- uv bundling — Astral's uv fast but adds 30 MB Python runtime per install + new dep.
- Pyodide / wasm — way too heavy.

Drop python3 in v0.2.

**Path separators.** Everywhere we touch paths goes through node:path — good. Audit for / literals in JSON manifests: keep platform-agnostic forward-slash internally, resolve to path.join on read.

**ripgrep + jq.** Optional today. Keep optional — vegastack doctor warns. Provide JS fallback (fast-glob + minimal JSONPath helper) so CLI works on stock Windows box.

**Windows long path.** Set \\?\ prefix for paths > 250 chars on Windows; recommend git config --global core.longpaths true in doctor. Bundle dir at ~/.config/vegastack/bundle — add fallback to %LOCALAPPDATA%\vegastack\bundle on Windows.

**SELinux on RHEL.** Bundle dir under ~/.config/ in user_home_t context, fine for read-by-CLI.

**macOS Gatekeeper / notarization.** Only relevant if shipping native binaries. Sticking to Node-based npm sidesteps entirely.

**RECOMMENDATION:** Port discover.py to TypeScript in v0.2 and remove python3 prereq. Keep ripgrep/jq as performance opt-ins with JS fallbacks. Add Windows %LOCALAPPDATA% fallback for bundle dir, long-path-aware. Defer native installers / Gatekeeper notarization.

## 6. Cross-agent install
2026 ecosystem converged on vendor-neutral skill spec (agentskills.io, Anthropic-originated). Confirmed agent paths:

| Agent | Global path | Project path | Format |
|---|---|---|---|
| Claude Code | ~/.claude/plugins/, ~/.claude/skills/ | .claude/skills/ | SKILL.md |
| Codex | ~/.codex/skills/, ~/.agents/skills/ | .agents/skills/ | SKILL.md |
| Cursor | ~/.cursor/rules/ | .cursor/rules/ | .mdc |
| Gemini CLI | ~/.gemini-extensions/ | gemini-extension.json | extension manifest |
| Continue | ~/.continue/ | .continuerc.json | config |
| Aider | ~/.aider.conf.yml + CONVENTIONS.md | CONVENTIONS.md | markdown |
| GitHub Copilot / VS Code | .github/skills/ | same | SKILL.md |
| GitHub gh skill (Apr 2026) | abstracts above into one CLI | — | wrapper |

**Shared-lib pattern.** Bundle is one tar in ~/.config/vegastack/bundle; agents should NOT get copies — they should get **symlinks** (NTFS junctions on Windows) into the bundle. vegastack refresh updates every agent atomically, agent format change becomes per-agent renderer (renderForCursor(), renderForGemini()) reading from canonical bundle and writing right file shape.

**Format-change handling.** Pin source-of-truth to schema-versioned canonical doc (skill.json + SKILL.md). Per-agent renderers translate to current target format. When Cursor changes .mdc syntax, only renderer changes.

**RECOMMENDATION:** Canonical docs in bundle stay vendor-neutral (SKILL.md + skill.json). Per-agent install writes thin wrapper/symlink under each agent's expected path, generated by AgentRenderer interface (one per agent). On vegastack refresh, regenerate all wrappers idempotently. Shadow-track gh skill; add vegastack skills install --gh-shim once gh skill hits 1.0.

## 7. Telemetry / opt-in usage analytics
**Yes, but opt-in only, after explicit prompt on first run.** Signals (no PII):
- CLI version + bundle CalVer
- OS family (darwin/linux/win32) + Node major
- Anonymous install ID (random UUID stored in ~/.config/vegastack/install-id, regenerable)
- Per-query: provider name, query type (lookup/search/recipe), top_score bucket, result_count, latency_ms
- Errors: error code only (never message, never path, never argv)

Opt-in compliance:
- First-run consent prompt with one-screen explainer.
- Honor DO_NOT_TRACK=1, VEGASTACK_TELEMETRY=0, CI=true (auto-opt-out in CI).
- Config at ~/.config/vegastack/telemetry.json with schema {enabled, install_id, endpoint?}.
- vegastack telemetry status|enable|disable|purge.
- EU PostHog hosting (eu.posthog.com) for GDPR; 12-month retention; whitelist not blacklist.
- Public spec page at vegastack.com/telemetry listing every field shipped.

What it tells us: low top_score + zero results = missing provider doc; high latency = bundle layout issue; high error rate for one provider = bad upstream sync.

**RECOMMENDATION:** Opt-in telemetry via PostHog EU, off by default, prompted on first interactive run, machine-suppressed in CI. Ship in v0.3, not v0.2.

## 8. Offline / airgap
Regulated-industry users need: no npm registry, no GitHub egress, no Sigstore Fulcio call.
1. **vegastack-cli-airgap-<calver>.tar.gz** — single tarball: npm pkg + bundle + Sigstore bundle + SBOM + verify.sh (POSIX) + verify.ps1 (Windows).
2. **verify.sh** — pure shell, verifies SHA256, checks Sigstore bundle against pinned Fulcio root, prints OK/FAIL.
3. **vegastack install --offline /path/to/airgap.tar.gz** — extracts + verifies + writes .version, sets VEGASTACK_OFFLINE=1.
4. **Quarterly cadence** for airgap drop (matches typical regulated-industry change windows). Daily train continues for online users.
5. **Verdaccio recipe** in docs for orgs wanting own npm mirror.
6. **Cosign offline verification** docs (cosign verify-blob --insecure-ignore-tlog with pinned key).

**RECOMMENDATION:** Quarterly airgap.tar.gz release (CLI + bundle + Sigstore bundle + verify scripts), downloadable from GH Releases. vegastack install --offline <path> flow. Document Verdaccio mirror recipe. Pin Fulcio public key in CLI for offline cosign verification.

## Reference architecture
```
                      +------------------------------------+
                      |  engg-vegastack-agent-tf-providers |
                      |  (upstream sync, daily cron)       |
                      +----------------+-------------------+
                                       | build + sign
                                       v
                      +------------------------------------+
                      |  GitHub Actions (OIDC, hosted)     |
                      |  - per-provider tar.gz + sha256    |
                      |  - full bundle.tar.gz              |
                      |  - cosign sign-blob -> .sigstore   |
                      |  - SBOM (CycloneDX)                |
                      |  - SLSA in-toto attestation        |
                      +--------+-----------------+---------+
                               |                 |
                +--------------v--+         +----v---------------+
                | Cloudflare R2   |         | GitHub Releases    |
                | (primary CDN)   |         | (fallback mirror,  |
                | cas/sha256/...  |         |  airgap drop)      |
                +--------+--------+         +----------+---------+
                         |                             |
                         +--------------+--------------+
                                        | fetch (R2 first, GH fallback)
                                        v
       +--------------------------------------------------------+
       |  vegastack CLI  (npm: @vegastack/cli, ~200 KB loader)       |
       |  - postinstall -> manifest -> diff vs local            |
       |  - per-shard download (only changed providers)         |
       |  - atomic swap, rollback dir kept                      |
       |  - update-notifier (CLI), silent refresh (bundle)      |
       |  - per-agent renderers (claude/codex/cursor/gemini/..) |
       +--------------------------------------------------------+
                                        |
                          +-------------+-------------+
                          v             v             v
                   ~/.claude/    ~/.cursor/     ~/.codex/   ...
                   (symlinks into ~/.config/vegastack/bundle)
```

## Rollout sequence
**v0.2 (next 4-6 weeks) — fix foundations**
- Drop python3 dep; port discover.py to TS
- Switch to OIDC trusted publishing; remove NPM_TOKEN
- Add cosign sign-blob + actions/attest-build-provenance for bundle tarball
- Split bundle into per-provider tarballs; ship manifest.json with sha256 list
- Stand up R2 bucket; add R2 as primary, GH Releases as fallback
- vegastack update [--rollback] + silent daily bundle refresh on latest channel
- Windows %LOCALAPPDATA% fallback + long-path safety

**v0.3 (following 4 weeks) — polish + observability**
- CalVer bundle versioning, decoupled from CLI semver
- latest and stable dist-tags + per-channel CI gates
- Per-agent renderer interface; symlink-based shared bundle
- Opt-in PostHog EU telemetry with full consent UX
- vegastack doctor --verify-attestations
- Quarterly airgap tarball + verify.sh/verify.ps1
- CycloneDX SBOM for both npm package and bundle

**v1.0 (>=3 months stable on v0.3)**
- Stable CLI semver guarantee (Wrangler-style)
- gh skill integration once that hits 1.0
- Documented Verdaccio mirror recipe + enterprise support tier
- SOC2-ready: telemetry DPA, Sigstore-only signature path, no long-lived secrets
- Public bundle status page (R2 + GH mirror health, latest CalVer, schema_version)
