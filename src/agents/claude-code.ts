// Claude Code installer.
//
// Strategy: register the package as a local marketplace via `claude plugin
// marketplace add <pkg-root>`, then install via `claude plugin install
// vegastack-cli@vegastack-cli`. Modern Claude Code (2.1+) only fully
// activates plugins registered through a marketplace — symlinking the
// package into ~/.claude/plugins/ makes the plugin counted ("1 plugin")
// but does not load skills, hooks, or MCP servers.
//
// We rely on the `claude` binary being on PATH. If it's not, we refuse and
// tell the user to install Claude Code first; we don't try to hand-edit
// ~/.claude/plugins/installed_plugins.json (the schema is internal and
// changes between versions).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { binaryOnPath } from "../lib/host-detect.js";
import { pkgRoot } from "../lib/paths.js";
import type {
  AgentInstaller,
  AgentRenderer,
  InstallContext,
  InstallResult,
  Scope,
} from "./types.js";

const PLUGIN_ID = "vegastack-cli@vegastack-cli";
const MARKETPLACE_NAME = "vegastack-cli";

function home(): string {
  // Read at call time so tests that override HOME work as expected.
  return process.env.HOME ?? os.homedir();
}

function installedPluginsJson(): string {
  return path.join(home(), ".claude", "plugins", "installed_plugins.json");
}

function claudePluginSymlink(): string {
  return path.join(home(), ".claude", "plugins", "vegastack-cli");
}

function isRegistered(): boolean {
  try {
    const raw = fs.readFileSync(installedPluginsJson(), "utf8");
    const data = JSON.parse(raw) as { plugins?: Record<string, unknown> };
    return Boolean(data.plugins && PLUGIN_ID in data.plugins);
  } catch {
    return false;
  }
}

function runClaude(args: readonly string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync("claude", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr =
      typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "";
    const stdout =
      typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "";
    return { ok: false, output: stderr || stdout || (err.message ?? "") };
  }
}

function removeStaleSymlink(): boolean {
  // Older versions (≤0.1.6) symlinked the package into the plugin dir,
  // which Claude Code 2.1+ counts but doesn't load. Clean it up so the
  // marketplace install isn't shadowed.
  const dest = claudePluginSymlink();
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(dest);
      return true;
    }
  } catch {
    /* not present */
  }
  return false;
}

class ClaudeCodeInstaller implements AgentInstaller {
  readonly name = "claude-code";
  readonly displayName = "Claude Code";

  supportsScope(scope: Scope): boolean {
    return scope === "global";
  }

  status(_ctx: InstallContext): InstallResult {
    const registered = isRegistered();
    return {
      agent: this.name,
      installed: registered,
      paths: [installedPluginsJson()],
      notes: registered
        ? [`Registered in installed_plugins.json as ${PLUGIN_ID}.`]
        : ["Not installed (no marketplace registration)."],
      warnings: [],
    };
  }

  install(ctx: InstallContext): InstallResult {
    if (!this.supportsScope(ctx.scope)) {
      return {
        agent: this.name,
        installed: false,
        paths: [],
        notes: [],
        warnings: [`Claude Code only supports global scope; got ${ctx.scope}.`],
      };
    }

    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [installedPluginsJson()],
      notes: [],
      warnings: [],
    };

    if (!binaryOnPath("claude")) {
      result.warnings.push(
        "Claude Code (`claude`) not found on PATH. Install Claude Code first (https://claude.com/code), then re-run this command.",
      );
      return result;
    }

    const src = pkgRoot();
    const marketplaceJson = path.join(src, ".claude-plugin", "marketplace.json");
    if (!fs.existsSync(marketplaceJson)) {
      result.warnings.push(
        `marketplace.json missing at ${marketplaceJson} — package install may be corrupted.`,
      );
      return result;
    }

    if (ctx.dryRun) {
      result.notes.push(`would run: claude plugin marketplace add ${src}`);
      result.notes.push(`would run: claude plugin install ${PLUGIN_ID}`);
      return result;
    }

    if (removeStaleSymlink()) {
      result.notes.push(`removed stale symlink at ${claudePluginSymlink()} (legacy install)`);
    }

    if (isRegistered() && !ctx.force) {
      result.installed = true;
      result.notes.push(`already registered as ${PLUGIN_ID}.`);
      result.notes.push("re-run with --force to reinstall, or use `claude plugin update`.");
      return result;
    }

    if (ctx.force && isRegistered()) {
      const un = runClaude(["plugin", "uninstall", PLUGIN_ID]);
      if (!un.ok) {
        result.warnings.push(`plugin uninstall (pre-force) reported: ${un.output.trim()}`);
      }
    }

    // Add marketplace. Idempotent in spirit — if already added, swallow the
    // error and continue. The output text varies across `claude` versions.
    const add = runClaude(["plugin", "marketplace", "add", src]);
    if (!add.ok && !/already/i.test(add.output)) {
      result.warnings.push(`marketplace add failed: ${add.output.trim()}`);
      return result;
    }

    const inst = runClaude(["plugin", "install", PLUGIN_ID]);
    if (!inst.ok) {
      result.warnings.push(`plugin install failed: ${inst.output.trim()}`);
      return result;
    }

    if (!isRegistered()) {
      result.warnings.push(
        "claude reported success but installed_plugins.json does not list us — check `claude plugin list`.",
      );
      return result;
    }

    result.installed = true;
    result.notes.push(`registered as ${PLUGIN_ID} (marketplace: ${MARKETPLACE_NAME}).`);
    result.notes.push("run `/reload-plugins` inside Claude Code, or restart the CLI.");
    return result;
  }

  uninstall(ctx: InstallContext): InstallResult {
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [installedPluginsJson()],
      notes: [],
      warnings: [],
    };

    const staleRemoved = removeStaleSymlink();
    const registered = isRegistered();

    if (!registered && !staleRemoved) {
      result.notes.push("nothing to remove (not installed).");
      return result;
    }

    if (ctx.dryRun) {
      if (registered) result.notes.push(`would run: claude plugin uninstall ${PLUGIN_ID}`);
      if (staleRemoved) result.notes.push(`would remove stale symlink at ${claudePluginSymlink()}`);
      return result;
    }

    if (staleRemoved) result.notes.push(`removed stale symlink at ${claudePluginSymlink()}`);

    if (registered) {
      if (!binaryOnPath("claude")) {
        result.warnings.push(
          "Claude Code (`claude`) not found on PATH; cannot uninstall via the registered marketplace path. Run `claude plugin uninstall vegastack-cli@vegastack-cli` from a machine with Claude Code installed.",
        );
        return result;
      }
      const un = runClaude(["plugin", "uninstall", PLUGIN_ID]);
      if (!un.ok) {
        result.warnings.push(`plugin uninstall failed: ${un.output.trim()}`);
        return result;
      }
      result.notes.push(`uninstalled ${PLUGIN_ID}.`);
    }

    return result;
  }
}

export const claudeCode: AgentInstaller = new ClaudeCodeInstaller();

class ClaudeCodeRenderer implements AgentRenderer {
  readonly name = "claude-code";
  readonly displayName = "Claude Code";
  supportsScope(scope: Scope): boolean {
    return claudeCode.supportsScope(scope);
  }
  async status(ctx: InstallContext): Promise<InstallResult> {
    return claudeCode.status(ctx);
  }
  async install(ctx: InstallContext): Promise<InstallResult> {
    return claudeCode.install(ctx);
  }
  async uninstall(ctx: InstallContext): Promise<InstallResult> {
    return claudeCode.uninstall(ctx);
  }
}
export const claudeCodeRenderer: AgentRenderer = new ClaudeCodeRenderer();
