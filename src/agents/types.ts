// Shared types for per-agent renderers (the AgentRenderer abstraction).
//
// E5 v0.1: the original v0.1 prototype only had `AgentInstaller`, which
// hard-coded copy/symlink behavior per agent. The renderer abstraction adds:
//
//   - one canonical skill source (CanonicalSkill, drawn from
//     `bundle/skill-source/` after generate-skill-from-bundle.ts has run),
//   - a uniform install/uninstall/status surface every agent renderer
//     implements (claude-code, codex, cursor, gemini, continue, aider).
//
// The historical `AgentInstaller` interface is retained as an alias so the
// existing per-agent files compile without churn while we layer the
// renderer-specific logic on top. New code targets `AgentRenderer`.

export type Action = "install" | "uninstall" | "status";
export type Scope = "global" | "project";

export interface InstallContext {
  scope: Scope;
  cwd: string;
  force: boolean; // overwrite without prompting
  dryRun: boolean; // print intent without writing
}

export interface InstallResult {
  agent: string;
  installed: boolean; // after this action, is it installed?
  installedVersion?: string;
  paths: string[]; // files / dirs we created or would create
  notes: string[]; // human-readable explanations
  warnings: string[];
}

/**
 * The canonical skill source the renderer consumes. Today it's read from
 * `bundle/skill-source/` (or, when the bundle isn't on disk, from the
 * `skills/terraform-docs/` dir inside the package as a fallback).
 *
 * Renderers transform this into per-agent shapes:
 *   - Claude Code: SKILL.md + plugin.json + skills dir layout
 *   - Codex CLI: SKILL.md alone (metadata-only scan until matched)
 *   - Cursor: .mdc with description / globs / alwaysApply frontmatter
 *   - Gemini: gemini-extension.json + skills/SKILL.md + commands/tf.toml
 *   - Continue: .continue/config.yaml mcpServers patch
 *   - Aider: .aider.conf.yml read[] + CONVENTIONS.md block
 */
export interface CanonicalSkill {
  /** kebab-case skill id, must match SKILL.md frontmatter `name`. */
  name: string;
  /** Long-form description used as Cursor `description`, Codex preview, etc. */
  description: string;
  /** Full SKILL.md body, including frontmatter; used by Claude / Codex / Gemini. */
  body: string;
  /** Anything else parsed from the frontmatter (license, allowed-tools, ...). */
  metadata: Record<string, unknown>;
  /** allowed-tools list, sliced from frontmatter. Empty array when absent. */
  allowedTools: string[];
}

/**
 * Resolves the canonical skill from disk. Defaults to the package's own
 * `skills/terraform-docs/SKILL.md`; renderers may swap the path in tests.
 */
export interface SkillSourceLoader {
  load(): CanonicalSkill;
}

/**
 * The new uniform abstraction every per-agent file implements.
 * `install` is idempotent (re-running with the same args is a no-op or
 * a clean replace). `uninstall` removes only what we wrote.
 */
export interface AgentRenderer {
  readonly name: string;
  readonly displayName: string;
  /** True iff this renderer can target the requested scope. */
  supportsScope(scope: Scope): boolean;
  install(ctx: InstallContext): Promise<InstallResult>;
  uninstall(ctx: InstallContext): Promise<InstallResult>;
  status(ctx: InstallContext): Promise<InstallResult>;
}

/**
 * Legacy synchronous installer interface kept for the existing
 * `vega skills install` command path. New renderers prefer `AgentRenderer`.
 * Adapter helpers in `lib/agents/adapter.ts` bridge the two.
 */
export interface AgentInstaller {
  readonly name: string;
  readonly displayName: string;
  supportsScope(scope: Scope): boolean;
  status(ctx: InstallContext): InstallResult;
  install(ctx: InstallContext): InstallResult;
  uninstall(ctx: InstallContext): InstallResult;
}
