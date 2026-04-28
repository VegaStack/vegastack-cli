// `vegastack skills <install|uninstall|status>` — manage per-agent skill registration.
// v0.1: switched from legacy ALL_AGENT_NAMES (4 agents) to ALL_RENDERER_NAMES
// (6 agents: claude-code, codex, cursor, gemini, continue, aider). Without this
// swap, Continue/Aider/modern Gemini have no install path from the CLI
// (audit punch-list #3, A3 must-fix).

import { ALL_RENDERER_NAMES, getRenderer } from "../agents/index.js";
import type { Action, InstallResult, Scope } from "../agents/index.js";
import { log } from "../lib/log.js";

export interface SkillsOptions {
  agents: string[]; // [] means "all"; "all" canonicalized to ALL_RENDERER_NAMES
  scope: Scope;
  force: boolean;
  dryRun: boolean;
  json: boolean;
}

type ResultRow = { agent: string; error: string } | { agent: string; result: InstallResult };

export async function runSkills(action: Action, opts: SkillsOptions): Promise<number> {
  const cwd = process.cwd();
  const targets = resolveAgents(opts.agents);
  if (targets.length === 0) {
    log.err(`no agents to ${action}.`);
    return 1;
  }

  const ctx = { scope: opts.scope, cwd, force: opts.force, dryRun: opts.dryRun };
  const results: ResultRow[] = await Promise.all(
    targets.map(async (name): Promise<ResultRow> => {
      const renderer = getRenderer(name);
      if (!renderer) return { agent: name, error: `unknown agent: ${name}` };
      const result =
        action === "install"
          ? await renderer.install(ctx)
          : action === "uninstall"
            ? await renderer.uninstall(ctx)
            : await renderer.status(ctx);
      return { agent: name, result };
    }),
  );

  if (opts.json) {
    log.json({ action, scope: opts.scope, cwd, results });
    return results.some(
      (r) =>
        "error" in r ||
        (r.result.warnings.length > 0 && !r.result.installed && action === "install"),
    )
      ? 1
      : 0;
  }

  let exitCode = 0;
  for (const r of results) {
    if ("error" in r) {
      log.err(`[${r.agent}] ${r.error}`);
      exitCode = 1;
      continue;
    }
    const renderer = getRenderer(r.agent);
    const display = renderer?.displayName ?? r.agent;
    if (r.result.installed)
      log.ok(`${display}: ${action === "install" ? "installed" : "already installed"}`);
    else if (action === "install") {
      if (r.result.warnings.length > 0) {
        log.warn(`${display}: ${action} skipped`);
        exitCode = 1;
      } else {
        log.info(`${display}: ${r.result.notes[0] ?? "no-op"}`);
      }
    } else {
      log.info(`${display}: ${action} done`);
    }
    for (const n of r.result.notes) process.stderr.write(`    ${n}\n`);
    for (const w of r.result.warnings) process.stderr.write(`    ⚠ ${w}\n`);
  }
  return exitCode;
}

function resolveAgents(input: string[]): string[] {
  const flat = input
    .flatMap((a) => a.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (flat.length === 0 || flat.includes("all")) return [...ALL_RENDERER_NAMES];
  // Validate
  const unknown = flat.filter((name) => !ALL_RENDERER_NAMES.includes(name));
  if (unknown.length > 0) {
    log.err(
      `unknown agent(s): ${unknown.join(", ")}. Valid: ${ALL_RENDERER_NAMES.join(", ")}, all`,
    );
    return [];
  }
  return flat;
}
