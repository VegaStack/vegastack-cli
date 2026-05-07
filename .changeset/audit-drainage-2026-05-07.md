---
"@vegastack/cli": patch
---

Comprehensive audit drainage from the 2026-05-07 production-readiness audit.

**All 27 individual High issues TDD-verified-fixed**, plus ~94 Medium + Low rollup findings resolved across 4 parallel-fix rounds. 0 audit findings open.

**Key user-visible improvements:**
- Cold start `vegastack --help` reduced from ~138 ms → ~80 ms (-42%) via lazy `sigstore` import + lazy command imports in `cli.ts`
- Cross-platform Windows fixes: `vegastack update` self-upgrade now works on Windows (CVE-2024-27980 mitigation via `spawnCmdSync` helper); managed-tool installer uses JS-native `tar` + `yauzl` extractors instead of host `tar` / `unzip` / `Expand-Archive` (also fixes Alpine/musl)
- MCP worker (`apps/mcp`) gains token-bucket rate-limit + opt-in bearer-token auth (`REQUIRE_AUTH=true`) + 4 MiB R2 size cap + 5s CDN AbortController
- Dashboard (`apps/dashboard`) gains CSP/security headers middleware, capped R2 fan-out, KV `v1:` schema-version prefix
- `vegastack scan --output` now validates path containment + atomic-writes the result (closes arbitrary-file-overwrite vector)
- `vegastack preview --command` no longer shell-evaluates user-supplied commands by default
- `VEGASTACK_REGISTRY_URL` requires HTTPS + host allowlist; opt-out warns to stderr instead of silently disabling
- Sigstore signature verification can no longer be silently disabled — `VEGASTACK_REGISTRY_VERIFY=0` now emits a one-time stderr warning per process

**Security hardening:**
- Archive extractors reject symlinks/hardlinks/device-file entries + zip-slip
- Registry installs now lock-protected (mkdir mutex), atomic-write metadata
- All `fetch()` calls have AbortController timeouts and streaming size caps
- Postinstall honors `npm_config_ignore_scripts` defensively
- `chmod 0600` on sensitive global config files

**Dependency updates** addressing GHSA advisories: `@anthropic-ai/sdk` → 0.91.1, `hono` → 4.12.18, `ip-address` → 10.2.0, `commander` → 14.0.3.

**Internal:** GitHub Actions pinned to commit SHAs; new `tests/architecture/` regression-bar suite; tier1/runDoctor/discoverGenericPacks/discover-orchestrator cyclomatic complexity refactored under characterization-test pins (byte-identical output preserved). Test count: 426 → 621 (+45%).

**Audit-skill upgrades:** `/vegastack-audit` and `/vegastack-fix` skills updated with regression-prevention category, mandatory worktrees + repo-relative paths for parallel subagents, already-fixed verification step, post-merge auto-fix step, and cleanup-verification template. Documented in `.claude/skills/vegastack-{audit,fix}/`.

Full report: `audits/audit-1778150875-2026-05-07T10-47-55Z-full.md`.
