// Resolve canonical filesystem paths for the registry, the user's home, and per-agent install locations.
// Centralized so commands and agent installers stay in sync.

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createHash } from "node:crypto";

export const HOME = os.homedir();

/** Global VegaStack config root. */
export function vegastackConfigRoot(): string {
  if (process.env.VEGASTACK_CONFIG_DIR) return process.env.VEGASTACK_CONFIG_DIR;
  return path.join(HOME, ".vegastack");
}

/** Global machine-level VegaStack setup config. */
export function globalConfigPath(): string {
  return path.join(vegastackConfigRoot(), "config.json");
}

/** Global cache for lightweight command metadata and transient planner state. */
export function globalCacheRoot(): string {
  return path.join(vegastackConfigRoot(), "cache");
}

/** Global logs directory. */
export function globalLogsRoot(): string {
  return path.join(vegastackConfigRoot(), "logs");
}

/** Global cache root for reusable VegaStack Registry entries. */
export function registryCacheRoot(): string {
  if (process.env.VEGASTACK_REGISTRY_DIR) return process.env.VEGASTACK_REGISTRY_DIR;
  return path.join(vegastackConfigRoot(), "registry");
}

/** Global cache root for external tools managed by VegaStack. */
export function toolsCacheRoot(): string {
  if (process.env.VEGASTACK_TOOLS_DIR) return process.env.VEGASTACK_TOOLS_DIR;
  return path.join(vegastackConfigRoot(), "tools");
}

/** Shared stable agent instructions. Project files point here instead of duplicating them. */
export function sharedInstructionsDir(): string {
  return path.join(vegastackConfigRoot(), "instructions");
}

/** Directory for one installed Gitleaks version. */
export function gitleaksToolDir(version: string): string {
  return path.join(toolsCacheRoot(), "gitleaks", version);
}

/** Metadata file for the active Gitleaks install. */
export function gitleaksMetadataPath(): string {
  return path.join(toolsCacheRoot(), "gitleaks", "current.json");
}

/** Directory for one installed managed tool version. */
export function managedToolDir(tool: string, version: string): string {
  return path.join(toolsCacheRoot(), tool, version);
}

/** Metadata file for the active managed tool install. */
export function managedToolMetadataPath(tool: string): string {
  return path.join(toolsCacheRoot(), tool, "current.json");
}

/** Cache root for scanner databases and policies. */
export function scanCacheRoot(): string {
  return path.join(vegastackConfigRoot(), "scan");
}

export function trivyCacheDir(): string {
  return path.join(scanCacheRoot(), "trivy");
}

export function osvCacheDir(): string {
  return path.join(scanCacheRoot(), "osv");
}

/** Directory for one installed ripgrep version. */
export function ripgrepToolDir(version: string): string {
  return path.join(toolsCacheRoot(), "ripgrep", version);
}

/** Metadata file for the active ripgrep install. */
export function ripgrepMetadataPath(): string {
  return path.join(toolsCacheRoot(), "ripgrep", "current.json");
}

/** Directory for one installed cloudflared version. */
export function cloudflaredToolDir(version: string): string {
  return path.join(toolsCacheRoot(), "cloudflared", version);
}

/** Metadata file for the active cloudflared install. */
export function cloudflaredMetadataPath(): string {
  return path.join(toolsCacheRoot(), "cloudflared", "current.json");
}

/** Directory for one installed Registry pack. */
export function registryEntryDir(entryName: string): string {
  return path.join(registryCacheRoot(), entryName);
}

/** Docs root for the Terraform Registry pack's provider-tree reader. */
export function terraformEntryDocsDir(): string {
  return path.join(registryEntryDir("terraform"), "docs");
}

/** Root MANIFEST.json for the Terraform Registry pack docs. */
export function terraformEntryManifestPath(): string {
  return path.join(terraformEntryDocsDir(), "MANIFEST.json");
}

/** Path to the legacy Terraform discovery script, when present in older caches. */
export function terraformEntryDiscoverPython(): string {
  return path.join(terraformEntryDocsDir(), "scripts", "discover.py");
}

/** Compatibility alias for older code paths while callers migrate to registry naming. */
export function packCacheRoot(): string {
  return registryCacheRoot();
}

/** Project-local VegaStack directory. Contains the committed team config. */
export function projectVegaStackDir(cwd: string): string {
  return path.join(cwd, ".vegastack");
}

export function projectConfigPath(cwd: string): string {
  return path.join(projectVegaStackDir(cwd), "vegastack.yml");
}

export function projectDetectionCachePath(cwd: string): string {
  const id = createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 24);
  return path.join(globalCacheRoot(), "projects", `${id}.json`);
}

/** Resolve the package root (where this CLI was installed). */
export function pkgRoot(): string {
  // dist/lib/paths.js → dist/ → package root
  // node:url import.meta.url unavailable here at compile-time without ESM gymnastics; use process.argv[1].
  // Resolve symlinks: when installed via `npm i -g`, the `vegastack` bin is a
  // symlink in the npm prefix's bin/ dir pointing into lib/node_modules/...,
  // and walking up from the symlink path never finds package.json.
  const rawCliPath = process.argv[1] ?? "";
  let cliPath = rawCliPath;
  try {
    if (rawCliPath !== "") cliPath = fs.realpathSync(rawCliPath);
  } catch {
    /* fall back to raw path */
  }
  // walk up until we find package.json with our name
  let cur = path.dirname(cliPath);
  for (let i = 0; i < 6; i++) {
    const pj = path.join(cur, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const json = JSON.parse(fs.readFileSync(pj, "utf8")) as { name?: string };
        if (json.name === "@vegastack/cli") return cur;
      } catch (_e) {
        /* keep walking */
      }
    }
    cur = path.dirname(cur);
  }
  return path.resolve(path.dirname(cliPath), "..");
}

// ── Per-agent install destinations ───────────────────────────────

export type AgentScope = "global" | "project";

/** Claude Code: plugin install dir. Global only — Claude Code doesn't have a project scope for plugins. */
export function claudePluginDir(): string {
  return path.join(HOME, ".claude", "plugins", "vegastack-cli");
}

/** Codex: skill install dir. Global is `~/.agents/skills/`; project is `<cwd>/.agents/skills/`. */
export function codexSkillDir(scope: AgentScope, cwd: string): string {
  const root =
    scope === "global" ? path.join(HOME, ".agents", "skills") : path.join(cwd, ".agents", "skills");
  return path.join(root, "vegastack");
}

/** Codex: AGENTS.md target. Global goes to ~/.codex/AGENTS.md (per Codex docs). Project to cwd/AGENTS.md. */
export function codexAgentsMdPath(scope: AgentScope, cwd: string): string {
  return scope === "global" ? path.join(HOME, ".codex", "AGENTS.md") : path.join(cwd, "AGENTS.md");
}

/** Cursor: rule file destination. Cursor rules are project-scoped; global isn't meaningful. */
export function cursorRulePath(cwd: string): string {
  return path.join(cwd, ".cursor", "rules", "vegastack-cli.mdc");
}

/** Gemini: extension config + context. Project-scoped (Gemini Code Assist reads them from cwd). */
export function geminiExtensionPath(cwd: string): string {
  return path.join(cwd, "gemini-extension.json");
}
export function geminiContextPath(cwd: string): string {
  return path.join(cwd, "CONTEXT.md");
}

/**
 * Gemini CLI extensions (Apr-2026 docs format):
 * `~/.gemini/extensions/<name>/{gemini-extension.json, skills/, commands/}`
 * (global) or `<cwd>/.gemini/extensions/<name>/...` (project).
 *
 * The extension dir contains both the extension config and the per-extension
 * SKILL.md + commands TOML. Project mode is rare — usually this is global.
 */
export function geminiExtensionRoot(scope: AgentScope, cwd: string): string {
  const root =
    scope === "global"
      ? path.join(HOME, ".gemini", "extensions")
      : path.join(cwd, ".gemini", "extensions");
  return path.join(root, "vegastack");
}

// ── Continue (Apr-2026 docs: prefer YAML config) ───────────────────

/** Continue: global mcpServers config.
 *  Continue reads `~/.continue/mcpServers/*.yaml` (or .json) and merges all
 *  servers into the running session. Writing one file per integration
 *  (instead of patching `config.yaml`) is the idempotent path. */
export function continueMcpServerPath(scope: AgentScope, cwd: string): string {
  const root =
    scope === "global"
      ? path.join(HOME, ".continue", "mcpServers")
      : path.join(cwd, ".continue", "mcpServers");
  return path.join(root, "vegastack.yaml");
}

// ── Aider ──────────────────────────────────────────────────────────

/** Aider: home-level YAML config. Aider walks home → repo root → cwd. */
export function aiderConfPath(scope: AgentScope, cwd: string): string {
  return scope === "global"
    ? path.join(HOME, ".aider.conf.yml")
    : path.join(cwd, ".aider.conf.yml");
}
/** Aider: where we drop our CONVENTIONS.md. */
export function aiderConventionsPath(scope: AgentScope, cwd: string): string {
  return scope === "global"
    ? path.join(HOME, ".aider", "CONVENTIONS.vegastack.md")
    : path.join(cwd, "CONVENTIONS.vegastack.md");
}

// ── Skill source (canonical input for renderers) ───────────────────

/** The canonical SKILL.md the renderers read from inside the package. */
export function pkgCanonicalSkillMd(): string {
  return path.join(pkgRoot(), "skills", "vegastack", "SKILL.md");
}

// ── Source-of-truth paths inside the package ─────────────────────

export function pkgSkillDir(): string {
  return path.join(pkgRoot(), "skills", "vegastack");
}
export function pkgAgentsMd(): string {
  return path.join(pkgRoot(), "AGENTS.md");
}
export function pkgClaudePluginManifest(): string {
  return path.join(pkgRoot(), ".claude-plugin", "plugin.json");
}
export function pkgCursorRule(): string {
  return path.join(pkgRoot(), "cursor-rule.mdc");
}
export function pkgGeminiExtension(): string {
  return path.join(pkgRoot(), "gemini-extension.json");
}
export function pkgGeminiContext(): string {
  return path.join(pkgRoot(), "CONTEXT.md");
}
