import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { log, printError } from "../lib/log.js";
import { osvCacheDir, scanCacheRoot, trivyCacheDir } from "../lib/paths.js";
import {
  defaultScanConfig,
  normalizeScanCategory,
  readProjectScanConfig,
  writeProjectScanConfig,
  type CanonicalScanCategory,
  type VegaStackScanConfig,
} from "../lib/scan/config.js";
import { detectScanChecks } from "../lib/scan/detect.js";
import {
  ensureScanTool,
  installScanTool,
  readScanToolMetadata,
  resolveScanToolBin,
  runTool,
  scanToolVersion,
  type ScanToolName,
} from "../lib/scan-tools.js";

export interface ScanOptions {
  categories: string[];
  staged: boolean;
  history: boolean;
  image: string[];
  severity?: string;
  format: "text" | "json" | "sarif";
  output?: string;
  offline: boolean;
  installTools: boolean;
}

export interface ScanEnableOptions {
  install: boolean;
  force: boolean;
  hook: boolean;
  json: boolean;
}

export interface ScanFinding {
  check: CanonicalScanCategory;
  tool: ScanToolName;
  severity: "critical" | "high" | "medium" | "low" | "info" | "unknown";
  title: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  rule_id?: string;
  url?: string;
}

export interface ScanReportPayload {
  ok: boolean;
  offline: boolean;
  selected: CanonicalScanCategory[];
  summary: ReturnType<typeof summarize>;
  findings: ScanFinding[];
  tools: { check: CanonicalScanCategory; tool: ScanToolName; status: number }[];
  failures: { check: CanonicalScanCategory; tool: ScanToolName; message: string }[];
}

interface ToolResult {
  check: CanonicalScanCategory;
  tool: ScanToolName;
  status: number;
  stdout: string;
  stderr: string;
  findings: ScanFinding[];
}

const SCAN_TOOL_URLS = {
  gitleaks: "https://github.com/gitleaks/gitleaks",
  trivy: "https://github.com/aquasecurity/trivy",
  "osv-scanner": "https://github.com/google/osv-scanner",
  actionlint: "https://github.com/rhysd/actionlint",
  zizmor: "https://github.com/zizmorcore/zizmor",
} as const;

export async function runScan(opts: ScanOptions): Promise<number> {
  try {
    const cwd = process.cwd();
    const config = readProjectScanConfig(cwd);
    const effectiveOpts = { ...opts, offline: opts.offline || config.offline };
    const selected = selectedCategories(effectiveOpts.categories, config, effectiveOpts);
    const results: ToolResult[] = [];

    for (const category of selected) {
      if (category === "secrets") results.push(await scanSecrets(cwd, config, effectiveOpts));
      if (category === "actions") results.push(...(await scanActions(cwd, config, effectiveOpts)));
      if (category === "dependencies")
        results.push(...(await scanDependencies(cwd, config, effectiveOpts)));
      if (category === "containers")
        results.push(...(await scanContainers(cwd, config, effectiveOpts)));
      if (category === "kubernetes") results.push(await scanKubernetes(cwd, config, effectiveOpts));
      if (category === "iac") results.push(await scanIac(cwd, config, effectiveOpts));
    }

    const payload = buildScanReportPayload(results, config, effectiveOpts.offline, selected);

    const outputPayload = opts.format === "sarif" ? toSarif(payload.findings) : payload;
    if (opts.output) fs.writeFileSync(opts.output, `${JSON.stringify(outputPayload, null, 2)}\n`);
    if (opts.format === "json" || opts.format === "sarif") log.json(outputPayload);
    else printTextReport(payload);
    return payload.ok ? 0 : 1;
  } catch (e) {
    return printError(e);
  }
}

export async function runScanEnable(opts: ScanEnableOptions): Promise<number> {
  try {
    const cwd = process.cwd();
    const detection = detectScanChecks(cwd);
    const config = defaultScanConfig(detection.checks);
    config.pre_commit.enabled = opts.hook;
    config.pre_commit.mode = opts.hook ? "fast-staged" : "none";
    const written: string[] = [];
    if (writeProjectScanConfig(cwd, config)) written.push(".vegastack/vegastack.yml");
    if (opts.hook && installScanPreCommitHook(cwd, opts.force))
      written.push(".git/hooks/pre-commit");
    const tools = opts.install ? await installToolsForConfig(config, opts.force) : {};
    if (opts.json) log.json({ ok: true, written, tools, detection });
    else {
      for (const file of written) log.ok(`wrote ${file}`);
      log.info("VegaStack scan uses Gitleaks, Trivy, OSV-Scanner, actionlint, and zizmor.");
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

export async function runScanDoctor(opts: { json: boolean }): Promise<number> {
  try {
    const config = readProjectScanConfig(process.cwd());
    const tools = scanToolsForConfig(config);
    const checks = tools.map((tool) => {
      const bin = resolveScanToolBin(tool);
      const metadata = readScanToolMetadata(tool);
      return {
        name: tool,
        ok: bin !== null,
        detail: bin
          ? `${scanToolVersion(tool, bin) ?? "version unknown"} at ${bin}`
          : metadata
            ? "installed metadata is stale or unverified; run `vegastack update --force`"
            : "not installed",
        metadata,
        config: scanToolConfigStatus(process.cwd(), config, tool),
      };
    });
    const allChecks: {
      name: string;
      ok: boolean;
      detail: string;
      metadata: unknown;
    }[] = [...checks];
    allChecks.push({
      name: "pre-commit hook",
      ok: fs.existsSync(path.join(process.cwd(), ".git", "hooks", "pre-commit")),
      detail: fs.existsSync(path.join(process.cwd(), ".git", "hooks", "pre-commit"))
        ? ".git/hooks/pre-commit"
        : "not installed",
      metadata: null,
    });
    if (opts.json) log.json({ checks: allChecks });
    else {
      for (const check of allChecks) {
        if (check.ok) log.ok(`${check.name}: ${check.detail}`);
        else log.warn(`${check.name}: ${check.detail}`);
      }
    }
    return allChecks.filter((c) => c.name !== "pre-commit hook").every((c) => c.ok) ? 0 : 1;
  } catch (e) {
    return printError(e);
  }
}

export async function runScanUpdateDb(opts: {
  json: boolean;
  offline: boolean;
  installTools: boolean;
}): Promise<number> {
  try {
    const trivy = await ensureScanTool("trivy", opts);
    const osv = await ensureScanTool("osv-scanner", opts);
    fs.mkdirSync(trivyCacheDir(), { recursive: true });
    fs.mkdirSync(osvCacheDir(), { recursive: true });
    const trivyResult = runTool(
      trivy,
      ["image", "--download-db-only", "--cache-dir", trivyCacheDir()],
      {
        cwd: process.cwd(),
      },
    );
    const osvTmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-osv-db-"));
    let osvResult: ReturnType<typeof runTool>;
    try {
      osvResult = runTool(
        osv,
        [
          "scan",
          "source",
          "--offline-vulnerabilities",
          "--download-offline-databases",
          "--allow-no-lockfiles",
          osvTmp,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: osvCacheDir() },
        },
      );
    } finally {
      fs.rmSync(osvTmp, { recursive: true, force: true });
    }
    const payload = {
      ok: trivyResult.status === 0 && osvResult.status === 0,
      trivy: trivyResult,
      osv: osvResult,
    };
    if (opts.json) log.json(payload);
    else {
      if (trivyResult.status === 0) log.ok("Trivy vulnerability DB updated");
      else log.warn(`Trivy DB update failed: ${(trivyResult.stderr || trivyResult.stdout).trim()}`);
      if (osvResult.status === 0) log.ok("OSV offline DB updated");
      else log.warn(`OSV DB update failed: ${(osvResult.stderr || osvResult.stdout).trim()}`);
    }
    return payload.ok ? 0 : 1;
  } catch (e) {
    return printError(e);
  }
}

export function installScanPreCommitHook(cwd: string, force: boolean): boolean {
  const hookDir = resolveGitHooksDir(cwd);
  if (hookDir === null) {
    log.warn("pre-commit hook skipped: .git directory not found");
    return false;
  }
  fs.mkdirSync(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, "pre-commit");
  const begin = "# vegastack scan:start";
  const end = "# vegastack scan:end";
  const block = `${begin}
vegastack scan --staged
${end}
`;
  let raw = "";
  try {
    raw = fs.readFileSync(hookPath, "utf8");
  } catch {
    raw = "#!/bin/sh\n";
  }
  if (raw.includes(begin)) {
    raw = raw.replace(
      new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`),
      block,
    );
  } else if (raw.trim() !== "#!/bin/sh" && !force) {
    log.warn("pre-commit hook already exists; use --force to append VegaStack scan");
    return false;
  } else {
    raw = `${raw.trimEnd()}\n\n${block}`;
  }
  fs.writeFileSync(hookPath, raw, { mode: 0o755 });
  if (process.platform !== "win32") fs.chmodSync(hookPath, 0o755);
  return true;
}

export function removeScanPreCommitHook(cwd: string): boolean {
  const hookDir = resolveGitHooksDir(cwd);
  if (hookDir === null) return false;
  const hookPath = path.join(hookDir, "pre-commit");
  if (!fs.existsSync(hookPath)) return false;
  const begin = "# vegastack scan:start";
  const end = "# vegastack scan:end";
  const raw = fs.readFileSync(hookPath, "utf8");
  if (!raw.includes(begin)) return false;
  const next = raw.replace(
    new RegExp(`\\n?${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`),
    "\n",
  );
  fs.writeFileSync(hookPath, next.trim() ? `${next.trimEnd()}\n` : "#!/bin/sh\n", { mode: 0o755 });
  return true;
}

async function installToolsForConfig(
  config: VegaStackScanConfig,
  force: boolean,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const tool of scanToolsForConfig(config)) {
    log.step(`installing VegaStack-pinned ${tool} (${SCAN_TOOL_URLS[tool]})`);
    out[tool] = await installScanTool(tool, { force });
  }
  return out;
}

function scanToolsForConfig(config: VegaStackScanConfig): ScanToolName[] {
  const needed = new Set<ScanToolName>();
  if (!config.enabled) return [];
  if (config.checks.secrets.enabled) needed.add("gitleaks");
  if (config.checks.actions.enabled) {
    for (const engine of config.checks.actions.engines) needed.add(engine);
  }
  if (config.checks.dependencies.enabled) {
    for (const engine of config.checks.dependencies.engines) needed.add(engine);
  }
  if (
    config.checks.containers.enabled ||
    config.checks.kubernetes.enabled ||
    config.checks.iac.enabled
  )
    needed.add("trivy");
  return [...needed];
}

export function scanToolsForConfigForTesting(config: VegaStackScanConfig): ScanToolName[] {
  return scanToolsForConfig(config);
}

function selectedCategories(
  categories: string[],
  config: VegaStackScanConfig,
  opts: Pick<ScanOptions, "staged">,
): CanonicalScanCategory[] {
  const requested = categories.length > 0 ? categories.map(normalizeScanCategory) : [];
  const all: CanonicalScanCategory[] = [
    "secrets",
    "actions",
    "dependencies",
    "containers",
    "kubernetes",
    "iac",
  ];
  const enabled = all.filter((category) => config.checks[category].enabled);
  if (requested.length > 0) return [...new Set(requested)];
  if (opts.staged && config.pre_commit.enabled && config.pre_commit.mode !== "none") {
    return [
      ...new Set(config.pre_commit.checks.filter((category) => config.checks[category].enabled)),
    ];
  }
  if (!config.enabled) return [];
  return [...new Set(enabled)];
}

export function selectScanCategoriesForTesting(
  categories: string[],
  config: VegaStackScanConfig,
  opts: Pick<ScanOptions, "staged">,
): CanonicalScanCategory[] {
  return selectedCategories(categories, config, opts);
}

export function buildScanReportPayloadForTesting(
  results: ToolResult[],
  config: VegaStackScanConfig,
  offline: boolean,
  selected: CanonicalScanCategory[],
): ScanReportPayload {
  return buildScanReportPayload(results, config, offline, selected);
}

function buildScanReportPayload(
  results: ToolResult[],
  config: VegaStackScanConfig,
  offline: boolean,
  selected: CanonicalScanCategory[],
): ScanReportPayload {
  const findings = results.flatMap((r) => r.findings);
  const failedTools = results.filter((r) => r.status !== 0 && r.findings.length === 0);
  const blocking = findings.filter((finding) => shouldFail(finding, config));
  return {
    ok: blocking.length === 0 && failedTools.length === 0,
    offline,
    selected,
    summary: summarize(findings, failedTools),
    findings,
    tools: results.map((r) => ({
      check: r.check,
      tool: r.tool,
      status: r.status,
    })),
    failures: failedTools.map((r) => ({
      check: r.check,
      tool: r.tool,
      message: (r.stderr || r.stdout).trim(),
    })),
  };
}

async function scanSecrets(
  cwd: string,
  config: VegaStackScanConfig,
  opts: ScanOptions,
): Promise<ToolResult> {
  const bin = await ensureScanTool("gitleaks", opts);
  const configArgs = gitleaksConfigArgs(cwd, config);
  const extraArgs = toolExtraArgs(config, "gitleaks");
  const reportArgs = ["--report-format", "json", "--report-path", "-"];
  if (opts.staged) {
    const diff = spawnSync("git", ["diff", "--cached"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    const r = runTool(bin, ["stdin", "--redact", ...reportArgs, ...configArgs, ...extraArgs], {
      cwd,
      input: diff.stdout,
    });
    return result("secrets", "gitleaks", r, parseGitleaksFindings(r));
  }
  const args =
    opts.history || config.checks.secrets.history
      ? ["git", "--redact", "--log-opts=--all", ...reportArgs, ...configArgs, ...extraArgs, "."]
      : ["dir", "--redact", ...reportArgs, ...configArgs, ...extraArgs, "."];
  const r = runTool(bin, args, { cwd });
  return result("secrets", "gitleaks", r, parseGitleaksFindings(r));
}

async function scanActions(
  cwd: string,
  config: VegaStackScanConfig,
  opts: ScanOptions,
): Promise<ToolResult[]> {
  const workflowFiles = opts.staged
    ? stagedFiles(cwd).filter(isWorkflowFile)
    : existingWorkflowInputs(cwd);
  if (workflowFiles.length === 0) return [];
  const out: ToolResult[] = [];
  if (config.checks.actions.engines.includes("actionlint")) {
    const actionlint = await ensureScanTool("actionlint", opts);
    const aArgs = [
      ...actionlintConfigArgs(cwd, config),
      "-format",
      "{{range $err := .}}{{json $err}}{{end}}",
      ...toolExtraArgs(config, "actionlint"),
      ...workflowFiles,
    ];
    const a = runTool(actionlint, aArgs, { cwd });
    out.push(result("actions", "actionlint", a, parseActionlintFindings(a)));
  }
  if (config.checks.actions.engines.includes("zizmor")) {
    const zizmor = await ensureScanTool("zizmor", opts);
    const zArgs = [
      "--format=json",
      ...(opts.offline ? ["--offline"] : []),
      ...zizmorConfigArgs(cwd, config),
      ...(config.checks.actions.zizmor_persona !== "regular"
        ? ["--persona", config.checks.actions.zizmor_persona]
        : []),
      ...toolExtraArgs(config, "zizmor"),
      ...workflowFiles,
    ];
    const z = runTool(zizmor, zArgs, {
      cwd,
      env: { ...process.env, ...(opts.offline ? { ZIZMOR_OFFLINE: "1" } : {}) },
    });
    out.push(result("actions", "zizmor", z, parseZizmorFindings(z)));
  }
  return out;
}

async function scanDependencies(
  cwd: string,
  config: VegaStackScanConfig,
  opts: ScanOptions,
): Promise<ToolResult[]> {
  const out: ToolResult[] = [];
  if (config.checks.dependencies.engines.includes("osv-scanner")) {
    const osv = await ensureScanTool("osv-scanner", opts);
    const osvArgs = [
      "scan",
      "source",
      "--format",
      "json",
      "--allow-no-lockfiles",
      ...(opts.offline ? ["--offline-vulnerabilities"] : []),
      ...osvConfigArgs(cwd, config),
      ...toolExtraArgs(config, "osv-scanner"),
      ".",
    ];
    const o = runTool(osv, osvArgs, {
      cwd,
      env: {
        ...process.env,
        ...(opts.offline ? { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: osvCacheDir() } : {}),
      },
    });
    out.push(result("dependencies", "osv-scanner", o, parseOsvFindings(o)));
  }
  if (config.checks.dependencies.engines.includes("trivy")) {
    const trivy = await ensureScanTool("trivy", opts);
    fs.mkdirSync(trivyCacheDir(), { recursive: true });
    const t = runTool(
      trivy,
      [
        ...trivyCommonArgs(cwd, opts, config),
        "fs",
        "--scanners",
        "vuln,license",
        "--format",
        "json",
        ...toolExtraArgs(config, "trivy"),
        ".",
      ],
      {
        cwd,
      },
    );
    out.push(result("dependencies", "trivy", t, parseTrivyFindings("dependencies", t)));
  }
  return out;
}

async function scanContainers(
  cwd: string,
  config: VegaStackScanConfig,
  opts: ScanOptions,
): Promise<ToolResult[]> {
  const trivy = await ensureScanTool("trivy", opts);
  fs.mkdirSync(trivyCacheDir(), { recursive: true });
  const images = [...config.checks.containers.images, ...opts.image];
  const out: ToolResult[] = [];
  for (const image of images) {
    const r = runTool(
      trivy,
      [
        ...trivyCommonArgs(cwd, opts, config),
        "image",
        "--format",
        "json",
        ...toolExtraArgs(config, "trivy"),
        image,
      ],
      { cwd },
    );
    out.push(result("containers", "trivy", r, parseTrivyFindings("containers", r)));
  }
  if (images.length === 0) {
    const r = runTool(
      trivy,
      [
        ...trivyCommonArgs(cwd, opts, config),
        "config",
        "--format",
        "json",
        ...toolExtraArgs(config, "trivy"),
        ".",
      ],
      { cwd },
    );
    out.push(result("containers", "trivy", r, parseTrivyFindings("containers", r)));
  }
  return out;
}

async function scanKubernetes(
  cwd: string,
  config: VegaStackScanConfig,
  opts: ScanOptions,
): Promise<ToolResult> {
  const trivy = await ensureScanTool("trivy", opts);
  fs.mkdirSync(trivyCacheDir(), { recursive: true });
  const paths = config.checks.kubernetes.paths.filter((p) => fs.existsSync(path.join(cwd, p)));
  const r = runTool(
    trivy,
    [
      ...trivyCommonArgs(cwd, opts, config),
      "config",
      "--format",
      "json",
      ...toolExtraArgs(config, "trivy"),
      ...(paths.length ? paths : ["."]),
    ],
    { cwd },
  );
  return result("kubernetes", "trivy", r, parseTrivyFindings("kubernetes", r));
}

async function scanIac(
  cwd: string,
  config: VegaStackScanConfig,
  opts: ScanOptions,
): Promise<ToolResult> {
  const trivy = await ensureScanTool("trivy", opts);
  fs.mkdirSync(trivyCacheDir(), { recursive: true });
  const paths = config.checks.iac.paths.length ? config.checks.iac.paths : ["."];
  const r = runTool(
    trivy,
    [
      ...trivyCommonArgs(cwd, opts, config),
      "config",
      "--format",
      "json",
      ...toolExtraArgs(config, "trivy"),
      ...paths,
    ],
    { cwd },
  );
  return result("iac", "trivy", r, parseTrivyFindings("iac", r));
}

function trivyCommonArgs(cwd: string, opts: ScanOptions, config: VegaStackScanConfig): string[] {
  return [
    ...trivyConfigArgs(cwd, config),
    "--cache-dir",
    trivyCacheDir(),
    ...(opts.offline
      ? ["--skip-db-update", "--skip-java-db-update", "--skip-check-update", "--offline-scan"]
      : []),
    ...(opts.severity ? ["--severity", opts.severity.toUpperCase()] : []),
  ];
}

function gitleaksConfigArgs(cwd: string, config: VegaStackScanConfig): string[] {
  const explicit = toolNativeConfigPath(config, "gitleaks");
  if (explicit) return ["--config", path.resolve(cwd, explicit)];
  if (toolIgnoresNativeConfig(config, "gitleaks")) return [];
  const local = path.join(cwd, ".gitleaks.toml");
  return fs.existsSync(local) ? ["--config", local] : [];
}

function trivyConfigArgs(cwd: string, config: VegaStackScanConfig): string[] {
  const explicit = toolNativeConfigPath(config, "trivy");
  if (explicit) return ["--config", path.resolve(cwd, explicit)];
  if (toolIgnoresNativeConfig(config, "trivy"))
    return ["--config", emptyNativeConfig("trivy.yaml")];
  return [];
}

function osvConfigArgs(cwd: string, config: VegaStackScanConfig): string[] {
  const explicit = toolNativeConfigPath(config, "osv-scanner");
  if (explicit) return ["--config", path.resolve(cwd, explicit)];
  if (toolIgnoresNativeConfig(config, "osv-scanner"))
    return ["--config", emptyNativeConfig("osv-scanner.toml")];
  return [];
}

function actionlintConfigArgs(cwd: string, config: VegaStackScanConfig): string[] {
  const explicit = toolNativeConfigPath(config, "actionlint");
  if (explicit) return ["-config-file", path.resolve(cwd, explicit)];
  if (toolIgnoresNativeConfig(config, "actionlint"))
    return ["-config-file", emptyNativeConfig("actionlint.yaml")];
  return [];
}

function zizmorConfigArgs(cwd: string, config: VegaStackScanConfig): string[] {
  const explicit = toolNativeConfigPath(config, "zizmor");
  if (explicit) return ["--config", path.resolve(cwd, explicit)];
  if (toolIgnoresNativeConfig(config, "zizmor")) return ["--no-config"];
  return [];
}

function toolNativeConfigPath(config: VegaStackScanConfig, tool: ScanToolName): string | undefined {
  const value = config.tools[tool]?.native_config_path;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toolIgnoresNativeConfig(config: VegaStackScanConfig, tool: ScanToolName): boolean {
  return config.tools[tool]?.ignore_native_config === true;
}

function toolExtraArgs(config: VegaStackScanConfig, tool: ScanToolName): string[] {
  const args = config.tools[tool]?.extra_args;
  return Array.isArray(args) ? args.filter((arg) => typeof arg === "string") : [];
}

function emptyNativeConfig(file: string): string {
  const dir = path.join(scanCacheRoot(), "empty-configs");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  if (!fs.existsSync(target)) fs.writeFileSync(target, "\n");
  return target;
}

function scanToolConfigStatus(cwd: string, config: VegaStackScanConfig, tool: ScanToolName) {
  const explicit = toolNativeConfigPath(config, tool);
  if (explicit) return { mode: "explicit", path: path.resolve(cwd, explicit) };
  if (toolIgnoresNativeConfig(config, tool)) return { mode: "ignored" };
  const discovered = discoveredNativeConfig(cwd, tool);
  if (discovered) return { mode: "auto", path: discovered };
  return { mode: "default" };
}

function discoveredNativeConfig(cwd: string, tool: ScanToolName): string | null {
  const candidates: Record<ScanToolName, string[]> = {
    gitleaks: [".gitleaks.toml"],
    trivy: ["trivy.yaml"],
    "osv-scanner": ["osv-scanner.toml"],
    actionlint: [path.join(".github", "actionlint.yaml"), path.join(".github", "actionlint.yml")],
    zizmor: [
      path.join(".github", "zizmor.yml"),
      path.join(".github", "zizmor.yaml"),
      "zizmor.yml",
      "zizmor.yaml",
    ],
  };
  for (const candidate of candidates[tool]) {
    const full = path.join(cwd, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function resolveGitHooksDir(cwd: string): string | null {
  if (!fs.existsSync(path.join(cwd, ".git"))) return null;
  const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd,
    encoding: "utf8",
  });
  const hooksPath = configured.status === 0 ? configured.stdout.trim() : "";
  if (hooksPath) return path.isAbsolute(hooksPath) ? hooksPath : path.resolve(cwd, hooksPath);
  return path.join(cwd, ".git", "hooks");
}

function parseGenericFindings(
  check: CanonicalScanCategory,
  tool: ScanToolName,
  r: { status: number; stdout: string; stderr: string },
): ScanFinding[] {
  if (r.status === 0) return [];
  const text = (r.stdout || r.stderr).trim();
  if (!text) return [];
  return [
    {
      check,
      tool,
      severity: "unknown",
      title: `${tool} finding`,
      message: redact(text).slice(0, 4000),
    },
  ];
}

function parseActionlintFindings(r: {
  status: number;
  stdout: string;
  stderr: string;
}): ScanFinding[] {
  if (r.status === 0) return [];
  const findings: ScanFinding[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const item = JSON.parse(text) as unknown;
      const rec = isRecord(item) ? item : {};
      const finding: ScanFinding = {
        check: "actions",
        tool: "actionlint",
        severity: "medium",
        title: stringValue(rec.kind) || "actionlint finding",
        message: stringValue(rec.message) || "actionlint reported a workflow issue",
        rule_id: stringValue(rec.kind),
      };
      const filepath = stringValue(rec.filepath);
      if (filepath) finding.path = filepath;
      if (typeof rec.line === "number") finding.line = rec.line;
      if (typeof rec.column === "number") finding.column = rec.column;
      findings.push(finding);
    } catch {
      return parseGenericFindings("actions", "actionlint", r);
    }
  }
  return findings.length > 0 ? findings : parseGenericFindings("actions", "actionlint", r);
}

function parseGitleaksFindings(r: {
  status: number;
  stdout: string;
  stderr: string;
}): ScanFinding[] {
  try {
    const parsed = JSON.parse(r.stdout) as unknown[];
    return parsed.map((item) => {
      const rec = isRecord(item) ? item : {};
      const finding: ScanFinding = {
        check: "secrets",
        tool: "gitleaks",
        severity: "high",
        title: stringValue(rec.Description) || stringValue(rec.RuleID) || "Gitleaks secret finding",
        message: "Gitleaks detected a potential secret. The matched value is redacted.",
        rule_id: stringValue(rec.RuleID),
      };
      const file = stringValue(rec.File);
      if (file) finding.path = file;
      const line = typeof rec.StartLine === "number" ? rec.StartLine : undefined;
      if (line !== undefined) finding.line = line;
      return finding;
    });
  } catch {
    return parseGenericFindings("secrets", "gitleaks", r);
  }
}

function parseOsvFindings(r: { status: number; stdout: string; stderr: string }): ScanFinding[] {
  try {
    const parsed = JSON.parse(r.stdout) as { results?: unknown[] };
    const findings: ScanFinding[] = [];
    for (const result of parsed.results ?? []) {
      const resultRecord = isRecord(result) ? result : {};
      const source = isRecord(resultRecord.source) ? resultRecord.source : {};
      const sourcePath = stringValue(source.path);
      const packages = Array.isArray(resultRecord.packages) ? resultRecord.packages : [];
      for (const pkgEntry of packages) {
        const pkgRecord = isRecord(pkgEntry) ? pkgEntry : {};
        const pkg = isRecord(pkgRecord.package) ? pkgRecord.package : {};
        const packageName = stringValue(pkg.name);
        const version = stringValue(pkg.version);
        const vulnerabilities = Array.isArray(pkgRecord.vulnerabilities)
          ? pkgRecord.vulnerabilities
          : [];
        for (const vuln of vulnerabilities) {
          const vulnRecord = isRecord(vuln) ? vuln : {};
          const db = isRecord(vulnRecord.database_specific) ? vulnRecord.database_specific : {};
          const id = stringValue(vulnRecord.id);
          const finding: ScanFinding = {
            check: "dependencies",
            tool: "osv-scanner",
            severity: normalizeOsvSeverity(stringValue(db.severity)),
            title: id || `Vulnerable package ${packageName}`,
            message:
              `${packageName}${version ? `@${version}` : ""} is affected by ${id || "a known vulnerability"}. ${stringValue(vulnRecord.summary) || stringValue(vulnRecord.details)}`.trim(),
            rule_id: id,
          };
          if (sourcePath) finding.path = sourcePath;
          const references: unknown[] = Array.isArray(vulnRecord.references)
            ? vulnRecord.references
            : [];
          const reference = references.find(isUrlRecord);
          if (reference) finding.url = reference.url;
          findings.push(finding);
        }
      }
    }
    return findings;
  } catch {
    return parseGenericFindings("dependencies", "osv-scanner", r);
  }
}

function parseTrivyFindings(
  check: CanonicalScanCategory,
  r: { status: number; stdout: string; stderr: string },
): ScanFinding[] {
  try {
    const parsed = JSON.parse(r.stdout) as {
      Results?: {
        Target?: string;
        Vulnerabilities?: unknown[];
        Misconfigurations?: unknown[];
        Secrets?: unknown[];
        Licenses?: unknown[];
      }[];
    };
    const out: ScanFinding[] = [];
    for (const entry of parsed.Results ?? []) {
      for (const vuln of entry.Vulnerabilities ?? [])
        out.push(fromTrivy(check, entry.Target, vuln));
      for (const mis of entry.Misconfigurations ?? [])
        out.push(fromTrivy(check, entry.Target, mis));
      for (const secret of entry.Secrets ?? []) out.push(fromTrivy(check, entry.Target, secret));
      for (const license of entry.Licenses ?? []) out.push(fromTrivy(check, entry.Target, license));
    }
    return out;
  } catch {
    return parseGenericFindings(check, "trivy", r);
  }
}

function fromTrivy(
  check: CanonicalScanCategory,
  target: string | undefined,
  raw: unknown,
): ScanFinding {
  const item = isRecord(raw) ? raw : {};
  const severity = normalizeSeverity(stringValue(item.Severity));
  const finding: ScanFinding = {
    check,
    tool: "trivy",
    severity,
    title:
      stringValue(item.Title) ||
      stringValue(item.VulnerabilityID) ||
      stringValue(item.ID) ||
      "Trivy finding",
    message:
      stringValue(item.Description) || stringValue(item.Message) || "Trivy reported a finding",
    rule_id: stringValue(item.VulnerabilityID) || stringValue(item.ID),
    url: stringValue(item.PrimaryURL),
  };
  const findingPath = stringValue(item.FilePath) || target;
  if (findingPath) finding.path = findingPath;
  return finding;
}

function parseZizmorFindings(r: { status: number; stdout: string; stderr: string }): ScanFinding[] {
  try {
    const parsed = JSON.parse(r.stdout) as unknown[];
    return parsed.map((item) => {
      const rec = isRecord(item) ? item : {};
      const det = isRecord(rec.determinations) ? rec.determinations : {};
      const finding: ScanFinding = {
        check: "actions",
        tool: "zizmor",
        severity: normalizeSeverity(stringValue(det.severity)),
        title: stringValue(rec.ident) || "zizmor finding",
        message: stringValue(rec.desc) || "zizmor reported a GitHub Actions security finding",
        rule_id: stringValue(rec.ident),
        url: stringValue(rec.url),
      };
      const location = firstZizmorLocation(rec);
      if (location.path) finding.path = location.path;
      if (location.line !== undefined) finding.line = location.line;
      if (location.column !== undefined) finding.column = location.column;
      return finding;
    });
  } catch {
    return parseGenericFindings("actions", "zizmor", r);
  }
}

function firstZizmorLocation(rec: Record<string, unknown>): {
  path?: string;
  line?: number;
  column?: number;
} {
  const locations = Array.isArray(rec.locations) ? rec.locations : [];
  const first = isRecord(locations[0]) ? locations[0] : {};
  const symbolic = isRecord(first.symbolic) ? first.symbolic : {};
  const key = isRecord(symbolic.key) ? symbolic.key : {};
  const local = isRecord(key.Local) ? key.Local : {};
  const concrete = isRecord(first.concrete) ? first.concrete : {};
  const location = isRecord(concrete.location) ? concrete.location : {};
  const start = isRecord(location.start_point) ? location.start_point : {};
  const out: { path?: string; line?: number; column?: number } = {};
  const givenPath = stringValue(local.given_path);
  if (givenPath) out.path = givenPath;
  if (typeof start.row === "number") out.line = start.row + 1;
  if (typeof start.column === "number") out.column = start.column + 1;
  return out;
}

function result(
  check: CanonicalScanCategory,
  tool: ScanToolName,
  r: { status: number; stdout: string; stderr: string },
  findings: ScanFinding[],
): ToolResult {
  return {
    check,
    tool,
    status: findings.length > 0 ? 1 : r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    findings,
  };
}

function shouldFail(finding: ScanFinding, config: VegaStackScanConfig): boolean {
  return config.policy.fail_on.includes(finding.severity === "unknown" ? "high" : finding.severity);
}

function summarize(findings: ScanFinding[], failedTools: ToolResult[]): Record<string, number> {
  const out: Record<string, number> = {
    findings: findings.length,
    tool_failures: failedTools.length,
  };
  for (const finding of findings) out[finding.severity] = (out[finding.severity] ?? 0) + 1;
  return out;
}

function printTextReport(payload: {
  ok: boolean;
  findings: ScanFinding[];
  failures: { check: string; tool: string; message: string }[];
}): void {
  if (payload.findings.length === 0 && payload.failures.length === 0) {
    log.ok("scan passed");
    return;
  }
  for (const finding of payload.findings) {
    log.err(`[${finding.severity}] ${finding.check}/${finding.tool}: ${finding.title}`);
    if (finding.path) log.info(`  ${finding.path}${finding.line ? `:${finding.line}` : ""}`);
    log.info(`  ${finding.message}`);
  }
  for (const failure of payload.failures)
    log.err(`${failure.check}/${failure.tool} failed: ${failure.message}`);
}

function toSarif(findings: ScanFinding[]): Record<string, unknown> {
  const rules = new Map<string, ScanFinding>();
  for (const finding of findings) {
    rules.set(sarifRuleId(finding), finding);
  }
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "VegaStack Scan",
            informationUri: "https://github.com/vegastack/vegastack-cli",
            rules: [...rules.values()].map((finding) => ({
              id: sarifRuleId(finding),
              name: finding.title,
              shortDescription: { text: finding.title },
              helpUri: finding.url,
              properties: {
                category: finding.check,
                scanner: finding.tool,
                severity: finding.severity,
              },
            })),
          },
        },
        results: findings.map((finding) => ({
          ruleId: sarifRuleId(finding),
          level: sarifLevel(finding.severity),
          message: { text: finding.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: finding.path ?? ".",
                },
                region: {
                  startLine: finding.line ?? 1,
                  startColumn: finding.column ?? 1,
                },
              },
            },
          ],
          properties: {
            category: finding.check,
            scanner: finding.tool,
            severity: finding.severity,
          },
        })),
      },
    ],
  };
}

export function toSarifForTesting(findings: ScanFinding[]): Record<string, unknown> {
  return toSarif(findings);
}

function sarifRuleId(finding: ScanFinding): string {
  return `${finding.tool}/${finding.rule_id ?? finding.title}`;
}

function sarifLevel(severity: ScanFinding["severity"]): "error" | "warning" | "notice" {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium" || severity === "low" || severity === "unknown") return "warning";
  return "notice";
}

function stagedFiles(cwd: string): string[] {
  const r = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

function existingWorkflowInputs(cwd: string): string[] {
  const dir = path.join(cwd, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => isWorkflowFile(path.join(".github", "workflows", file)))
    .map((file) => path.join(".github", "workflows", file));
}

function isWorkflowFile(file: string): boolean {
  return /^\.github[\\/]workflows[\\/].+\.ya?ml$/i.test(file);
}

function normalizeSeverity(value: string): ScanFinding["severity"] {
  const lower = value.toLowerCase();
  if (
    lower === "critical" ||
    lower === "high" ||
    lower === "medium" ||
    lower === "low" ||
    lower === "info"
  )
    return lower;
  return "unknown";
}

function normalizeOsvSeverity(value: string): ScanFinding["severity"] {
  const lower = value.toLowerCase();
  if (lower === "critical") return "critical";
  if (lower === "high") return "high";
  if (lower === "moderate" || lower === "medium") return "medium";
  if (lower === "low") return "low";
  return "unknown";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUrlRecord(value: unknown): value is { url: string } {
  return isRecord(value) && typeof value.url === "string";
}

function redact(value: string): string {
  return value
    .replace(/gh[pousr]_[A-Za-z0-9_]{10,}/g, "gh*_REDACTED")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA_REDACTED");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
