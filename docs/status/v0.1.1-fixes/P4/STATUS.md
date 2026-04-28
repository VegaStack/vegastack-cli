# P4 — STATUS

**Owner:** P4 (distribution + docs + UX fixes)
**Date:** 2026-04-28
**Scope:** SYNTHESIS.md §7 items #1, #8, #9, #10, #11, #12

---

## Per-fix file:LOC summary

| Fix | File(s) edited / created                                          | Net LOC |
| --- | ----------------------------------------------------------------- | ------- |
| 1   | `package.json` (+10 keywords)                                     | +10     |
| 1   | `README.md` (Install via skill registry block, ~14 lines)         | +14     |
| 8   | `README.md` (`How this differs from hashicorp/agent-skills`, table) | +14   |
| 9   | `docs/distribution/CATALOG-PRS.md` (new, 4 catalog drafts)        | +175    |
| 10  | `AGENTS.md` (Skill router section)                                | +10     |
| 11  | `src/agents/cursor.ts` (byte-compare branch + comment)            | +21     |
| 11  | `tests/agents/cursor.test.ts` (idempotency test)                  | +18     |
| 12  | `src/agents/continue.ts` (DEFAULT_MCP_URL → /mcp, transport tracks suffix) | +9 |
| 12  | `.claude-plugin/mcp/mcp.json` (URL → /mcp, type → http)           | ~3 changed |
| 12  | `tests/agents/continue.test.ts` (modern /mcp default test)        | +21     |
| 12  | `tests/agents/claude-code.test.ts` (mcp.json ships /mcp test)     | +14     |

---

## Test counts

| Metric                | Before | After | Delta |
| --------------------- | ------ | ----- | ----- |
| Test files            | 37     | 37    | 0     |
| Tests                 | (308 baseline per spec) | **329** | +3 new directly from P4 + others already present |

P4 added these tests:

1. `tests/agents/cursor.test.ts` → "re-install with byte-identical content is idempotent (no warning, no --force needed)"
2. `tests/agents/continue.test.ts` → "defaults to the modern /mcp StreamableHTTP transport"
3. `tests/agents/claude-code.test.ts` → "ships an MCP config that defaults to the modern /mcp StreamableHTTP endpoint"

All 329 tests pass. No pre-existing test broke.

---

## Build / typecheck / lint exit codes

| Command           | Exit | Notes |
| ----------------- | ---- | ----- |
| `npm install`     | 0    | up to date, no new deps added |
| `npm run typecheck` | 0  | tsc --noEmit clean |
| `npm run build`   | 0    | tsc -p tsconfig.build.json clean |
| `npm run lint`    | 0    | eslint clean |
| `npm test`        | 0    | 329/329 passed |
| `npm pack --dry-run --json` | 0 | 104 files; top-level entries unchanged: `.claude-plugin AGENTS.md CLAUDE.md CONTEXT.md LICENSE README.md cursor-rule.mdc dist gemini-extension.json npm package.json skills`. No leaks from `docs/`, `tests/`, etc. |

---

## CATALOG-PRS.md

**Path:** `/Users/mk/projects/vegastack-cli/docs/distribution/CATALOG-PRS.md`

| Catalog                                  | Source READMEd? | PR draft     | Status            |
| ---------------------------------------- | --------------- | ------------ | ----------------- |
| `VoltAgent/awesome-agent-skills`         | yes (`gh api`)  | yes          | ready to copy     |
| `heilcheng/awesome-agent-skills`         | yes (`gh api`)  | yes          | ready to copy     |
| `quemsah/awesome-claude-plugins`         | yes (`gh api`)  | n/a — auto-generated top-100, no submission flow | documented; no PR needed |
| `mergisi/awesome-openclaw-agents`        | yes (`gh api`)  | n/a — requires SOUL.md (OpenClaw agent format), not SKILL.md | **needs verification** — recommend defer or author SOUL.md adapter |

All four READMEs were fetched via `gh api repos/<owner>/<repo>/readme --jq '.content' | base64 -d` on 2026-04-28; no fabrication. Format captured per repo and entry text matched to it.

---

## Cross-team coordination notes

- No edits in `src/lib/discover/*` (P1 territory).
- No edits in `bundle/<provider>/*.yaml` (P2 territory).
- No edits in `skills/terraform-docs/SKILL.md` or `skills/terraform-docs/references/*.md` (P3 territory).
- Edits scoped to: `package.json`, `README.md`, `AGENTS.md`, `src/agents/cursor.ts`, `src/agents/continue.ts`, `.claude-plugin/mcp/mcp.json`, `tests/agents/{cursor,continue,claude-code}.test.ts`, `docs/distribution/CATALOG-PRS.md` (new).

---

## Notes / caveats

- The `claude-code.ts` installer doesn't construct the MCP URL itself — it
  links the package directory in. The MCP URL default for Claude Code lives
  in `.claude-plugin/mcp/mcp.json`. Updated that file (URL → `/mcp`, type
  → `http`) and added a regression test in `tests/agents/claude-code.test.ts`
  that asserts the shipped JSON is correct.
- `continue.ts` derives the YAML `transport:` field from the URL suffix
  (`/sse$` ⇒ `sse`, else ⇒ `streamable-http`) so an operator who pins the
  legacy URL via `VEGASTACK_MCP_URL` still gets a working YAML. Doc comment in
  the source explains both transports remain supported by `apps/mcp/`.
- `mergisi/awesome-openclaw-agents` was NOT submitted to. Their catalog
  ships in-repo `SOUL.md` agents (a different artifact from our SKILL.md);
  fabricating a drive-by SOUL.md would be rejected on review. Recommended
  alternative in the CATALOG-PRS.md doc: target `VoltAgent/awesome-openclaw-skills`
  (5,400+ skills, accepts SKILL.md as-is) instead.
- No new dependencies added to `package.json`.
- `package.json#keywords` retained all 10 original entries and added 10 new
  ones (verified via `jq '.keywords' package.json`).
