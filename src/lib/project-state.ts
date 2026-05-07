import * as fs from "node:fs";
import * as path from "node:path";
import { detectProject, type ProjectDetection } from "./detect.js";
import { projectConfigPath, projectDetectionCachePath } from "./paths.js";
import {
  readProjectConfigIfExists,
  writeProjectConfig,
  type VegaStackProjectConfig,
} from "./project-config.js";

export interface ProjectRefreshPlan {
  cwd: string;
  project_config: string;
  exists: boolean;
  changed: boolean;
  previous?: VegaStackProjectConfig;
  next: VegaStackProjectConfig;
  detection: ProjectDetection;
}

export function buildProjectRefreshPlan(cwd: string): ProjectRefreshPlan {
  const file = projectConfigPath(cwd);
  const previous = readProjectConfigIfExists(cwd);
  const detection = detectProject(cwd);
  const next = mergeProjectDetection(previous ?? { schema_version: 1 }, detection);
  const changed = JSON.stringify(stableComparable(previous)) !== JSON.stringify(stableComparable(next));
  return {
    cwd,
    project_config: file,
    exists: previous !== undefined,
    changed,
    ...(previous ? { previous } : {}),
    next,
    detection,
  };
}

export function writeProjectRefreshPlan(plan: ProjectRefreshPlan): void {
  writeProjectConfig(plan.cwd, plan.next);
}

export function autoRefreshProjectState(
  cwd: string,
  _opts: { quiet?: boolean } = {},
): ProjectRefreshPlan | undefined {
  if (!fs.existsSync(projectConfigPath(cwd))) {
    return undefined;
  }

  let release: (() => void) | undefined;
  try {
    release = tryAcquireProjectRefreshLock(cwd);
    if (!release) return undefined;
    const plan = buildProjectRefreshPlan(cwd);
    writeProjectDetectionCache(cwd, plan.detection);
    return plan;
  } catch {
    // Auto-refresh is a convenience prelude. The command should still proceed
    // using its direct detection/read path rather than fail on a stale write.
    return undefined;
  } finally {
    release?.();
  }
}

export function mergeProjectDetection(
  project: VegaStackProjectConfig,
  detection: ProjectDetection,
): VegaStackProjectConfig {
  const packageManager = detection.stack.package_manager?.name;
  const commands = {
    ...(project.project?.commands ?? {}),
    ...stringCommands(detection.commands),
  };
  const nextProject = {
    ...(project.project ?? {}),
    ...(packageManager ? { package_manager: packageManager } : {}),
    ...(Object.keys(commands).length > 0 ? { commands } : {}),
  };
  return {
    ...project,
    schema_version: 1,
    registry: {
      ...(project.registry ?? {}),
      recommended_entries: detection.registry.recommended_entries,
    },
    ...(Object.keys(nextProject).length > 0 ? { project: nextProject } : {}),
  };
}

function stringCommands(commands: ProjectDetection["commands"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["install", "build", "test", "dev"] as const) {
    const value = commands[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function tryAcquireProjectRefreshLock(cwd: string): (() => void) | undefined {
  const lockPath = `${projectDetectionCachePath(cwd)}.lock`;
  const dir = path.dirname(lockPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    removeStaleLock(lockPath);
    const fd = fs.openSync(lockPath, "wx");
    fs.closeSync(fd);
    return () => {
      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        // best-effort cleanup
      }
    };
  } catch {
    return undefined;
  }
}

function removeStaleLock(lockPath: string): void {
  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs > 30_000) fs.rmSync(lockPath, { force: true });
  } catch {
    // No lock, or cannot stat/remove it. The following openSync decides.
  }
}

function writeProjectDetectionCache(cwd: string, detection: ProjectDetection): void {
  writeJsonAtomic(projectDetectionCachePath(cwd), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    detection,
  });
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function stableComparable(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  if (copy.detection && typeof copy.detection === "object") {
    delete (copy.detection as Record<string, unknown>).generated_at;
  }
  delete copy.generated_at;
  return copy;
}
