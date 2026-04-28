# Cross-team coordination punch-list — 2026-04-28

After all 8 Phase-3 execute teams completed, these items were left for the Phase-4 audit teams or for the user to resolve. Listed in rough priority order.

> **Update 2026-04-28 (post-audit):** Items #1, #2, #3 marked 🔴 in this list have all been **resolved** — see `FINAL-VERDICT.md` for the applied fixes. Items #5, #6 (verify-during-audit) confirmed clean by A1+A4. Items #7+ (user-side actions) remain for you to action when provisioning Cloudflare + npmjs.com.

## 🔴 Reconcile-now (block cohesive deploy)

### 1. R2 bucket name mismatch — three teams picked three different names
- E4 (release pipeline): `vegastack-cli-bundles` (in `bundle/docs/RELEASE.md` and `build-and-publish.yml`)
- E7 (MCP server): `vegastack-bundle` (in `apps/mcp/wrangler.toml`)
- E8 (dashboard): `bundles-vegastack-com` (in `apps/dashboard/wrangler.toml`)

**Recommendation:** pick `vegastack-bundles` (R2 disallows dots; matches the user's intended `bundles.vegastack.com` custom domain). Single search-and-replace across the three `wrangler.toml`/workflow files.

### 2. MCP transport convention — `/sse` vs `/mcp`
- E5 defaulted plugin manifests + Continue config to `https://mcp.vegastack.com/sse` (legacy SSE)
- E7 ships both `/sse` (legacy) AND `/mcp` (modern StreamableHTTP)

**Recommendation:** switch E5's defaults to `/mcp` per Cloudflare's current Remote MCP guide. Keep `/sse` as fallback documented in the README for older clients (Claude Desktop pre-Apr 2026 ships SSE only).

### 3. `vegastack skills install --agent all` consumes legacy registry
- E5 shipped the new `ALL_RENDERERS` registry covering all 6 agents (Claude Code, Codex, Cursor, Gemini, Continue, Aider)
- The CLI command path (`src/commands/skills.ts`) still consumes the legacy `ALL_AGENTS` (only 4 agents)

**Recommendation:** one-line swap `ALL_AGENTS` → `ALL_RENDERERS` in `src/commands/skills.ts`. Audit team A4 (code review) verifies the call sites.

### 4. E1↔E2 manifest field gap
- E2's harness (constants.ts) was trimmed by externalizing SUBCAT_KEYWORDS / PRIMARY_RESOURCES / SERVICE_ALIASES — expected to be sourced from per-provider `MANIFEST.json`
- E1's `manifest_builder.py` ships `service_aliases` (via `build_aliases.py`) and `recommended_companions` (via `build_companions.py`), but does NOT yet emit `primary_resources` or `subcat_keywords` per-provider

**Recommendation:** either (a) E1 extends builder to emit `primary_resources` and `subcat_keywords` from the existing constants.ts seed plus per-provider overrides, OR (b) E2 keeps a small in-code fallback table for these two indexes only (E2 already coded defensively for the gap). Pick (a) — single source of truth.

## 🟡 Verify-during-audit (likely fine, just confirm)

### 5. Pre-existing test failures
E6 reported 5 pre-existing failures in `cursor` + `gemini` installer + `install-security`. After E2 updated install-security tests for `proper-lockfile` and E5 refactored the agent installers behind `AgentRenderer`, those failures should be fixed. **A1 verifies by running `npm test` on a clean checkout.**

### 6. `attest-build-provenance` v2 vs v4
E4 pinned v2 per the brief but noted v4.1.0 is current. **User decision** (not audit) — bump to v4 or stay on v2 for stability.

### 7. og-image.png not generated
E8 couldn't generate the dashboard's Open Graph image (no image-gen in subagent env). Either user generates manually or A3 picks it up.

## ⚪ User-side actions (not audit work)

### 8. Configure npmjs.com trusted publisher
Before the first `release.yml` OIDC publish can succeed, the user must manually add `vegastack/vegastack-cli` repo + `release.yml` workflow as the trusted publisher on npmjs.com for `@vegastack/cli`.

### 9. Provision Cloudflare R2 bucket + custom domain
- Create R2 bucket with the canonical name from item #1
- Configure CORS to allow E8's dashboard origin (`evals.vegastack.com`) and E7's MCP origin (`mcp.vegastack.com`)
- Configure custom domain `bundles.vegastack.com`
- Add `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` GitHub repo secrets in BOTH the CLI and bundle repos

### 10. Provision Cloudflare custom domains for the two apps
- `mcp.vegastack.com` → `apps/mcp/` Workers deployment
- `evals.vegastack.com` → `apps/dashboard/` Workers deployment

Both `wrangler.toml` files have the custom-domain block commented out — uncomment and `wrangler deploy` after DNS propagates.

### 11. Optional: `MCP_CACHE` KV namespace
E7 supports an optional KV namespace for warm sharing across Workers isolates. Provision via `wrangler kv namespace create MCP_CACHE` and add the binding ID to `apps/mcp/wrangler.toml`. Not required for v0.1; recommended once traffic >100 RPM.

## ⚙ Audit-phase brief checklist

| Audit team | Items they should verify |
|---|---|
| **A1 eval re-run** | #5 (test suite green); produce real lift number from full 50-prompt run; compare to initial 12-prompt baseline (`docs/planning/01-initial-eval-baseline-2026-04-28.md`) |
| **A2 security review** | #1 (R2 bucket parity); npm postinstall flow with proper-lockfile; cosign signing pipeline; SLSA attestation chain end-to-end |
| **A3 cross-platform / cross-agent smoke** | #2 (MCP transport per agent); #3 (`--agent all` covers 6); per-OS bundle install; verify each renderer writes the right file shape on macOS/Linux/WSL |
| **A4 code review** | #4 (E1/E2 manifest field gap); #5 (E5/E2 fixed pre-existing failures?); typecheck + lint clean across all 8 teams' diffs; no leftover `// TODO` from execute teams |
