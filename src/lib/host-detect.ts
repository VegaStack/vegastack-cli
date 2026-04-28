// Detect whether a coding-agent HOST (the agent itself, not our skill) is
// installed on this machine. Vega's renderer.status() answers "is our skill
// registered" — that's a different question from "would the user benefit from
// us registering it." A user can have a skill file at the right path without
// the agent itself ever being installed (e.g. an old test artifact, or a
// renderer that was installed and the agent later uninstalled).
//
// Two signals per agent: binary on $PATH, or the agent's own config dir/file
// existing. Either is sufficient. Most modern agents create a config dir on
// first launch, so the dir-exists check often catches GUI agents that don't
// ship a CLI binary (Cursor, Continue).

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface HostStatus {
  /** Canonical agent name matching the renderer registry. */
  agent: string;
  /** True iff at least one signal hit. */
  installed: boolean;
  /** Human-readable signal: "binary on PATH (claude)", "config dir ~/.claude" etc. */
  evidence: string;
}

const HOME = os.homedir();

/** Returns true if `name` resolves on $PATH. Cross-platform via `which`/`where`. */
export function binaryOnPath(name: string): boolean {
  const cmd = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [name] : ["-v", name];
  const r = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
    shell: process.platform !== "win32",
  });
  if (r.status !== 0) return false;
  return (r.stdout ?? "").trim().length > 0;
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Where Cursor stores user-level config, per platform. */
function cursorConfigDir(): string {
  if (process.platform === "darwin") {
    return path.join(HOME, "Library", "Application Support", "Cursor");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming"), "Cursor");
  }
  return path.join(HOME, ".config", "Cursor");
}

/**
 * Per-agent detection. Returns the first signal that hits so we can show
 * the user *why* we think the host is installed.
 */
export function detectHost(agent: string): HostStatus {
  switch (agent) {
    // Detection rule: prefer the binary-on-PATH signal (definitive).
    // Fall back to checking for a config FILE that the AGENT itself creates
    // on first run — never a dir vegastack might create as a side effect of
    // `vegastack skills install`. Otherwise our installer would create the
    // detection signal (tautological "host installed" forever after install).

    case "claude-code": {
      if (binaryOnPath("claude"))
        return { agent, installed: true, evidence: "binary on PATH (claude)" };
      // Claude Code writes ~/.claude/settings.json on first run. Vega only
      // writes to ~/.claude/plugins/, so settings.json is a non-tautological
      // signal.
      const f = path.join(HOME, ".claude", "settings.json");
      if (fileExists(f)) return { agent, installed: true, evidence: `config file ${f}` };
      return {
        agent,
        installed: false,
        evidence: "no `claude` on PATH and ~/.claude/settings.json not present",
      };
    }
    case "codex": {
      if (binaryOnPath("codex"))
        return { agent, installed: true, evidence: "binary on PATH (codex)" };
      // Vega writes ~/.codex/AGENTS.md, so checking the dir would be a
      // tautology. auth.json is created by `codex login` only.
      const home = process.env.CODEX_HOME ?? path.join(HOME, ".codex");
      const f = path.join(home, "auth.json");
      if (fileExists(f)) return { agent, installed: true, evidence: `auth file ${f}` };
      return {
        agent,
        installed: false,
        evidence: "no `codex` on PATH and ~/.codex/auth.json not present",
      };
    }
    case "cursor": {
      if (binaryOnPath("cursor"))
        return { agent, installed: true, evidence: "binary on PATH (cursor)" };
      // Vega writes to ~/.cursor/rules/, not to the IDE's actual config dir,
      // so the Library/Cursor (mac) etc. dir is non-tautological.
      const dir = cursorConfigDir();
      if (dirExists(dir)) return { agent, installed: true, evidence: `config dir ${dir}` };
      return { agent, installed: false, evidence: `no \`cursor\` on PATH and ${dir} not present` };
    }
    case "gemini": {
      if (binaryOnPath("gemini"))
        return { agent, installed: true, evidence: "binary on PATH (gemini)" };
      // Vega writes ~/.gemini/extensions/, not ~/.gemini/. Gemini CLI itself
      // writes ~/.gemini/settings.json on first launch.
      const home = process.env.GEMINI_CLI_HOME ?? path.join(HOME, ".gemini");
      const f = path.join(home, "settings.json");
      if (fileExists(f)) return { agent, installed: true, evidence: `config file ${f}` };
      return {
        agent,
        installed: false,
        evidence: "no `gemini` on PATH and ~/.gemini/settings.json not present",
      };
    }
    case "continue": {
      // Continue is a VSCode/JetBrains extension; no CLI binary. Vega writes
      // ~/.continue/mcpServers/, which would make the dir-exists check
      // tautological. config.yaml/config.json are created by the extension's
      // own "Open Config" action on first use.
      for (const f of [
        path.join(HOME, ".continue", "config.yaml"),
        path.join(HOME, ".continue", "config.json"),
      ]) {
        if (fileExists(f)) return { agent, installed: true, evidence: `config file ${f}` };
      }
      return {
        agent,
        installed: false,
        evidence: "~/.continue/config.{yaml,json} not present (Continue is an IDE extension)",
      };
    }
    case "aider": {
      if (binaryOnPath("aider"))
        return { agent, installed: true, evidence: "binary on PATH (aider)" };
      // Vega writes ~/.aider/CONVENTIONS.vegastack.md (a different path).
      // .aider.conf.yml is the user's own config file.
      const conf = path.join(HOME, ".aider.conf.yml");
      if (fileExists(conf)) return { agent, installed: true, evidence: `config file ${conf}` };
      return {
        agent,
        installed: false,
        evidence: "no `aider` on PATH and ~/.aider.conf.yml not present",
      };
    }
    default:
      return { agent, installed: false, evidence: "unknown agent" };
  }
}
