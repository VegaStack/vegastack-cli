// Cursor installer.
// Strategy: copy cursor-rule.mdc to <cwd>/.cursor/rules/terraform-providers-kit.mdc.
// Cursor rules are project-scoped; running with --scope global is rejected
// with a clear message.
//
// Idempotency: before warning "destination exists; pass --force", we byte-
// compare the on-disk content with what we would write. If it's identical
// the install is a no-op — same shape as `writeIfChanged` in gemini.ts.

import * as fs from "node:fs";

import {
  DestinationExistsError,
  copyFileWithBackup,
  existsOrLink,
  removeIfExists,
} from "../lib/fs-utils.js";
import { cursorRulePath, pkgCursorRule } from "../lib/paths.js";
import type {
  AgentInstaller,
  AgentRenderer,
  InstallContext,
  InstallResult,
  Scope,
} from "./types.js";

class CursorInstaller implements AgentInstaller {
  readonly name = "cursor";
  readonly displayName = "Cursor IDE";

  supportsScope(scope: Scope): boolean {
    return scope === "project";
  }

  status(ctx: InstallContext): InstallResult {
    const dest = cursorRulePath(ctx.cwd);
    const exists = existsOrLink(dest);
    return {
      agent: this.name,
      installed: exists,
      paths: [dest],
      notes: exists ? ["Rule installed."] : ["Not installed."],
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
        warnings: [
          "Cursor rules are project-scoped only. Run inside the project dir with --scope project.",
        ],
      };
    }

    const dest = cursorRulePath(ctx.cwd);
    const src = pkgCursorRule();
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [dest],
      notes: [],
      warnings: [],
    };

    if (ctx.dryRun) {
      result.notes.push(`would copy ${src} → ${dest}`);
      return result;
    }

    // Byte-compare first: if the destination is already exactly what we'd
    // write, this is a no-op — no warning, no --force required. Mirrors the
    // `writeIfChanged` shape in src/agents/gemini.ts.
    if (existsOrLink(dest) && !ctx.force) {
      try {
        const onDisk = fs.readFileSync(dest, "utf8");
        const payload = fs.readFileSync(src, "utf8");
        if (onDisk === payload) {
          result.installed = true;
          result.notes.push(`already up to date (byte-identical): ${dest}`);
          return result;
        }
      } catch {
        // Fall through to copyFileWithBackup; it will surface the right error.
      }
    }

    try {
      const backup = copyFileWithBackup(src, dest, { force: ctx.force });
      if (backup) result.notes.push(`backed up existing ${dest} → ${backup}, then wrote ours`);
      else result.notes.push(`copied ${src} → ${dest}`);
      result.installed = true;
      result.notes.push("Cursor will attach the rule to .tf, .tfvars, .hcl files in this project.");
    } catch (e) {
      if (e instanceof DestinationExistsError) {
        result.warnings.push(
          `destination exists; pass --force to overwrite (with backup): ${dest}`,
        );
      } else {
        throw e;
      }
    }
    return result;
  }

  uninstall(ctx: InstallContext): InstallResult {
    const dest = cursorRulePath(ctx.cwd);
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

export const cursor: AgentInstaller = new CursorInstaller();

class CursorRenderer implements AgentRenderer {
  readonly name = "cursor";
  readonly displayName = "Cursor IDE";
  supportsScope(scope: Scope): boolean {
    return cursor.supportsScope(scope);
  }
  async status(ctx: InstallContext): Promise<InstallResult> {
    return cursor.status(ctx);
  }
  async install(ctx: InstallContext): Promise<InstallResult> {
    return cursor.install(ctx);
  }
  async uninstall(ctx: InstallContext): Promise<InstallResult> {
    return cursor.uninstall(ctx);
  }
}
export const cursorRenderer: AgentRenderer = new CursorRenderer();
