// Shared types for per-agent renderers.
//
// `AgentRenderer` is the canonical abstraction. Six renderers implement it:
// claude-code, codex, cursor, gemini, continue, aider. Each consumes one
// `CanonicalSkill` (loaded from `skills/vegastack/SKILL.md`) and emits the
// per-host file layout for that agent.
//
// `AgentInstaller` is a legacy synchronous interface still implemented by
// some per-agent classes (claude-code, codex, cursor) for direct use inside
// the agents/ module and a few tests. It is no longer surfaced by the
// `agents/index.ts` registry; new code should target `AgentRenderer`.

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
 * `registry/skill-source/` (or, when the registry template isn't on disk, from the
 * `skills/vegastack/` dir inside the package as a fallback).
 *
 * Renderers transform this into per-agent shapes:
 *   - Claude Code: SKILL.md + plugin.json + skills dir layout
 *   - Codex CLI: SKILL.md alone (metadata-only scan until matched)
 *   - Cursor: .mdc with description / globs / alwaysApply frontmatter
 *   - Gemini: ~/.gemini/extensions/vegastack/{gemini-extension.json, skills/vegastack/SKILL.md, commands/vegastack.toml}
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
 * `skills/vegastack/SKILL.md`; renderers may swap the path in tests.
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
 * `vegastack skills install` command path. New renderers prefer `AgentRenderer`.
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
