import * as fs from "node:fs";
import * as path from "node:path";
import {
  projectInstructionsDir,
  registryCacheRoot,
  registryEntryDir,
  projectLockPath,
  projectManifestPath,
  projectVegaStackDir,
} from "./paths.js";

export type PackStatus = "available" | "planned";

export interface PackDefinition {
  name: string;
  title: string;
  shape: string;
  status: PackStatus;
  description: string;
  detects: readonly string[];
  source: string;
  version?: string;
}

export interface DetectedPack {
  name: string;
  title: string;
  shape: string;
  status: PackStatus;
  description: string;
  source: string;
  version?: string;
  selected: boolean;
  reasons: string[];
}

export interface ProjectScan {
  root: string;
  git: boolean;
  detected: DetectedPack[];
}

export interface InitPlan {
  scan: ProjectScan;
  selected: DetectedPack[];
  files: {
    projectJson: string;
    lockJson: string;
    gitignore: string;
    instructions: string[];
  };
  registryCacheRoot: string;
}

export const PACKS: readonly PackDefinition[] = Object.freeze([
  {
    name: "terraform",
    title: "Terraform",
    shape: "structured-schema",
    status: "available",
    description: "Terraform provider docs, resource manifests, recipes, and knowledge cards.",
    detects: ["*.tf", "*.tfvars", ".terraform.lock.hcl"],
    source: "https://github.com/vegastack/vegastack-cli-registry",
  },
  {
    name: "github-actions",
    title: "GitHub Actions",
    shape: "workflow-yaml",
    status: "available",
    description: "Workflow syntax, actions context, permissions, runners, and CI recipes.",
    detects: [".github/workflows/*.yml", ".github/workflows/*.yaml"],
    source: "https://github.com/github/docs",
  },
  {
    name: "docker",
    title: "Docker",
    shape: "cli-flags+compose",
    status: "available",
    description: "Dockerfile, Compose, BuildKit, and Docker CLI reference.",
    detects: ["Dockerfile", "compose.yaml", "compose.yml", "docker-compose.yaml"],
    source: "https://github.com/docker/docs",
  },
  {
    name: "supabase",
    title: "Supabase",
    shape: "docs-site+cli-flags+api",
    status: "available",
    description: "Supabase docs, CLI workflows, auth, database, functions, and local dev.",
    detects: ["supabase/config.toml", "supabase/functions", "supabase/migrations"],
    source: "https://github.com/supabase/supabase/tree/master/apps/docs",
  },
  {
    name: "kubernetes",
    title: "Kubernetes / kubectl",
    shape: "structured-schema+cli-flags",
    status: "available",
    description: "Kubernetes manifests, kubectl commands, and operational recipes.",
    detects: ["k8s/*.yaml", "kubernetes/*.yaml", "manifests/*.yaml", "kind: Deployment"],
    source: "https://github.com/kubernetes/website",
  },
  {
    name: "helm",
    title: "Helm",
    shape: "chart-schema+cli-flags",
    status: "available",
    description: "Chart structure, values, templates, and Helm CLI operations.",
    detects: ["Chart.yaml", "charts/"],
    source: "https://github.com/helm/helm-www",
  },
  {
    name: "aws-cli",
    title: "AWS CLI",
    shape: "cli-flags",
    status: "available",
    description: "AWS CLI command tree, flags, outputs, and cloudops recipes.",
    detects: [".aws/", "aws"],
    source: "https://github.com/aws/aws-cli",
  },
  {
    name: "jenkins",
    title: "Jenkins",
    shape: "ci-server+pipeline-docs",
    status: "available",
    description:
      "Jenkins controller administration, Pipeline, Jenkinsfile, plugins, agents, and tutorials.",
    detects: ["Jenkinsfile", "**/Jenkinsfile"],
    source: "https://github.com/jenkins-infra/jenkins.io",
  },
]);

const IGNORE_DIRS = new Set([
  ".git",
  ".vegastack",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
]);

export function scanProject(cwd: string): ProjectScan {
  return scanProjectWithPacks(cwd, loadLocalRegistryPackDefinitions(PACKS));
}

export function loadLocalRegistryPackDefinitions(
  fallback: readonly PackDefinition[] = PACKS,
): PackDefinition[] {
  const byName = new Map(fallback.map((pack) => [pack.name, { ...pack }]));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(registryCacheRoot(), { withFileTypes: true });
  } catch {
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(registryEntryDir(entry.name), "MANIFEST.json");
    try {
      if (!fs.existsSync(manifestPath)) continue;
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        id?: string;
        title?: string;
        shape?: string;
        status?: PackStatus;
        description?: string;
        detects?: string[];
        source?: unknown;
        pack_version?: string;
        version?: string;
      };
      const name = raw.id ?? entry.name;
      byName.set(name, {
        name,
        title: raw.title ?? byName.get(name)?.title ?? name,
        shape: raw.shape ?? byName.get(name)?.shape ?? "registry-entry",
        status: raw.status === "planned" ? "planned" : "available",
        description: raw.description ?? byName.get(name)?.description ?? raw.title ?? name,
        detects: Array.isArray(raw.detects) ? raw.detects : (byName.get(name)?.detects ?? []),
        source: sourceLabel(raw.source) ?? byName.get(name)?.source ?? "local registry cache",
        ...((raw.pack_version ?? raw.version) ? { version: raw.pack_version ?? raw.version } : {}),
      });
    } catch {
      continue;
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function scanProjectWithPacks(cwd: string, packs: readonly PackDefinition[]): ProjectScan {
  const files = listProjectFiles(cwd, 4, 2000);
  const fileSet = new Set(files);
  const git = fs.existsSync(path.join(cwd, ".git"));
  const detected = packs
    .map((pack) => {
      const reasons = detectPack(pack, fileSet, cwd);
      return {
        name: pack.name,
        title: pack.title,
        shape: pack.shape,
        status: pack.status,
        description: pack.description,
        source: pack.source,
        selected: pack.status === "available" && reasons.length > 0,
        reasons,
      };
    })
    .filter((p) => p.reasons.length > 0);
  return { root: cwd, git, detected };
}

export function buildInitPlan(
  cwd: string,
  selectedNames?: readonly string[],
  packs: readonly PackDefinition[] = PACKS,
): InitPlan {
  const scan = scanProjectWithPacks(cwd, packs);
  const selectedSet = selectedNames ? new Set(selectedNames) : undefined;
  const selected = scan.detected
    .filter((p) => p.status === "available")
    .filter((p) => (selectedSet ? selectedSet.has(p.name) : p.selected));
  return {
    scan,
    selected,
    files: {
      projectJson: projectManifestPath(cwd),
      lockJson: projectLockPath(cwd),
      gitignore: path.join(projectVegaStackDir(cwd), ".gitignore"),
      instructions: [
        path.join(projectInstructionsDir(cwd), "AGENTS.md"),
        path.join(projectInstructionsDir(cwd), "CLAUDE.md"),
        path.join(projectInstructionsDir(cwd), "README.md"),
      ],
    },
    registryCacheRoot: registryCacheRoot(),
  };
}

export function writeInitFiles(plan: InitPlan): void {
  const root = plan.scan.root;
  fs.mkdirSync(projectInstructionsDir(root), { recursive: true });
  fs.mkdirSync(registryCacheRoot(), { recursive: true });
  writeLocalGitignore(root);

  const now = new Date().toISOString();
  const registryEntries = Object.fromEntries(
    plan.selected.map((p) => [
      p.name,
      {
        status: "installed",
        cache_path: registryEntryCachePath(p.name),
        source: p.source,
      },
    ]),
  );
  const detected = Object.fromEntries(
    plan.scan.detected.map((p) => [
      p.name,
      {
        title: p.title,
        status: p.status,
        selected: plan.selected.some((s) => s.name === p.name),
        reasons: p.reasons,
      },
    ]),
  );

  const projectJson = {
    schema_version: 1,
    generated_at: now,
    project_root: root,
    git: plan.scan.git,
    detected,
    registry_entries: registryEntries,
    instructions: {
      directory: projectInstructionsDir(root),
      agent_entrypoints: [
        path.join(projectInstructionsDir(root), "AGENTS.md"),
        path.join(projectInstructionsDir(root), "CLAUDE.md"),
      ],
    },
  };
  writeJson(projectManifestPath(root), projectJson);

  const lockJson = {
    schema_version: 1,
    generated_at: now,
    registry_entries: Object.fromEntries(
      plan.selected.map((p) => [
        p.name,
        {
          version: readRegistryEntryManifestVersion(p.name) ?? p.version ?? "unknown",
          cache_path: registryEntryCachePath(p.name),
          source: p.source,
        },
      ]),
    ),
  };
  writeJson(projectLockPath(root), lockJson);

  fs.writeFileSync(
    path.join(projectInstructionsDir(root), "AGENTS.md"),
    renderAgentInstructions(plan, "AGENTS.md"),
  );
  fs.writeFileSync(
    path.join(projectInstructionsDir(root), "CLAUDE.md"),
    renderAgentInstructions(plan, "CLAUDE.md"),
  );
  fs.writeFileSync(
    path.join(projectInstructionsDir(root), "README.md"),
    renderInstructionsReadme(plan),
  );
  writePackCacheMetadata(plan);
}

export function registryEntryCachePath(entryName: string): string {
  return registryEntryDir(entryName);
}

export function packCachePath(packName: string): string {
  return registryEntryCachePath(packName);
}

function detectPack(pack: PackDefinition, files: Set<string>, cwd: string): string[] {
  const reasons: string[] = [];
  for (const f of files) {
    for (const pattern of pack.detects) {
      if (detectPatternMatches(pattern, f, cwd)) reasons.push(f);
    }
    if (
      pack.name === "terraform" &&
      (f.endsWith(".tf") || f.endsWith(".tfvars") || f === ".terraform.lock.hcl")
    ) {
      reasons.push(f);
    }
    if (
      pack.name === "github-actions" &&
      f.startsWith(".github/workflows/") &&
      /\.(ya?ml)$/.test(f)
    ) {
      reasons.push(f);
    }
    if (
      pack.name === "docker" &&
      /(^|\/)(Dockerfile|compose\.ya?ml|docker-compose\.ya?ml)$/.test(f)
    ) {
      reasons.push(f);
    }
    if (pack.name === "supabase" && (f.startsWith("supabase/") || f === "supabase/config.toml")) {
      reasons.push(f);
    }
    if (pack.name === "jenkins" && /(^|\/)Jenkinsfile$/.test(f)) {
      reasons.push(f);
    }
    if (pack.name === "helm" && /(^|\/)Chart\.yaml$/.test(f)) {
      reasons.push(f);
    }
    if (pack.name === "kubernetes" && /\.(ya?ml)$/.test(f)) {
      const full = path.join(cwd, f);
      const raw = readTextIfExists(full);
      if (
        raw &&
        /\bkind:\s*(Deployment|Service|StatefulSet|Ingress|ConfigMap|Secret)\b/.test(raw)
      ) {
        reasons.push(f);
      }
    }
  }
  return [...new Set(reasons)].slice(0, 8);
}

function detectPatternMatches(pattern: string, file: string, cwd: string): boolean {
  if (pattern.startsWith("content:")) {
    if (!/\.(ya?ml|json|toml|md|mdx|txt|tf|hcl)$/i.test(file)) return false;
    const raw = readTextIfExists(path.join(cwd, file));
    if (!raw) return false;
    try {
      return new RegExp(pattern.slice("content:".length)).test(raw);
    } catch {
      return false;
    }
  }
  return globLikeMatch(pattern, file);
}

function globLikeMatch(pattern: string, file: string): boolean {
  const escaped = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(file);
}

function sourceLabel(source: unknown): string | undefined {
  if (typeof source === "string" && source.length > 0) return source;
  if (!source || typeof source !== "object") return undefined;
  const value = source as {
    type?: unknown;
    repo?: unknown;
    branch?: unknown;
    path?: unknown;
    paths?: unknown;
  };
  if (value.type === "github-archive" && typeof value.repo === "string") {
    const branch = typeof value.branch === "string" ? value.branch : "main";
    const paths = Array.isArray(value.paths)
      ? value.paths.filter((p): p is string => typeof p === "string")
      : [];
    if (paths.length === 1) return `https://github.com/${value.repo}/tree/${branch}/${paths[0]}`;
    return `https://github.com/${value.repo}/tree/${branch}`;
  }
  if (value.type === "local" && typeof value.path === "string") return value.path;
  return undefined;
}

function listProjectFiles(root: string, maxDepth: number, maxFiles: number): string[] {
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
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(root, 0);
  return out.sort();
}

function writeLocalGitignore(root: string): void {
  const p = path.join(projectVegaStackDir(root), ".gitignore");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "*\n");
}

function writePackCacheMetadata(plan: InitPlan): void {
  for (const selected of plan.selected) {
    const dir = registryEntryCachePath(selected.name);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, "vegastack-pack.json"), {
      schema_version: 1,
      name: selected.name,
      title: selected.title,
      shape: selected.shape,
      source: selected.source,
      cache_path: dir,
      managed_by: "vegastack",
      note:
        selected.name === "terraform"
          ? "Terraform Registry pack currently points at the installed Terraform registry cache."
          : "Registry pack metadata placeholder. Remote registry downloader/indexer is being wired next.",
    });
  }
}

function renderAgentInstructions(plan: InitPlan, target: string): string {
  return `# VegaStack Project Instructions for ${target}

This project-local instruction file is managed by @vegastack/cli.
For project-specific registry entries, detected stack, and security setup, read the current repository's \`.vegastack/project.json\` and \`.vegastack/vegastack-lock.json\`.

## Rules

- For ops, cloud, IaC, CI/CD, Kubernetes, Docker, Supabase, or CLI work, run \`vegastack ask "<user request>"\` and use returned citations.
- For exact source lookup or debugging weak evidence, run \`vegastack search --entry <entry> "<literal text>"\`.
- For Terraform-specific work, run \`vegastack ask --entry terraform --tf-provider <provider> "<user request>"\`.
- Do not invent resource names, arguments, import IDs, command flags, workflow keys, or provider behaviors.
- Do not print secrets from .env files, shell history, cloud credentials, CI variables, or local config.
- If a task may modify infrastructure, show the planned change and ask before destructive actions.
- Prefer project-local context from \`.vegastack/project.json\` and \`.vegastack/vegastack-lock.json\`.

## Files

- Project manifest: \`.vegastack/project.json\`
- Registry lock: \`.vegastack/vegastack-lock.json\`
- Project instructions directory: \`${projectInstructionsDir(plan.scan.root)}\`
`;
}

function renderInstructionsReadme(_plan: InitPlan): string {
  return `# VegaStack Project Harness

This project-local directory is generated by \`vegastack init\`.

## How Agents Should Use This

Agents should read the instruction file matching their harness from this directory before infra, cloudops, CI/CD, or SRE work, then read the current repository's \`.vegastack/project.json\` and \`.vegastack/vegastack-lock.json\`.

- Codex and other AGENTS.md-compatible agents: \`${path.join(projectInstructionsDir(_plan.scan.root), "AGENTS.md")}\`
- Claude Code: \`${path.join(projectInstructionsDir(_plan.scan.root), "CLAUDE.md")}\`

Heavy registry content is cached under:

\`${registryCacheRoot()}\`
`;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readTextIfExists(file: string): string | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
}

function readRegistryEntryManifestVersion(entryName: string): string | undefined {
  try {
    const manifestPath = path.join(registryEntryCachePath(entryName), "MANIFEST.json");
    if (!fs.existsSync(manifestPath)) return undefined;
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      pack_version?: string;
      version?: string;
      source_ref?: string;
      generated_at?: string;
    };
    return raw.pack_version ?? raw.version ?? raw.source_ref ?? raw.generated_at;
  } catch {
    return undefined;
  }
}
