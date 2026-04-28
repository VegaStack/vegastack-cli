# A3 — cross-platform / cross-agent smoke audit — STATUS

Audit date: 2026-04-28
Wall-clock: ~80 min
Host: macOS Darwin 24.6.0, Node v25.9.0
CLI version under test: `@vegastack/cli` 0.1.0 (commit untagged, all of E1-E8 just merged)

## TL;DR

- **macOS smoke (real exec):** 4 of 6 renderers PASS end-to-end; 1 has an idempotency regression; 1 is unreachable from the CLI surface entirely.
- **MCP server (`apps/mcp/`):** boots cleanly under `wrangler dev`; both `/mcp` (StreamableHTTP) and `/sse` (legacy) handshakes PASS; CORS wide-open; degrades to HTTP 503 cleanly when R2 is unprovisioned.
- **Dashboard (`apps/dashboard/`):** builds + previews cleanly; fixture renders the documented `+47%` lift; theme toggle works; responsive at 3 breakpoints; no console-error indicators in HTML.
- **Cross-OS reasoning:** all production codepaths use `node:path.join` + `os.homedir()`; tar wrapper handles BSD/GNU + Windows-bundled tar.exe; one missing piece (`%LOCALAPPDATA%` Windows fallback per E2 brief) — bundle dir would still resolve under `~/.config/vegastack/bundle` on Windows, just unconventional.
- **Top blocker for v0.1 ship:** punch-list #3 (`--agent all` skips `continue` and `aider`) is real and reproduced. **One-line fix:** `src/commands/skills.ts:3` swap `ALL_AGENT_NAMES` → `ALL_RENDERER_NAMES` and switch `getAgent`/sync calls to `getRenderer`/await. Until that lands, Continue and Aider users have no install path.

## A3.1 — Per-renderer install/uninstall/status matrix (macOS, real exec)

Tmpdir-as-HOME, six fresh roots under `/tmp/a3-tmp/h-{claude,codex,cursor,gemini,continue,aider}` and `/tmp/a3-tmp/proj-*`.

| Renderer | dry-run | install | status | uninstall | re-install idempotent | shape OK | reachable via CLI |
|---|---|---|---|---|---|---|---|
| **claude-code** | PASS | PASS | PASS | PASS | PASS (`already linked to package root`) | PASS | yes (`--agent claude-code --scope global`) |
| **codex** | PASS | PASS | PASS | PASS | PASS for symlink + WARN for AGENTS.md (by design — preserves user-curated file) | PASS | yes (`--agent codex --scope global`) |
| **cursor** | PASS | PASS | PASS | PASS | **FAIL** — re-install warns `destination exists; pass --force` and `runSkills` returns exit 1 (`src/commands/skills.ts:60`); `cursor.ts` does not byte-compare on-disk file before warning, unlike `continue.ts:97-103` which does | PASS (frontmatter has `description`, `globs`, `alwaysApply: false`) | yes (`--agent cursor --scope project`) |
| **gemini** (legacy installer) | PASS | PASS (project) | PASS | PASS | PASS | OK for project-scope (cwd `gemini-extension.json` + `CONTEXT.md`) | yes only for `--scope project`; `--scope global` rejected with `Gemini extension is project-scoped only` |
| **gemini** (renderer, `~/.gemini-extensions/vegastack/`) | PASS | PASS via direct renderer | PASS | PASS (full tree removed) | PASS (`up to date`) | PASS (writes 3 files: `gemini-extension.json`, `skills/terraform-docs/SKILL.md`, `commands/tf.toml`) | **NO** — CLI's `gemini` agent name resolves to legacy installer; modern renderer unreachable |
| **continue** | PASS via direct renderer | PASS | PASS | PASS | PASS (`already up to date`) | PASS (yaml has `name`, `version`, `mcpServers[]` with url/transport/description) | **NO** — `unknown agent(s): continue` |
| **aider** | PASS via direct renderer | PASS | PASS | PASS (idempotent unpatch — leaves `.aider.conf.yml` as 0-byte empty file; conventions file removed cleanly) | PASS (`up to date` + `already referenced`) | PASS (writes `~/.aider/CONVENTIONS.vegastack.md` + patches `~/.aider.conf.yml` `read[]`) | **NO** — `unknown agent(s): aider` |

### Findings (file:line)

1. **Punch-list #3 reproduced** — `src/commands/skills.ts:3,8,77,79,81` only references `ALL_AGENT_NAMES` (4 agents). `ALL_RENDERERS` (6 agents) is exported from `src/agents/index.ts:26-33` but never reached by the CLI. Stderr proof: `vega skills install --agent continue --scope global` → `unknown agent(s): continue. Valid: claude-code, codex, cursor, gemini, all`.

2. **Cursor idempotency regression** — `src/agents/cursor.ts:69-83`. The renderer calls `copyFileWithBackup` which throws `DestinationExistsError` whenever the file exists, regardless of byte equality. Compare to `src/agents/gemini.ts:145-167` (`writeIfChanged`) and `src/agents/continue.ts:97-103` which both compare on-disk content first. Net effect: `vega skills install --agent cursor --scope project` is exit-1 every second run.

3. **Gemini global-scope inaccessible from CLI** — `src/agents/index.ts:21` registers the legacy `gemini` installer (project-only, `src/agents/gemini.ts:183`) under name `gemini`, masking the modern `geminiRenderer` (project + global, `src/agents/gemini.ts:57-143`) under the same name. Users on the `--scope global` happy path get a confusing "project-scoped only" warning instead of the modern `~/.gemini-extensions/vegastack/` install.

4. **Codex install path** — `~/.agents/skills/terraform-docs/` (per `src/lib/paths.ts:65`), NOT `~/.codex/skills/...` as the audit brief A3.2 suggested. The shipped path matches the user's October 2025 Codex CLI docs (`~/.agents/skills/`); the brief's expected path is stale. Treat shipped layout as correct.

## A3.2 — SKILL.md / config shape verification per agent

| Agent | Path | Parses | Required fields present | WHEN-NOT clause | Notes |
|---|---|---|---|---|---|
| **Claude Code** | `~/.claude/plugins/terraform-providers-kit/.claude-plugin/plugin.json` | valid JSON | `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `skills`, `commands`, `hooks`, `mcpServers` (`/Users/mk/projects/vegastack-cli/.claude-plugin/plugin.json:1-32`) | yes (in description body) | `$schema` is `hesreallyhim/claude-code-json-schema` (community-maintained) — when Anthropic publishes an official schema URL bump it. `mcpServers` points at `./mcp/mcp.json` which references `https://mcp.vegastack.com/sse` — picks SSE per E5 default (punch-list #2). |
| **Codex** | `~/.agents/skills/terraform-docs/SKILL.md` | YAML frontmatter parses (`name`, `description`, `license`, `compatibility`, `allowed-tools`, `metadata.{homepage, schema_version, bundle_version, providers_count}`) | yes | yes (`Do NOT use for: pure shell / bash / Python questions; non-IaC cloud questions ("what's the cheapest EC2 size?"); CDK / Pulumi / Crossplane (different DSLs); Terraform Cloud workspace administration (separate API).`) | Closes R1. |
| **Cursor** | `<cwd>/.cursor/rules/terraform-providers-kit.mdc` | YAML frontmatter parses | `description` (with WHEN-NOT), `globs: ["**/*.tf", "**/*.tfvars", "**/*.hcl", "**/main.tf", "**/variables.tf", "**/terraform.tfvars"]` (superset of brief's `["**/*.tf","**/*.hcl"]`), `alwaysApply: false` | yes | superset of expected globs is fine — Cursor matches all of them. |
| **Gemini (renderer)** | `~/.gemini-extensions/vegastack/{gemini-extension.json, skills/terraform-docs/SKILL.md, commands/tf.toml}` | all 3 parse | `gemini-extension.json` has `name`, `version`, `description`, `contextFileName: "skills/terraform-docs/SKILL.md"`, `mcpServers.vegastack-tf.{type: "sse", url: "https://mcp.vegastack.com/sse"}`, `excludeTools: []` | yes (in SKILL.md body) | `commands/tf.toml` has `description` + `prompt` template using `{{args}}` — registers `/tf <query>` per Gemini docs format. |
| **Continue** | `~/.continue/mcpServers/vegastack-tf.yaml` | valid YAML | `name`, `version`, `schema: v1`, `mcpServers[0].{name, url, transport: sse, description}` | n/a (MCP config, not skill) | URL `https://mcp.vegastack.com/sse` (default) overridable via `VEGA_MCP_URL` (`src/agents/continue.ts:27`). E5 picked SSE; per punch-list #2 should switch to `/mcp` streamable-http; `apps/mcp/` supports both. |
| **Aider** | `~/.aider/CONVENTIONS.vegastack.md` (~1 KB body) + patched `~/.aider.conf.yml` `read[]` | both append-only / idempotent | conventions body lists every provider; conf gets one new entry per `read[]` | yes | uninstall correctly removes both — leaves `.aider.conf.yml` as 0-byte empty (acceptable; YAML serializer drops empty `read:`). |

## A3.3 — MCP server: `/mcp` and `/sse` parity (real exec)

`cd apps/mcp && npm test` → 19/19 pass (5 files, 190 ms).
`npm run dev` boots wrangler 4.85.0 cleanly on `http://localhost:8787` (port from `wrangler.toml`).

### Smoke results

```
GET  /health   → 503 {ok:false, bundle_reachable:false, provider_count:0, bundle_version:"unknown"}
                  (clean degradation when R2 unprovisioned, per E7 STATUS.md line 86)
GET  /version  → 200 {name:"vegastack-mcp", version:"0.1.0", bundle_version:"unknown", schema_version:1}
GET  /tools    → 200 {tools: ["tf_discover","tf_get_manifest","tf_list_providers","tf_get_knowledge_card","tf_get_recipe"]}

POST /mcp      → 200, Content-Type: text/event-stream
                  Sets `mcp-session-id: <hex>` response header
                  Body: `event: message\ndata: {result:{protocolVersion:"2025-06-18",
                         capabilities:{tools:{listChanged:true}},
                         serverInfo:{name:"vegastack-mcp", version:"0.1.0"}}, jsonrpc:"2.0", id:1}`
                  CORS: Access-Control-Allow-Origin: * (Mcp-Session-Id exposed, GET/POST/OPTIONS allowed)

GET  /sse      → 200, Content-Type: text/event-stream
                  Body: `event: endpoint\ndata: /sse/message?sessionId=<hex>`
                  CORS: same wide-open headers as /mcp
```

### Per-agent transport recommendation (verified against E7 + E5)

| Agent | E5-shipped transport (in renderer output) | E7-supported endpoint | Recommended |
|---|---|---|---|
| Claude Code | `sse` → `https://mcp.vegastack.com/sse` (`.claude-plugin/mcp/mcp.json`) | `/sse` and `/mcp` | `sse` for Claude Desktop (pre-Apr-2026 SSE-only); modern Claude Code releases support StreamableHTTP — README documents both variants |
| Codex | n/a (E5 doesn't write a Codex MCP config; user follows `apps/mcp/README.md` snippet) | `/mcp` (TOML) | `streamable-http` → `/mcp` (E7 README L107-113) |
| Cursor | n/a (E5 ships only `.mdc` rule, no MCP) | `/sse` (Cursor settings) | `sse` per E7 README L117-127 |
| Gemini | `sse` → `https://mcp.vegastack.com/sse` (`gemini-extension.json` mcpServers) | both | `sse` (Gemini extensions current) |
| Continue | `sse` → `https://mcp.vegastack.com/sse` (`~/.continue/mcpServers/vegastack-tf.yaml`) | both | **per punch-list #2 should be `streamable-http` → `/mcp`** (Continue.dev modern client) |
| Aider | n/a (uses CLI, no direct MCP) | via `mcp-remote` proxy → `/sse` | `mcp-remote https://mcp.vegastack.com/sse` (E7 README L150-153) |

**Punch-list #2 finding:** E5 defaulted ALL MCP-aware renderers (`continue.ts:27`, `.claude-plugin/mcp/mcp.json`, `gemini-extension.json`) to the legacy `/sse` endpoint. E7 ships both. For modern clients (Codex CLI, Continue.dev, Cursor's StreamableHTTP path) `/mcp` is the documented preference per Cloudflare's Apr-2026 Remote MCP guide. Recommendation: switch `continue.ts:27` and the Claude Code mcp.json to `/mcp` + `streamable-http`; keep `/sse` for Claude Desktop in the README.

## A3.4 — Dashboard local preview (real exec)

`cd apps/dashboard && npm run build` → 3 prerendered routes (`/`, `/methodology`, `/reports/2026-04-28`) + SSR worker for `/api/latest.json`. Build time 1.4 s.

`npm run preview` boots wrangler dev on `http://localhost:8787` after `astro build`.

### Probes

```
GET  /                       → 200 (29.7 KB HTML)
GET  /methodology  (via 307) → 200 (10.3 KB HTML)
GET  /reports/2026-04-28     → 200 (31 KB HTML, after 307→/)
GET  /api/latest.json        → 200 JSON (lift: 0.47, archetypes[12], ...)
```

- **Fixture renders** — `+47%` appears 4× in homepage HTML; matches E8 STATUS.md line 91 expectation.
- **Theme toggle** — inline pre-paint script in `<head>` reads `localStorage.getItem("vega-theme")` and sets `document.documentElement.dataset.theme` BEFORE first paint (no FOUC). Click handler swaps + persists. Verified in `dist/client/_astro/page.skBku6iY.js` and the inline `<script>` in `Base.astro` output.
- **Responsive** — `dist/client/_astro/Base.DQ4Bd7-r.css` has `@media(min-width:40rem|48rem|64rem)` breakpoints + `prefers-reduced-motion: reduce` + `hover: hover`. Mobile-first per E8 brief.
- **No console-error indicators** — single `throw` reference in HTML is a hand-written instructional sentence in body copy, not actual JS. No `console.error`, no error blocks, no `data-error` markers.
- **Accessibility** — `<html lang="en">`, 5+ `aria-label` / `role=` / `alt=` markers in homepage HTML.
- **Light test** — Lighthouse not run (no Chrome in env); page weight is in spec (30 KB homepage), zero React/Vue runtime, single-file CSS. Should hit 95+ on Performance/A11y/SEO per E8 STATUS.md.
- **og-image.png** — still missing (punch-list #7); `Base.astro` omits the meta tag rather than ship a broken link.

## A3.5 — Cross-OS reasoning (static, no exec)

### Path construction
Every per-agent path goes through `node:path.join`:
- `src/lib/paths.ts:13,18,23,28,59,65,71,76,81,84,98,99,100,112,113,114,121,126,127,134,140,143,146,149,152,155` — exclusively `path.join(...)`.
- `src/agents/{aider,continue,gemini}.ts` — also `path.join` / `path.dirname` only (lines listed in the renderer audit above).
- No literal `/` or `\` in path construction.
- No string concatenation for paths.

### HOME / Windows compatibility
- `src/lib/paths.ts:8` uses `os.homedir()` — Windows-safe (returns `USERPROFILE`).
- `npm/install.js:67,121` uses `process.env.HOME || process.env.USERPROFILE` — Windows-safe but inconsistent with `os.homedir()`. Cosmetic.
- **`%LOCALAPPDATA%` Windows fallback per E2 brief — NOT wired.** Bundle dir on Windows resolves to `%USERPROFILE%\.config\vegastack\bundle` (not idiomatic; Windows convention is `%LOCALAPPDATA%\vegastack`). Won't break installs (the dir works), but `.config` under `$USERPROFILE` is a Linux-ism on Windows. v0.2 polish item; **not a v0.1 blocker**.

### tar wrapper (`npm/safe-tar.js`)
- Shells out to `tar -tvzf` (list) and `tar xzf -C ... --no-same-owner` (extract). All flags accepted by both BSD tar (macOS, FreeBSD, Windows 10 1809+) and GNU tar (Linux). `safe-tar.js:225-229,234-236` explicitly notes the BSD-vs-GNU handling.
- ENOENT message tells Windows users to ensure Win10 1809+ or git-bash bsdtar (`safe-tar.js:233-236`).
- The single-pass `extractPath` regex (`safe-tar.js:153`) is BSD/GNU-format-agnostic. Edge case: filenames with 4-digit numbers AFTER the date column would mis-parse; production bundle is curated so should not hit this.
- Synthetic-entry skip list covers Pax / mtree / xattr headers (`safe-tar.js:64-74`) — both BSD and GNU emit these.

### `npm/install.js` cross-OS posture
- `mkdtempSync(path.join(tmpdir(), ...))` — Windows-safe.
- `renameSync` for atomic version swap — works cross-volume on same FS; `stageAsideExisting` falls back to `rmSync` on cross-device EXDEV (`install.js:570-580`). Solid.
- Lockfile via `proper-lockfile` — works on Windows (no flock dependency).
- Proxy via `undici.ProxyAgent` — bundled with Node 18+; cross-OS.

### WSL-specific notes (static)
- WSL is Linux semantics under the hood; all paths in `src/lib/paths.ts` map to `/home/<user>/...` correctly. No issues.
- WSL users running `vega skills install --agent claude-code` will get a symlink at `/home/<user>/.claude/plugins/terraform-providers-kit` → the `/mnt/c/...` package (if installed there); cross-FS symlinks work in WSL.

### Known cross-OS gaps
1. **`%LOCALAPPDATA%` not used on Windows** — installs to `~/.config/vegastack/bundle`. Ugly but functional.
2. **`pkgRoot()` walk-up fallback** (`src/lib/paths.ts:35-50`) — if `process.argv[1]` isn't inside the npm install tree, returns `/tmp` (or `C:\` equivalent) and gemini renderer crashes with `ENOENT: /tmp/gemini-extension.json`. Real-world impact: zero — `vega` bin is always inside the npm install. Test/dev impact: occasional. Could be hardened with `import.meta.url`.

## Top issues that should block (or not block) v0.1 ship

### MUST-FIX (block v0.1)

1. **Punch-list #3 — `src/commands/skills.ts:3,8,77,79,81`** — Continue and Aider unreachable from CLI. Aider users get NO install path other than direct renderer invocation, which no documentation describes. Trivial fix; without it the 6-renderer story is a lie. **Estimated 5 min: swap `ALL_AGENT_NAMES` → `ALL_RENDERER_NAMES`, swap `getAgent` → `getRenderer`, `await` the result, drop the synchronous `.install` calls.** The legacy 4-agent `ALL_AGENTS` registry can be deleted in a follow-up.

2. **Gemini global-scope masked** — `src/agents/index.ts:21` registers legacy installer under `gemini`. Once #1 is done with the swap to `ALL_RENDERERS`, this resolves automatically (renderer registry has the modern `geminiRenderer`).

### SHOULD-FIX (degrades UX, not a blocker)

3. **Cursor idempotency regression** — `src/agents/cursor.ts:65-84`. Re-installing without `--force` exits non-zero, which breaks any "configure once, re-run safely" automation. **Fix:** mirror `gemini.ts:145-167` `writeIfChanged` (compare on-disk bytes before warning).

4. **Punch-list #2 — MCP transport default** — `src/agents/continue.ts:27` (`DEFAULT_MCP_URL = ".../sse"`), `.claude-plugin/mcp/mcp.json` (`"type": "sse"`). Continue.dev's modern client speaks StreamableHTTP; SSE is deprecated upstream. **Fix:** default to `/mcp` + `streamable-http`. Keep `/sse` documented in `apps/mcp/README.md` for Claude Desktop pre-Apr-2026.

### NICE-TO-HAVE (v0.2 polish)

5. **og-image.png** — punch-list #7. Cosmetic.
6. **Windows `%LOCALAPPDATA%` bundle dir** — works under `~/.config/vegastack` today, just not idiomatic. v0.2 polish.
7. **Codex AGENTS.md re-install warning** — by-design ("never auto-overwrite user instructions"), but the `--force` UX could be smoother. Documentation rather than code.
8. **`pkgRoot()` walk-up** (`src/lib/paths.ts:35-50`) — switch to `import.meta.url` for the dev/test path. No production impact.
9. **Claude Code plugin `$schema`** — points at community schema (`hesreallyhim/claude-code-json-schema`). When Anthropic ships an official URL, swap.

## Test-suite status (closes punch-list #5)

`npm test` → 308/308 pass across 36 files (4.27 s wall-clock). Zero pre-existing failures. **Punch-list #5 is closed.**

`npm run lint` → clean.

`apps/mcp/ npm test` → 19/19 pass (190 ms).

## Verification commands run

```bash
# CLI build
npm run build                            # exit 0
npm test                                 # 308 pass
npm run lint                             # clean

# macOS smoke (per renderer)
HOME=/tmp/a3-tmp/h-claude   node dist/cli.js skills install --agent claude-code --scope global [--dry-run]
HOME=/tmp/a3-tmp/h-codex    node dist/cli.js skills install --agent codex        --scope global [--dry-run]
(cd /tmp/a3-tmp/proj-cursor && HOME=/tmp/a3-tmp/h-cursor node dist/cli.js skills install --agent cursor --scope project)
(cd /tmp/a3-tmp/proj-gemini && HOME=/tmp/a3-tmp/h-gemini node dist/cli.js skills install --agent gemini --scope project)
HOME=/tmp/a3-tmp/h-continue node /Users/mk/projects/vegastack-cli/exec-renderer.mjs install continue global ...   # direct renderer
HOME=/tmp/a3-tmp/h-aider    node /Users/mk/projects/vegastack-cli/exec-renderer.mjs install aider    global ...   # direct renderer
HOME=/tmp/a3-tmp/h-gemini   node /Users/mk/projects/vegastack-cli/exec-renderer.mjs install gemini   global ...   # modern renderer

# MCP smoke
cd apps/mcp && npm run dev &             # boots on :8787
curl -s http://localhost:8787/{health,version,tools}
curl -s -X POST http://localhost:8787/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'
curl -s -N      http://localhost:8787/sse

# Dashboard smoke
cd apps/dashboard && npm run build       # 3 prerendered + SSR worker
cd apps/dashboard && npm run preview &   # wrangler dev on :8787
curl -s http://localhost:8787/{,methodology,reports/2026-04-28,api/latest.json}
```

## Test artifacts

`/tmp/a3-tmp/` — six tmpdir-as-HOME roots (`h-{agent}`) with per-renderer install state. Five project-scope roots (`proj-{agent}`). Audit harness `exec-renderer.mjs`.

These can be discarded.
