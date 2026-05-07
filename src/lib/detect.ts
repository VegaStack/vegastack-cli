import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  buildInitPlan,
  loadLocalRegistryPackDefinitions,
  PACKS,
  type DetectedPack,
  type PackDefinition,
} from "./project.js";
import { projectDetectionCachePath } from "./paths.js";

export type DetectionStatus = "ok" | "needs_input";

export interface CommandDetection {
  package_manager?: PackageManagerDetection;
  install?: string;
  build?: string;
  test?: string;
  dev?: string;
}

export interface PackageManagerDetection {
  name: "npm" | "pnpm" | "yarn" | "bun";
  version?: string;
  evidence: string[];
  ambiguous?: boolean;
  candidates?: string[];
}

export interface FrameworkDetection {
  name: string;
  version?: string;
  evidence: string[];
}

export interface RepoDetection {
  git: boolean;
  host?: "github" | "gitlab" | "bitbucket" | "azure-devops";
  default_branch?: string;
  remotes: string[];
}

export interface ProjectDetection {
  schema_version: 1;
  generated_at: string;
  root: string;
  status: DetectionStatus;
  questions: DetectionQuestion[];
  fingerprint: string;
  repo: RepoDetection;
  stack: {
    package_manager?: PackageManagerDetection;
    frameworks: FrameworkDetection[];
  };
  commands: CommandDetection;
  ci: {
    providers: string[];
    files: string[];
  };
  deploy: {
    targets: string[];
    files: string[];
  };
  containers: {
    dockerfiles: string[];
    compose_files: string[];
  };
  iac: {
    terraform: string[];
    kubernetes: string[];
    helm: string[];
  };
  registry: {
    recommended_entries: string[];
    detected: DetectedPack[];
  };
  stale?: {
    detection_cache_exists: boolean;
    changed: boolean;
    previous_fingerprint?: string;
  };
}

export interface DetectionQuestion {
  id: string;
  message: string;
  options: string[];
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

export function detectProject(
  cwd: string,
  packs: readonly PackDefinition[] = loadLocalRegistryPackDefinitions(PACKS),
): ProjectDetection {
  const files = listFiles(cwd, 5, 3000);
  const fileSet = new Set(files);
  const packageJson = readPackageJson(cwd);
  const packageManager = detectPackageManager(cwd, fileSet, packageJson);
  const frameworks = detectFrameworks(fileSet, packageJson);
  const commands = detectCommands(packageJson, packageManager);
  const repo = detectRepo(cwd);
  const ci = detectCi(files);
  const deploy = detectDeploy(files, packageJson);
  const containers = detectContainers(files);
  const iac = detectIac(files, cwd);
  const plan = buildInitPlan(cwd, undefined, packs);
  const recommended = new Set(plan.selected.map((p) => p.name));

  for (const entry of baselineRegistryEntries(repo, ci, deploy, containers)) recommended.add(entry);
  for (const target of deploy.targets) {
    if (target === "vercel") recommended.add("vercel");
    if (target === "cloudflare") recommended.add("cloudflare");
    if (target === "netlify") recommended.add("netlify");
  }

  const questions: DetectionQuestion[] = [];
  if (packageManager?.ambiguous) {
    questions.push({
      id: "package_manager",
      message: "Multiple package manager lockfiles were detected. Which package manager should VegaStack use for generated workflow guidance?",
      options: packageManager.candidates ?? [],
    });
  }

  const fingerprint = computeFingerprint({
    files: files.filter(isDetectionRelevantFile),
    packageManager,
    frameworks,
    commands,
    repo,
    ci,
    deploy,
    containers,
    iac,
    registry: [...recommended].sort(),
  });

  const previous = readPreviousFingerprint(cwd);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    root: cwd,
    status: questions.length > 0 ? "needs_input" : "ok",
    questions,
    fingerprint,
    repo,
    stack: {
      ...(packageManager ? { package_manager: packageManager } : {}),
      frameworks,
    },
    commands,
    ci,
    deploy,
    containers,
    iac,
    registry: {
      recommended_entries: [...recommended].sort(),
      detected: plan.scan.detected,
    },
    stale: {
      detection_cache_exists: previous.exists,
      changed: previous.fingerprint !== undefined && previous.fingerprint !== fingerprint,
      ...(previous.fingerprint ? { previous_fingerprint: previous.fingerprint } : {}),
    },
  };
}

function detectPackageManager(
  cwd: string,
  files: Set<string>,
  packageJson: PackageJson | null,
): PackageManagerDetection | undefined {
  const evidence: string[] = [];
  const candidates = new Set<PackageManagerDetection["name"]>();
  const packageManager = packageJson?.packageManager;
  if (packageManager) {
    const [name, version] = packageManager.split("@");
    if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") {
      candidates.add(name);
      evidence.push(`package.json packageManager: ${packageManager}`);
      return {
        name,
        ...(version ? { version } : {}),
        evidence,
        ...lockfileAmbiguity(files, name),
      };
    }
  }
  if (files.has("pnpm-lock.yaml")) {
    candidates.add("pnpm");
    evidence.push("pnpm-lock.yaml");
  }
  if (files.has("yarn.lock")) {
    candidates.add("yarn");
    evidence.push("yarn.lock");
  }
  if (files.has("bun.lock") || files.has("bun.lockb")) {
    candidates.add("bun");
    evidence.push(files.has("bun.lock") ? "bun.lock" : "bun.lockb");
  }
  if (files.has("package-lock.json") || files.has("npm-shrinkwrap.json")) {
    candidates.add("npm");
    evidence.push(files.has("package-lock.json") ? "package-lock.json" : "npm-shrinkwrap.json");
  }
  if (candidates.size === 0 && fs.existsSync(path.join(cwd, "package.json"))) {
    return { name: "npm", evidence: ["package.json"] };
  }
  const ordered = [...candidates].sort();
  const name = ordered[0];
  if (!name) return undefined;
  return {
    name,
    evidence,
    ...(ordered.length > 1 ? { ambiguous: true, candidates: ordered } : {}),
  };
}

function lockfileAmbiguity(
  files: Set<string>,
  selected: PackageManagerDetection["name"],
): Pick<PackageManagerDetection, "ambiguous" | "candidates"> {
  const locks: PackageManagerDetection["name"][] = [];
  if (files.has("pnpm-lock.yaml")) locks.push("pnpm");
  if (files.has("yarn.lock")) locks.push("yarn");
  if (files.has("bun.lock") || files.has("bun.lockb")) locks.push("bun");
  if (files.has("package-lock.json") || files.has("npm-shrinkwrap.json")) locks.push("npm");
  const unique = [...new Set(locks)];
  if (unique.length > 1 && !unique.includes(selected)) {
    return { ambiguous: true, candidates: unique.sort() };
  }
  return {};
}

function detectCommands(
  pkg: PackageJson | null,
  pm: PackageManagerDetection | undefined,
): CommandDetection {
  if (!pkg || !pm || pm.ambiguous) return pm ? { package_manager: pm } : {};
  const run = (script: string): string | undefined =>
    pkg.scripts?.[script] ? `${pm.name} run ${script}` : undefined;
  const install =
    pm.name === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : pm.name === "yarn"
        ? "yarn install --immutable"
        : pm.name === "bun"
          ? "bun install --frozen-lockfile"
          : "npm ci";
  const build = run("build");
  const test = run("test");
  const dev = run("dev");
  return {
    package_manager: pm,
    install,
    ...(build ? { build } : {}),
    ...(test ? { test } : {}),
    ...(dev ? { dev } : {}),
  };
}

function detectFrameworks(files: Set<string>, pkg: PackageJson | null): FrameworkDetection[] {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const out: FrameworkDetection[] = [];
  const add = (name: string, depName = name, evidence?: string): void => {
    if (deps[depName]) out.push({ name, version: deps[depName], evidence: [depName] });
    else if (evidence) out.push({ name, evidence: [evidence] });
  };
  add("nextjs", "next");
  add("vite", "vite");
  add("astro", "astro");
  add("remix", "@remix-run/dev");
  add("nuxt", "nuxt");
  if (files.has("next.config.js") || files.has("next.config.mjs") || files.has("next.config.ts"))
    add("nextjs", "next", "next.config");
  if (files.has("astro.config.mjs") || files.has("astro.config.ts")) add("astro", "astro", "astro.config");
  return dedupeFrameworks(out);
}

function detectRepo(cwd: string): RepoDetection {
  const git = fs.existsSync(path.join(cwd, ".git"));
  const config = readText(path.join(cwd, ".git", "config")) ?? "";
  const remotes = [...config.matchAll(/url\s*=\s*(.+)/g)].map((m) => (m[1] ?? "").trim());
  const branch =
    readText(path.join(cwd, ".git", "HEAD"))?.match(/refs\/heads\/(.+)$/)?.[1] ?? undefined;
  const joined = remotes.join(" ");
  const host = /github\.com[:/]/.test(joined)
    ? "github"
    : /gitlab\.com[:/]/.test(joined)
      ? "gitlab"
      : /bitbucket\.org[:/]/.test(joined)
        ? "bitbucket"
        : /dev\.azure\.com[:/]/.test(joined)
          ? "azure-devops"
          : undefined;
  return { git, ...(host ? { host } : {}), ...(branch ? { default_branch: branch } : {}), remotes };
}

function detectCi(files: string[]): ProjectDetection["ci"] {
  const providers: string[] = [];
  const ciFiles = files.filter((f) =>
    f.startsWith(".github/workflows/") ||
    [".gitlab-ci.yml", ".gitlab-ci.yaml", "azure-pipelines.yml", "bitbucket-pipelines.yml"].includes(f) ||
    f.startsWith(".circleci/"),
  );
  if (ciFiles.some((f) => f.startsWith(".github/workflows/"))) providers.push("github-actions");
  if (ciFiles.some((f) => f.startsWith(".gitlab-ci."))) providers.push("gitlab-ci");
  if (ciFiles.some((f) => f.startsWith(".circleci/"))) providers.push("circleci");
  return { providers, files: ciFiles };
}

function detectDeploy(files: string[], pkg: PackageJson | null): ProjectDetection["deploy"] {
  const targets: string[] = [];
  const deployFiles = files.filter((f) =>
    ["vercel.json", "netlify.toml", "wrangler.toml", "wrangler.json", "wrangler.jsonc"].includes(f),
  );
  if (
    deployFiles.includes("vercel.json") ||
    Boolean(pkg?.dependencies?.next ?? pkg?.devDependencies?.next)
  )
    targets.push("vercel");
  if (deployFiles.includes("netlify.toml")) targets.push("netlify");
  if (deployFiles.some((f) => f.startsWith("wrangler."))) targets.push("cloudflare");
  return { targets: [...new Set(targets)].sort(), files: deployFiles };
}

function detectContainers(files: string[]): ProjectDetection["containers"] {
  return {
    dockerfiles: files.filter((f) => /(^|\/)(Dockerfile|Containerfile|Dockerfile\.[^/]+)$/.test(f)),
    compose_files: files.filter((f) => /(^|\/)(compose|docker-compose)(\.[^/]+)?\.ya?ml$/.test(f)),
  };
}

function detectIac(files: string[], cwd: string): ProjectDetection["iac"] {
  return {
    terraform: files.filter((f) => f.endsWith(".tf") || f.endsWith(".tfvars") || f === ".terraform.lock.hcl"),
    kubernetes: files.filter((f) => {
      if (!/\.(ya?ml)$/.test(f)) return false;
      const raw = readText(path.join(cwd, f));
      return Boolean(raw && /\bapiVersion:\s*.+\n[\s\S]*\bkind:\s*(Deployment|Service|Ingress|StatefulSet|DaemonSet|ConfigMap|Secret|Job|CronJob)\b/.test(raw));
    }),
    helm: files.filter((f) => /(^|\/)(Chart\.yaml|values\.ya?ml)$/.test(f)),
  };
}

function baselineRegistryEntries(
  repo: RepoDetection,
  ci: ProjectDetection["ci"],
  deploy: ProjectDetection["deploy"],
  containers: ProjectDetection["containers"],
): string[] {
  const out = new Set<string>(["docker"]);
  if (repo.host === "github" || ci.providers.includes("github-actions")) out.add("github-actions");
  if (repo.host === "gitlab" || ci.providers.includes("gitlab-ci")) out.add("gitlab-ci");
  if (deploy.targets.length > 0 || containers.dockerfiles.length > 0 || containers.compose_files.length > 0) out.add("docker");
  return [...out];
}

function listFiles(root: string, maxDepth: number, maxFiles: number): string[] {
  const ignored = new Set([".git", ".vegastack", "node_modules", "dist", "coverage", ".next", ".turbo", "vendor"]);
  const out: string[] = [];
  function walk(dir: string, depth: number): void {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(root, 0);
  return out.sort();
}

function readPackageJson(cwd: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function dedupeFrameworks(items: FrameworkDetection[]): FrameworkDetection[] {
  const byName = new Map<string, FrameworkDetection>();
  for (const item of items) {
    const existing = byName.get(item.name);
    if (!existing) byName.set(item.name, item);
    else byName.set(item.name, { ...existing, evidence: [...new Set([...existing.evidence, ...item.evidence])] });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isDetectionRelevantFile(file: string): boolean {
  return (
    file === "package.json" ||
    file.endsWith("lock") ||
    file.endsWith("lockb") ||
    file.endsWith("lock.yaml") ||
    /\.(ya?ml|toml|json|tf|tfvars)$/.test(file) ||
    /(^|\/)(Dockerfile|Containerfile|Jenkinsfile|Chart\.yaml)$/.test(file)
  );
}

function computeFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readPreviousFingerprint(cwd: string): { exists: boolean; fingerprint?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(projectDetectionCachePath(cwd), "utf8")) as {
      detection?: { fingerprint?: unknown };
    };
    return {
      exists: true,
      ...(typeof raw.detection?.fingerprint === "string" ? { fingerprint: raw.detection.fingerprint } : {}),
    };
  } catch {
    return { exists: false };
  }
}
