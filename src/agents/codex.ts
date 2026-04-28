// Codex installer.
// Strategy: link the package's skills/terraform-docs/ into ~/.agents/skills/
// (or <cwd>/.agents/skills/ for project scope). On Windows non-admin we fall
// back to a recursive copy. Optionally copy AGENTS.md to ~/.codex/AGENTS.md
// for Codex's user-level instructions, with a backup if one already exists.

import {
  DestinationExistsError,
  copyFileWithBackup,
  existsOrLink,
  isSymlinkTo,
  linkOrCopyDir,
  removeIfExists,
} from "../lib/fs-utils.js";
import { codexAgentsMdPath, codexSkillDir, pkgAgentsMd, pkgSkillDir } from "../lib/paths.js";
import type {
  AgentInstaller,
  AgentRenderer,
  InstallContext,
  InstallResult,
  Scope,
} from "./types.js";

class CodexInstaller implements AgentInstaller {
  readonly name = "codex";
  readonly displayName = "Codex CLI";

  supportsScope(_scope: Scope): boolean {
    return true; // both supported
  }

  status(ctx: InstallContext): InstallResult {
    const dest = codexSkillDir(ctx.scope, ctx.cwd);
    const exists = existsOrLink(dest);
    return {
      agent: this.name,
      installed: exists,
      paths: [dest],
      notes: exists ? ["Skill is registered."] : ["Not installed."],
      warnings: [],
    };
  }

  install(ctx: InstallContext): InstallResult {
    const dest = codexSkillDir(ctx.scope, ctx.cwd);
    const src = pkgSkillDir();
    const agentsMdSrc = pkgAgentsMd();
    const agentsMdDst = codexAgentsMdPath(ctx.scope, ctx.cwd);
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [],
      notes: [],
      warnings: [],
    };

    if (ctx.dryRun) {
      result.paths.push(dest, agentsMdDst);
      result.notes.push(`would link ${src} → ${dest} (or copy on Windows non-admin)`);
      result.notes.push(
        ctx.scope === "global"
          ? `would write ${agentsMdDst} (with backup if it exists)`
          : `would leave ${agentsMdDst} alone (project AGENTS.md is hand-curated)`,
      );
      return result;
    }

    // Skill dir
    if (existsOrLink(dest)) {
      if (isSymlinkTo(dest, src)) {
        result.notes.push(`already linked: ${dest}`);
      } else if (!ctx.force) {
        result.warnings.push(`destination exists; pass --force to replace: ${dest}`);
        return result;
      } else {
        removeIfExists(dest);
        const linkResult = linkOrCopyDir(src, dest);
        result.notes.push(
          linkResult.strategy === "symlink"
            ? `relinked ${src} → ${dest}`
            : `recopied ${src} → ${dest} (symlinks not supported here)`,
        );
      }
    } else {
      const linkResult = linkOrCopyDir(src, dest);
      result.notes.push(
        linkResult.strategy === "symlink"
          ? `linked ${src} → ${dest}`
          : `copied ${src} → ${dest} (symlinks not supported here)`,
      );
    }
    result.paths.push(dest);

    // AGENTS.md handling
    if (ctx.scope === "global") {
      try {
        const backup = copyFileWithBackup(agentsMdSrc, agentsMdDst, { force: ctx.force });
        if (backup) {
          result.notes.push(`backed up existing ${agentsMdDst} → ${backup}, then wrote ours`);
        } else {
          result.notes.push(`wrote ${agentsMdDst}`);
        }
      } catch (e) {
        if (e instanceof DestinationExistsError) {
          result.warnings.push(
            `skipping ${agentsMdDst} (exists; pass --force to overwrite with backup).`,
          );
        } else {
          throw e;
        }
      }
      result.paths.push(agentsMdDst);
    } else {
      // Project scope: don't touch project AGENTS.md automatically. They're
      // typically hand-curated and merging is the user's call.
      result.notes.push(
        "project AGENTS.md not modified; copy AGENTS.md from package root manually if you want it.",
      );
    }

    result.installed = true;
    result.notes.push(
      "Codex will pick up the skill on next invocation. List with `codex /skills`.",
    );
    return result;
  }

  uninstall(ctx: InstallContext): InstallResult {
    const dest = codexSkillDir(ctx.scope, ctx.cwd);
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
    result.notes.push("AGENTS.md left in place (we never auto-remove user instructions).");
    return result;
  }
}

export const codex: AgentInstaller = new CodexInstaller();

// AgentRenderer wrapper. Codex's progressive-disclosure scan only reads the
// SKILL.md frontmatter until matched, so the same on-disk layout works under
// the new abstraction.
class CodexRenderer implements AgentRenderer {
  readonly name = "codex";
  readonly displayName = "Codex CLI";
  supportsScope(scope: Scope): boolean {
    return codex.supportsScope(scope);
  }
  async status(ctx: InstallContext): Promise<InstallResult> {
    return codex.status(ctx);
  }
  async install(ctx: InstallContext): Promise<InstallResult> {
    return codex.install(ctx);
  }
  async uninstall(ctx: InstallContext): Promise<InstallResult> {
    return codex.uninstall(ctx);
  }
}
export const codexRenderer: AgentRenderer = new CodexRenderer();
