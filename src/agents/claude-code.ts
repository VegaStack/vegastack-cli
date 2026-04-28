// Claude Code installer.
// Strategy: link the *package* dir to ~/.claude/plugins/vegastack-cli/.
// The package contains .claude-plugin/plugin.json + skills/ + bin/, which is the
// canonical Claude Code plugin layout. Linking (rather than copying) means the
// plugin updates automatically when the user runs `npm i -g @vegastack/cli@latest`.
//
// On Windows non-admin / non-Dev-Mode users, symlinks fail with EPERM. We fall
// back to a recursive copy (one-time operation) and surface the trade-off in
// the install notes.

import * as fs from "node:fs";
import { existsOrLink, isSymlinkTo, linkOrCopyDir, removeIfExists } from "../lib/fs-utils.js";
import { claudePluginDir, pkgRoot } from "../lib/paths.js";
import type {
  AgentInstaller,
  AgentRenderer,
  InstallContext,
  InstallResult,
  Scope,
} from "./types.js";

class ClaudeCodeInstaller implements AgentInstaller {
  readonly name = "claude-code";
  readonly displayName = "Claude Code";

  supportsScope(scope: Scope): boolean {
    return scope === "global";
  }

  status(_ctx: InstallContext): InstallResult {
    const dest = claudePluginDir();
    const src = pkgRoot();
    const exists = existsOrLink(dest);
    const linked = isSymlinkTo(dest, src);
    return {
      agent: this.name,
      installed: exists,
      paths: [dest],
      notes: exists
        ? [
            linked
              ? "Linked to package root (auto-updates with the CLI)."
              : "Installed as a copy (re-run `vegastack skills install --force` after CLI updates).",
          ]
        : ["Not installed."],
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

    const dest = claudePluginDir();
    const src = pkgRoot();
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [dest],
      notes: [],
      warnings: [],
    };

    if (ctx.dryRun) {
      result.notes.push(`would link ${src} → ${dest} (or copy on Windows non-admin)`);
      return result;
    }

    if (existsOrLink(dest) && !ctx.force) {
      if (isSymlinkTo(dest, src)) {
        result.installed = true;
        result.notes.push(`already linked to package root: ${dest}`);
        return result;
      }
      result.warnings.push(
        `destination exists (not our symlink); pass --force to replace: ${dest}`,
      );
      return result;
    }

    removeIfExists(dest);
    const linkResult = linkOrCopyDir(src, dest);

    result.installed = true;
    if (linkResult.strategy === "symlink") {
      result.notes.push(`linked ${src} → ${dest}`);
    } else {
      result.notes.push(`copied ${src} → ${dest} (symlinks not supported here)`);
      if (process.platform === "win32") {
        result.notes.push(
          "tip: enable Windows Developer Mode (Settings > For Developers) to use a symlink instead — that way CLI updates apply automatically without re-running install.",
        );
      }
    }
    result.notes.push("run `/reload-plugins` inside Claude Code, or restart the CLI.");
    return result;
  }

  uninstall(ctx: InstallContext): InstallResult {
    const dest = claudePluginDir();
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
    fs.rmSync(dest, { recursive: true, force: true });
    result.notes.push(`removed ${dest}`);
    return result;
  }
}

export const claudeCode: AgentInstaller = new ClaudeCodeInstaller();

// AgentRenderer wrapper — same logic, async-shaped for the new abstraction.
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
