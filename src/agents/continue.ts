// src/agents/continue.ts
//
// Continue.dev renderer.
//
// Strategy: write a single YAML file at
// `~/.continue/mcpServers/vegastack-tf.yaml` (or
// `<cwd>/.continue/mcpServers/vegastack-tf.yaml` for project scope).
// Continue auto-discovers every YAML under that directory and merges the
// `mcpServers` array (docs.continue.dev/customize/deep-dives/mcp, Apr 2026).
//
// We deliberately avoid patching the user's existing `config.yaml` —
// per-integration files in `mcpServers/` are the documented idempotent path
// and let `uninstall` cleanly remove only the file we wrote.
//
// MCP URL: defaults to `https://mcp.vegastack.com/mcp` — the modern
// StreamableHTTP transport (the convergent 2026 default; preferred by
// Cloudflare's docs, the MCP spec, and the Continue/Codex clients shipping
// today). The legacy `/sse` endpoint is still served by `apps/mcp/` for
// pre-Apr-2026 clients (notably Claude Desktop) and can be selected via
// `VEGASTACK_MCP_URL=https://mcp.vegastack.com/sse`.

import * as fs from "node:fs";
import * as path from "node:path";

import { existsOrLink, removeIfExists } from "../lib/fs-utils.js";
import { continueMcpServerPath } from "../lib/paths.js";
import type { AgentRenderer, InstallContext, InstallResult, Scope } from "./types.js";

const DEFAULT_MCP_URL = process.env.VEGASTACK_MCP_URL ?? "https://mcp.vegastack.com/mcp";

function renderYaml(mcpUrl: string): string {
  // We pick the transport based on the URL suffix so that an operator who
  // points VEGASTACK_MCP_URL at the legacy `/sse` endpoint still gets a working
  // YAML. apps/mcp/ ships both transports indefinitely; this is just the
  // renderer's default.
  const transport = /\/sse(?:$|[?#])/.test(mcpUrl) ? "sse" : "streamable-http";
  return [
    "# Managed by @vegastack/cli — do not hand-edit.",
    "# Re-run `vegastack skills install --agent continue` to regenerate.",
    "name: vegastack-tf",
    "version: 0.1.0",
    "schema: v1",
    "mcpServers:",
    "  - name: vegastack-tf",
    `    url: ${mcpUrl}`,
    `    transport: ${transport}`,
    "    description: |",
    "      Vegastack Terraform docs harness. Mirrors `vegastack tf` over MCP for",
    "      Continue. Returns the same four-channel envelope (knowledge,",
    "      recipes, files, concept_aliases_used) the CLI does.",
    "",
  ].join("\n");
}

class ContinueRenderer implements AgentRenderer {
  readonly name = "continue";
  readonly displayName = "Continue.dev";

  supportsScope(_scope: Scope): boolean {
    return true; // both global and project supported
  }

  async status(ctx: InstallContext): Promise<InstallResult> {
    const dest = continueMcpServerPath(ctx.scope, ctx.cwd);
    const present = existsOrLink(dest);
    const result: InstallResult = {
      agent: this.name,
      installed: present,
      paths: [dest],
      notes: present ? ["MCP server config present."] : ["Not installed."],
      warnings: [],
    };
    if (present) {
      try {
        const text = fs.readFileSync(dest, "utf8");
        const m = /^version:\s*(\S+)/m.exec(text);
        if (m?.[1] != null) result.installedVersion = m[1];
      } catch {
        /* swallow — we report present without a version */
      }
    }
    return result;
  }

  async install(ctx: InstallContext): Promise<InstallResult> {
    const dest = continueMcpServerPath(ctx.scope, ctx.cwd);
    const yaml = renderYaml(DEFAULT_MCP_URL);
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [dest],
      notes: [],
      warnings: [],
    };

    if (ctx.dryRun) {
      result.notes.push(`would write ${dest}`);
      result.notes.push(`mcp url: ${DEFAULT_MCP_URL}`);
      return result;
    }

    if (existsOrLink(dest) && !ctx.force) {
      // Idempotency: if file is byte-identical to what we'd write, no-op.
      try {
        const onDisk = fs.readFileSync(dest, "utf8");
        if (onDisk === yaml) {
          result.installed = true;
          result.notes.push(`already up to date: ${dest}`);
          return result;
        }
      } catch {
        /* fall through to overwrite-with-warning */
      }
      result.warnings.push(`destination exists and differs; pass --force to overwrite: ${dest}`);
      return result;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, yaml, "utf8");
    result.installed = true;
    result.notes.push(`wrote ${dest}`);
    result.notes.push("Continue picks the server up automatically on next session.");
    return result;
  }

  async uninstall(ctx: InstallContext): Promise<InstallResult> {
    const dest = continueMcpServerPath(ctx.scope, ctx.cwd);
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [dest],
      notes: [],
      warnings: [],
    };
    if (!existsOrLink(dest)) {
      result.notes.push("nothing to remove (not installed).");
      return result;
    }
    if (ctx.dryRun) {
      result.notes.push(`would remove ${dest}`);
      return result;
    }
    removeIfExists(dest);
    result.notes.push(`removed ${dest}`);
    return result;
  }
}

export const continueRenderer: AgentRenderer = new ContinueRenderer();
