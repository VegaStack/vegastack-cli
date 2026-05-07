import * as fs from "node:fs";
import { projectConfigPath } from "../paths.js";
import {
  dumpProjectConfig,
  readProjectConfigIfExists,
  writeProjectConfig,
  type VegaStackProjectConfig,
} from "../project-config.js";

export type ScanCategory =
  | "actions"
  | "containers"
  | "dependencies"
  | "iac"
  | "kubernetes"
  | "npm"
  | "secrets";

export type CanonicalScanCategory =
  | "actions"
  | "containers"
  | "dependencies"
  | "iac"
  | "kubernetes"
  | "secrets";

export interface VegaStackScanConfig {
  enabled: boolean;
  profile: "recommended";
  offline: boolean;
  checks: {
    secrets: {
      enabled: boolean;
      engine: "gitleaks";
      history: boolean;
    };
    actions: {
      enabled: boolean;
      engines: ("actionlint" | "zizmor")[];
      zizmor_persona: "regular" | "pedantic" | "auditor";
    };
    dependencies: { enabled: boolean; engines: ("osv-scanner" | "trivy")[]; ecosystems: string[] };
    containers: { enabled: boolean; engine: "trivy"; images: string[] };
    kubernetes: { enabled: boolean; engine: "trivy"; paths: string[] };
    iac: { enabled: boolean; engine: "trivy"; paths: string[] };
  };
  pre_commit: {
    enabled: boolean;
    mode: "none" | "fast-staged" | "custom";
    checks: CanonicalScanCategory[];
  };
  policy: {
    fail_on: ("critical" | "high" | "medium" | "low" | "info")[];
    redact_secrets: boolean;
  };
  tools: Record<
    string,
    {
      repo: string;
      license: string;
      native_config_path?: string;
      ignore_native_config?: boolean;
      extra_args?: string[];
    }
  >;
}

export function defaultScanConfig(
  enabled: Partial<Record<CanonicalScanCategory, boolean>> = {},
): VegaStackScanConfig {
  const isEnabled = (name: CanonicalScanCategory) => enabled[name] ?? name === "secrets";
  return {
    enabled: true,
    profile: "recommended",
    offline: false,
    checks: {
      secrets: { enabled: isEnabled("secrets"), engine: "gitleaks", history: false },
      actions: {
        enabled: isEnabled("actions"),
        engines: ["actionlint", "zizmor"],
        zizmor_persona: "regular",
      },
      dependencies: {
        enabled: isEnabled("dependencies"),
        engines: ["osv-scanner", "trivy"],
        ecosystems: ["npm"],
      },
      containers: { enabled: isEnabled("containers"), engine: "trivy", images: [] },
      kubernetes: {
        enabled: isEnabled("kubernetes"),
        engine: "trivy",
        paths: ["k8s", "deploy", "charts"],
      },
      iac: { enabled: isEnabled("iac"), engine: "trivy", paths: ["."] },
    },
    pre_commit: {
      enabled: false,
      mode: "none",
      checks: ["secrets", "actions"],
    },
    policy: {
      fail_on: ["critical", "high"],
      redact_secrets: true,
    },
    tools: {
      gitleaks: { repo: "https://github.com/gitleaks/gitleaks", license: "MIT" },
      trivy: { repo: "https://github.com/aquasecurity/trivy", license: "Apache-2.0" },
      "osv-scanner": { repo: "https://github.com/google/osv-scanner", license: "Apache-2.0" },
      actionlint: { repo: "https://github.com/rhysd/actionlint", license: "MIT" },
      zizmor: { repo: "https://github.com/zizmorcore/zizmor", license: "MIT" },
    },
  };
}

export function normalizeScanCategory(value: string): CanonicalScanCategory {
  if (value === "npm") return "dependencies";
  if (
    value === "actions" ||
    value === "containers" ||
    value === "dependencies" ||
    value === "iac" ||
    value === "kubernetes" ||
    value === "secrets"
  ) {
    return value;
  }
  throw new Error(`unknown scan category: ${value}`);
}

export function readProjectScanConfig(cwd: string): VegaStackScanConfig {
  const project = readProjectManifest(cwd);
  if (isRecord(project.scan)) return mergeScanConfig(project.scan);
  return defaultScanConfig();
}

export function writeProjectScanConfig(cwd: string, scan: VegaStackScanConfig): boolean {
  const file = projectConfigPath(cwd);
  const project = readProjectConfigIfExists(cwd) ?? { schema_version: 1 };
  const next: VegaStackProjectConfig = {
    ...project,
    schema_version: 1,
    scan: scan as unknown as Record<string, unknown>,
  };
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const after = dumpProjectConfig(next);
  if (before === after) return false;
  writeProjectConfig(cwd, next);
  return true;
}

function mergeScanConfig(raw: Record<string, unknown>): VegaStackScanConfig {
  const base = defaultScanConfig();
  const rawChecks = isRecord(raw.checks) ? raw.checks : {};
  const rawPreCommit = isRecord(raw.pre_commit) ? raw.pre_commit : {};
  const rawPolicy = isRecord(raw.policy) ? raw.policy : {};
  const rawTools = isRecord(raw.tools) ? raw.tools : {};
  return {
    ...base,
    ...raw,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    offline: typeof raw.offline === "boolean" ? raw.offline : base.offline,
    checks: {
      secrets: mergeRecord(base.checks.secrets, rawChecks.secrets),
      actions: mergeRecord(base.checks.actions, rawChecks.actions),
      dependencies: mergeRecord(base.checks.dependencies, rawChecks.dependencies),
      containers: mergeRecord(base.checks.containers, rawChecks.containers),
      kubernetes: mergeRecord(base.checks.kubernetes, rawChecks.kubernetes),
      iac: mergeRecord(base.checks.iac, rawChecks.iac),
    },
    pre_commit: {
      ...base.pre_commit,
      ...filterPreCommit(rawPreCommit),
    },
    policy: {
      ...base.policy,
      ...filterPolicy(rawPolicy),
    },
    tools: mergeTools(base.tools, rawTools),
  };
}

function mergeRecord<T extends Record<string, unknown>>(base: T, raw: unknown): T {
  return {
    ...base,
    ...(isRecord(raw) ? raw : {}),
  };
}

function filterPreCommit(raw: Record<string, unknown>): Partial<VegaStackScanConfig["pre_commit"]> {
  const out: Partial<VegaStackScanConfig["pre_commit"]> = {};
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (raw.mode === "none" || raw.mode === "fast-staged" || raw.mode === "custom")
    out.mode = raw.mode;
  if (Array.isArray(raw.checks)) {
    const checks = raw.checks.filter(isCanonicalScanCategory);
    if (checks.length > 0) out.checks = checks;
  }
  return out;
}

function filterPolicy(raw: Record<string, unknown>): Partial<VegaStackScanConfig["policy"]> {
  const out: Partial<VegaStackScanConfig["policy"]> = {};
  if (Array.isArray(raw.fail_on)) {
    const failOn = raw.fail_on.filter(isPolicySeverity);
    if (failOn.length > 0) out.fail_on = failOn;
  }
  if (typeof raw.redact_secrets === "boolean") out.redact_secrets = raw.redact_secrets;
  return out;
}

function mergeTools(
  base: VegaStackScanConfig["tools"],
  raw: Record<string, unknown>,
): VegaStackScanConfig["tools"] {
  const out: VegaStackScanConfig["tools"] = { ...base };
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const existing = out[name] ?? {};
    const next: Partial<VegaStackScanConfig["tools"][string]> = { ...existing };
    if (typeof value.repo === "string") next.repo = value.repo;
    if (typeof value.license === "string") next.license = value.license;
    if (typeof value.native_config_path === "string")
      next.native_config_path = value.native_config_path;
    if (typeof value.ignore_native_config === "boolean")
      next.ignore_native_config = value.ignore_native_config;
    if (Array.isArray(value.extra_args))
      next.extra_args = value.extra_args.filter((arg): arg is string => typeof arg === "string");
    if (typeof next.repo === "string" && typeof next.license === "string") {
      out[name] = {
        repo: next.repo,
        license: next.license,
        ...(next.native_config_path !== undefined
          ? { native_config_path: next.native_config_path }
          : {}),
        ...(next.ignore_native_config !== undefined
          ? { ignore_native_config: next.ignore_native_config }
          : {}),
        ...(next.extra_args !== undefined ? { extra_args: next.extra_args } : {}),
      };
    }
  }
  return out;
}

function isCanonicalScanCategory(value: unknown): value is CanonicalScanCategory {
  return (
    value === "actions" ||
    value === "containers" ||
    value === "dependencies" ||
    value === "iac" ||
    value === "kubernetes" ||
    value === "secrets"
  );
}

function isPolicySeverity(
  value: unknown,
): value is "critical" | "high" | "medium" | "low" | "info" {
  return (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "info"
  );
}

function readProjectManifest(cwd: string): Record<string, unknown> {
  return (readProjectConfigIfExists(cwd) ?? {}) as unknown as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
