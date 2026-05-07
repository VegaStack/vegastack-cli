import { ALL_RENDERER_NAMES, getRenderer } from "../agents/index.js";
import type { InstallResult, Scope } from "../agents/index.js";
import { detectHost, type HostStatus } from "./host-detect.js";
import { log } from "./log.js";

export interface AgentSkillCandidate {
  agent: string;
  displayName: string;
  host: HostStatus;
  supported: boolean;
  status?: InstallResult;
  reason?: string;
}

export interface AgentSkillReconcileResult {
  scope: Scope;
  cwd: string;
  detected: AgentSkillCandidate[];
  missing: AgentSkillCandidate[];
  installed: InstallResult[];
  skipped: AgentSkillCandidate[];
}

export interface AgentSkillReconcileOptions {
  cwd: string;
  scope: Scope;
  force?: boolean;
  dryRun?: boolean;
}

export async function inspectDetectedAgentSkills(
  opts: Pick<AgentSkillReconcileOptions, "cwd" | "scope">,
): Promise<Omit<AgentSkillReconcileResult, "installed">> {
  const detected: AgentSkillCandidate[] = [];
  const missing: AgentSkillCandidate[] = [];
  const skipped: AgentSkillCandidate[] = [];

  for (const agent of ALL_RENDERER_NAMES) {
    const renderer = getRenderer(agent);
    if (!renderer) continue;
    const host = detectHost(agent);
    if (!host.installed) continue;

    const base: AgentSkillCandidate = {
      agent,
      displayName: renderer.displayName,
      host,
      supported: renderer.supportsScope(opts.scope),
    };
    detected.push(base);

    if (!base.supported) {
      skipped.push({
        ...base,
        reason: `${renderer.displayName} does not support ${opts.scope} skill installation`,
      });
      continue;
    }

    let status: InstallResult;
    try {
      status = await renderer.status({
        cwd: opts.cwd,
        scope: opts.scope,
        force: false,
        dryRun: false,
      });
    } catch (e) {
      status = {
        agent,
        installed: false,
        paths: [],
        notes: [],
        warnings: [`status check failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
    const withStatus = { ...base, status };
    if (!status.installed) missing.push(withStatus);
  }

  return { scope: opts.scope, cwd: opts.cwd, detected, missing, skipped };
}

export async function reconcileDetectedAgentSkills(
  opts: AgentSkillReconcileOptions,
): Promise<AgentSkillReconcileResult> {
  const inspected = await inspectDetectedAgentSkills(opts);
  const installed: InstallResult[] = [];

  for (const candidate of inspected.missing) {
    const renderer = getRenderer(candidate.agent);
    if (renderer?.supportsScope(opts.scope) !== true) continue;
    try {
      const result = await renderer.install({
        cwd: opts.cwd,
        scope: opts.scope,
        force: opts.force ?? false,
        dryRun: opts.dryRun ?? false,
      });
      installed.push(result);
    } catch (e) {
      installed.push({
        agent: candidate.agent,
        installed: false,
        paths: candidate.status?.paths ?? [],
        notes: [],
        warnings: [`install failed: ${e instanceof Error ? e.message : String(e)}`],
      });
    }
  }

  return { ...inspected, installed };
}

export function printAgentSkillInspection(
  result: Omit<AgentSkillReconcileResult, "installed">,
): void {
  if (result.detected.length === 0) {
    log.info(`no detected agent hosts for ${result.scope} skill installation`);
    return;
  }

  for (const candidate of result.detected) {
    const status = candidate.status?.installed ? "installed" : "missing";
    const suffix = candidate.supported ? status : "unsupported";
    log.info(`${candidate.displayName}: ${suffix} (${candidate.host.evidence})`);
    if (candidate.reason) log.info(`  ${candidate.reason}`);
    for (const warning of candidate.status?.warnings ?? []) {
      log.warn(`${candidate.displayName}: ${warning}`);
    }
  }
}

export function printAgentSkillReconcile(result: AgentSkillReconcileResult): void {
  printAgentSkillInspection(result);
  for (const installed of result.installed) {
    const renderer = getRenderer(installed.agent);
    const name = renderer?.displayName ?? installed.agent;
    if (installed.installed) log.ok(`${name}: skill installed`);
    for (const note of installed.notes) log.info(`  ${note}`);
    for (const warning of installed.warnings) log.warn(`${name}: ${warning}`);
  }
}
