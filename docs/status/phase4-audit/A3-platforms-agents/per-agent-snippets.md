# Per-agent integration snippets — verified 2026-04-28

For each agent, the config a user pastes (or the command they run) to enable
vegastack. Each snippet was verified against E5's actual renderer output and
E7's MCP server endpoints + handshakes.

The CLI command path (`vegastack skills install --agent ...`) is the preferred
install for the four legacy agents (Claude Code, Codex, Cursor, Gemini). For
the two new renderers (Continue, Aider) the CLI command path is BROKEN until
punch-list #3 lands — they require a direct renderer invocation OR the manual
config snippet below.

MCP URL convention used here:
- `https://mcp.vegastack.com/mcp` — modern StreamableHTTP endpoint (prefer for new clients)
- `https://mcp.vegastack.com/sse`  — legacy SSE endpoint (Claude Desktop pre-Apr-2026)

Both are served by the same `apps/mcp/` Worker (verified live: `wrangler dev` on :8787 returns 200 on POST `/mcp` initialize and GET `/sse` handshake).

---

## 1. Claude Code

### Recommended (CLI install)

```bash
npm i -g @vegastack/cli
vegastack install                                     # downloads ~12 MB docs bundle
vegastack skills install --agent claude-code          # links the plugin
# inside Claude Code:
/reload-plugins
```

This links the package dir into `~/.claude/plugins/vegastack-cli/` (symlink on macOS/Linux/WSL, recursive copy on Windows non-admin). Subsequent `npm i -g @vegastack/cli@latest` updates the plugin automatically via the symlink.

### What gets written

`~/.claude/plugins/vegastack-cli/.claude-plugin/plugin.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/hesreallyhim/claude-code-json-schema/main/plugin.schema.json",
  "name": "vegastack-cli",
  "version": "0.1.0",
  "description": "Local, deterministic Terraform docs harness for 31 providers ...",
  "skills": "./skills/",
  "commands": "./commands/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./mcp/mcp.json"
}
```

`~/.claude/plugins/vegastack-cli/.claude-plugin/mcp/mcp.json` (E5 default; per punch-list #2 should switch to `/mcp`):

```jsonc
{
  "mcpServers": {
    "vegastack-tf": {
      "type": "sse",
      "url": "https://mcp.vegastack.com/sse"
    }
  }
}
```

### Modern client variant (StreamableHTTP)

For Claude Code releases that support StreamableHTTP, swap mcp.json to:

```jsonc
{
  "mcpServers": {
    "vegastack-tf": {
      "transport": { "type": "streamable-http", "url": "https://mcp.vegastack.com/mcp" }
    }
  }
}
```

---

## 2. Codex CLI

### Recommended (CLI install)

```bash
npm i -g @vegastack/cli
vegastack install
vegastack skills install --agent codex                # global; project also OK
# in your next Codex session, list with:
codex /skills
```

This links `<pkg>/skills/terraform-docs/` into `~/.agents/skills/terraform-docs/` and copies `AGENTS.md` to `~/.codex/AGENTS.md` (with backup if one exists). On `--scope project` it links into `<cwd>/.agents/skills/` and leaves project AGENTS.md alone.

### MCP server config (paste into `~/.codex/config.toml`)

```toml
[mcp_servers.vegastack]
url = "https://mcp.vegastack.com/mcp"
transport = "streamable-http"
```

This is the modern transport — verified live against `apps/mcp/`'s `/mcp` endpoint which returns the documented `protocolVersion: 2025-06-18` initialize response.

---

## 3. Cursor IDE

### Recommended (CLI install — project scope only)

```bash
cd <your-terraform-project>
npm i -g @vegastack/cli                          # only once, system-wide
vegastack install
vegastack skills install --agent cursor --scope project
# Cursor reloads the rule on next save of any .tf/.hcl
```

This drops the rule into `<cwd>/.cursor/rules/vegastack-cli.mdc` with `description`, `globs: ["**/*.tf", "**/*.tfvars", "**/*.hcl", "**/main.tf", "**/variables.tf", "**/terraform.tfvars"]`, and `alwaysApply: false`.

**Known issue (audit finding):** re-running `vegastack skills install --agent cursor --scope project` exits 1 with `destination exists; pass --force` even when the on-disk file is byte-identical to what we'd write. Workaround: pass `--force`. Tracked as A3 SHOULD-FIX #3.

### MCP server config (Cursor settings → MCP)

```jsonc
{
  "mcpServers": {
    "vegastack": {
      "url": "https://mcp.vegastack.com/sse"
    }
  }
}
```

(Cursor's MCP config consumes SSE today; modern Cursor releases also support `streamable-http` → swap the URL to `/mcp` if your build does.)

---

## 4. Gemini CLI / Code Assist

### Recommended (CLI install — currently project-scope only)

```bash
cd <your-terraform-project>
vegastack skills install --agent gemini --scope project
# This writes <cwd>/gemini-extension.json + <cwd>/CONTEXT.md
```

### Modern global install (per Gemini extensions Apr-2026 docs)

The CLI's `--agent gemini` route currently uses the legacy project-only installer; the modern `~/.gemini-extensions/vegastack/` layout requires direct renderer invocation until punch-list #3 lands:

```bash
# After punch-list #3 fix:
vegastack skills install --agent gemini --scope global
# → writes ~/.gemini-extensions/vegastack/{gemini-extension.json,
#                                         skills/terraform-docs/SKILL.md,
#                                         commands/tf.toml}
```

`~/.gemini-extensions/vegastack/gemini-extension.json` (verified output):

```json
{
  "name": "vegastack-terraform",
  "version": "0.1.0",
  "description": "Local, deterministic Terraform docs harness for 31 providers...",
  "contextFileName": "skills/terraform-docs/SKILL.md",
  "mcpServers": {
    "vegastack-tf": {
      "type": "sse",
      "url": "https://mcp.vegastack.com/sse"
    }
  },
  "excludeTools": []
}
```

`~/.gemini-extensions/vegastack/commands/tf.toml` registers `/tf <query>`:

```toml
description = "Search Terraform docs (local, deterministic, no network)."
prompt = """
Run `vegastack tf "{{args}}"` and read the returned JSON envelope on stdout. ...
"""
```

After install, run `gemini extensions list` to confirm and reload the session.

---

## 5. Continue.dev

### CURRENT STATE: CLI install BROKEN (punch-list #3)

`vegastack skills install --agent continue` returns `unknown agent(s): continue. Valid: claude-code, codex, cursor, gemini, all`. Renderer ships in code (`src/agents/continue.ts`) but `src/commands/skills.ts` doesn't reach it. **This blocks all Continue.dev users until #3 lands.**

### Manual config (workaround until #3 fix)

Drop this file at `~/.continue/mcpServers/vegastack-tf.yaml`:

```yaml
# Managed by @vegastack/cli — do not hand-edit.
name: vegastack-tf
version: 0.1.0
schema: v1
mcpServers:
  - name: vegastack-tf
    url: https://mcp.vegastack.com/sse
    transport: sse
    description: |
      Vegastack Terraform docs harness. Mirrors `vegastack tf` over MCP for
      Continue. Returns the same four-channel envelope (knowledge,
      recipes, files, concept_aliases_used) the CLI does.
```

Continue auto-discovers every YAML under `~/.continue/mcpServers/` and merges the `mcpServers` array (per docs.continue.dev/customize/deep-dives/mcp).

### Modern recommendation (post-punch-list #2)

Swap the URL/transport to:

```yaml
mcpServers:
  - name: vegastack-tf
    url: https://mcp.vegastack.com/mcp
    transport: streamable-http
    description: |
      ...
```

Continue.dev's modern client speaks StreamableHTTP. Verified live — `POST /mcp` to the running Worker returns `protocolVersion: 2025-06-18` and `serverInfo: {name: "vegastack-mcp", version: "0.1.0"}`.

---

## 6. Aider

### CURRENT STATE: CLI install BROKEN (punch-list #3)

`vegastack skills install --agent aider` returns `unknown agent(s): aider`. Renderer ships in code (`src/agents/aider.ts`) but isn't reachable from CLI. **Blocks all Aider users until #3 lands.**

### Manual install (workaround)

1. Drop `~/.aider/CONVENTIONS.vegastack.md` with this content (verbatim):

```markdown
# Vegastack Terraform conventions (managed by @vegastack/cli)

When the user asks about Terraform, HCL, or any of the providers covered by
the vegastack docs harness (AWS, Azure, GCP, Cloudflare, Kubernetes, Helm,
Vault, DigitalOcean, GitHub, GitLab, Vercel, Netlify, Datadog, Grafana,
Splunk, PagerDuty, Okta, Auth0, CrowdStrike, 1Password, MongoDB Atlas,
Snowflake, Redis Cloud, ClickHouse, Pinecone, Ansible, and the standard
utility providers), invoke the local CLI before writing HCL:

    vegastack tf "<the user's request, in natural language>"

The response is one JSON envelope with four channels:

  knowledge[]              — date-stamped recent-change cards; read FIRST
  recipes[]                — cross-provider topology scaffolds
  files[]                  — top-K resource docs, with manifest_entry +
                              example_usage inline (no follow-up jq/grep)
  concept_aliases_used[]   — NL phrase → resource mapping (transparency)

Hard rules:

- Never invent resource names or arguments. If it isn't in
  files[].manifest_entry (top-level or .blocks.*), it doesn't exist.
- Never fabricate import IDs. Use manifest_entry.import_syntax.command.
- Respect deprecated:true — tell the user before writing code.
- One provider per vegastack tf call; multi-provider work uses recipes[].
- Cite citations[] (file paths + knowledge-card / recipe IDs) in your reply.

If `vegastack` isn't on PATH, run `npm i -g @vegastack/cli` and `vegastack install`.
```

2. Patch `~/.aider.conf.yml` to load it:

```yaml
read:
  - /Users/<you>/.aider/CONVENTIONS.vegastack.md
```

(Aider treats files in `read[]` as read-only and auto-loads them at session start.)

### MCP for Aider

Aider doesn't yet speak MCP natively. Use the `mcp-remote` proxy to bridge:

```bash
npx mcp-remote https://mcp.vegastack.com/sse
```

Or for the modern transport:

```bash
npx mcp-remote https://mcp.vegastack.com/mcp
```

---

## Summary table

| Agent | CLI install works | Manual snippet works | MCP transport (verified) | Path written |
|---|---|---|---|---|
| Claude Code | yes | yes | `/sse` (default) and `/mcp` (modern variant) | `~/.claude/plugins/vegastack-cli/` |
| Codex | yes | yes | `/mcp` streamable-http | `~/.agents/skills/terraform-docs/` + `~/.codex/AGENTS.md` |
| Cursor | yes (project only; idempotency bug) | yes | `/sse` (Cursor settings) | `<cwd>/.cursor/rules/vegastack-cli.mdc` |
| Gemini | yes (legacy project layout) | yes (modern global layout) | `/sse` | `<cwd>/gemini-extension.json` (legacy) or `~/.gemini-extensions/vegastack/...` (modern) |
| Continue | **NO (punch-list #3)** | yes | `/sse` today; **switch to `/mcp` per punch-list #2** | `~/.continue/mcpServers/vegastack-tf.yaml` |
| Aider | **NO (punch-list #3)** | yes | n/a (mcp-remote proxy) | `~/.aider/CONVENTIONS.vegastack.md` + `~/.aider.conf.yml` |
