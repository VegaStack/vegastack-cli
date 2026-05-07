import * as fs from "node:fs";
import * as path from "node:path";
import {
  registryCacheRoot,
  registryEntryDir,
  projectConfigPath,
  projectVegaStackDir,
  sharedInstructionsDir,
} from "./paths.js";
import { writeProjectConfig, type VegaStackProjectConfig } from "./project-config.js";

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
    projectConfig: string;
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
  {
    name: "cloudflare",
    title: "Cloudflare",
    shape: "edge-platform+cli-reference",
    status: "available",
    description:
      "Cloudflare developer docs for Workers, Wrangler, Pages, R2, D1, KV, Durable Objects, and platform operations.",
    detects: ["wrangler.toml", "wrangler.json", "wrangler.jsonc", ".dev.vars"],
    source: "https://developers.cloudflare.com/",
  },
  {
    name: "vercel",
    title: "Vercel",
    shape: "deploy-platform+cli-reference",
    status: "available",
    description:
      "Vercel docs for projects, deployments, builds, CLI, environment variables, and framework integrations.",
    detects: ["vercel.json", ".vercel/project.json"],
    source: "https://vercel.com/docs",
  },
  plannedPack("gitlab-ci", "GitLab CI", "ci-yaml", [".gitlab-ci.yml"]),
  plannedPack("circleci", "CircleCI", "ci-yaml", [".circleci/config.yml"]),
  plannedPack("buildkite", "Buildkite", "ci-yaml", [".buildkite/pipeline.yml"]),
  plannedPack("azure-pipelines", "Azure Pipelines", "ci-yaml", ["azure-pipelines.yml"]),
  plannedPack("bitbucket-pipelines", "Bitbucket Pipelines", "ci-yaml", ["bitbucket-pipelines.yml"]),
  plannedPack("travis-ci", "Travis CI", "ci-yaml", [".travis.yml"]),
  plannedPack("drone-ci", "Drone CI", "ci-yaml", [".drone.yml"]),
  plannedPack("google-cloud-build", "Google Cloud Build", "ci-yaml", ["cloudbuild.yaml"]),
  plannedPack("ansible", "Ansible", "configuration-management", [
    "ansible.cfg",
    "playbook.yaml",
    "roles/",
  ]),
  plannedPack("pulumi", "Pulumi", "iac-sdk", ["Pulumi.yaml"]),
  plannedPack("cloudformation", "AWS CloudFormation", "iac-template", [
    "AWSTemplateFormatVersion",
    "Resources",
  ]),
  plannedPack("serverless-framework", "Serverless Framework", "serverless-yaml", [
    "serverless.yml",
  ]),
  plannedPack("netlify", "Netlify", "deploy-platform", ["netlify.toml", "_redirects", "_headers"]),
  plannedPack("aws-sam", "AWS SAM", "serverless-template", ["template.yaml", "samconfig.toml"]),
  plannedPack("aws-cdk", "AWS CDK", "iac-sdk", ["cdk.json"]),
  plannedPack("opentofu", "OpenTofu", "iac-hcl", ["*.tofu", "*.tofu.json"]),
  plannedPack("terragrunt", "Terragrunt", "iac-hcl", ["terragrunt.hcl"]),
  plannedPack("packer", "Packer", "image-build-hcl", ["*.pkr.hcl"]),
  plannedPack("nomad", "Nomad", "scheduler-hcl", ["*.nomad", "*.nomad.hcl"]),
  plannedPack("kustomize", "Kustomize", "kubernetes-overlay", ["kustomization.yaml"]),
  plannedPack("argo-cd", "Argo CD", "gitops-yaml", ["kind: Application"]),
  plannedPack("flux", "Flux", "gitops-yaml", ["toolkit.fluxcd.io"]),
  plannedPack("skaffold", "Skaffold", "kubernetes-dev-yaml", ["skaffold.yaml"]),
  plannedPack("tilt", "Tilt", "kubernetes-dev", ["Tiltfile"]),
  plannedPack("devcontainer", "Dev Containers", "container-dev-env", [
    ".devcontainer/devcontainer.json",
  ]),
  plannedPack("nix", "Nix", "reproducible-builds", ["flake.nix", "default.nix"]),
  plannedPack("bazel", "Bazel", "build-system", ["MODULE.bazel", "WORKSPACE"]),
]);

function plannedPack(
  name: string,
  title: string,
  shape: string,
  detects: readonly string[],
): PackDefinition {
  return {
    name,
    title,
    shape,
    status: "planned",
    description: `${title} repository signals detected. VegaStack Registry coverage is planned.`,
    detects,
    source: "planned VegaStack Registry pack",
  };
}

const IGNORE_DIRS = new Set([
  ".git",
  ".vegastack",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  "exports",
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
      projectConfig: projectConfigPath(cwd),
    },
    registryCacheRoot: registryCacheRoot(),
  };
}

export function writeInitFiles(plan: InitPlan): void {
  const root = plan.scan.root;
  fs.mkdirSync(registryCacheRoot(), { recursive: true });
  cleanupOldProjectFiles(root);

  const registryEntries = Object.fromEntries(
    plan.selected.map((p) => {
      const version = readRegistryEntryManifestVersion(p.name) ?? p.version;
      return [
        p.name,
        {
          ...(version ? { version } : {}),
          cache_path: registryEntryCachePath(p.name),
          source: p.source,
        },
      ];
    }),
  );
  const projectConfig: VegaStackProjectConfig = {
    schema_version: 1,
    registry: {
      entries: registryEntries,
      recommended_entries: plan.selected.map((entry) => entry.name).sort(),
    },
    agents: {
      shared_instructions: "~/.vegastack/instructions",
    },
  };
  writeProjectConfig(root, projectConfig);

  writeSharedInstructionFiles();
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
  const fileList = [...files];
  if (pack.name === "docker") reasons.push(...detectDockerSignals(fileList));
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
      /(^|\/)(Dockerfile|Containerfile|Dockerfile\.[^/]+|compose\.[^/]+\.ya?ml|docker-compose\.[^/]+\.ya?ml)$/.test(
        f,
      )
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
    if (pack.name === "github-actions" && f === ".github/dependabot.yml") {
      reasons.push(f);
    }
    if (pack.name === "kubernetes" && /\.(ya?ml)$/.test(f)) {
      const full = path.join(cwd, f);
      const raw = readTextIfExists(full);
      if (
        raw &&
        /\bkind:\s*(Deployment|Service|StatefulSet|DaemonSet|ReplicaSet|Ingress|ConfigMap|Secret|CronJob|Job|Namespace|PersistentVolume|PersistentVolumeClaim|ServiceAccount|Role|ClusterRole|RoleBinding|ClusterRoleBinding|HorizontalPodAutoscaler)\b/.test(
          raw,
        )
      ) {
        reasons.push(f);
      }
    }
    for (const detector of PLANNED_DETECTORS) {
      if (pack.name === detector.name && detector.match(f, cwd)) reasons.push(f);
    }
  }
  return [...new Set(reasons)].slice(0, 8);
}

interface PlannedDetector {
  name: string;
  match: (file: string, cwd: string) => boolean;
}

const PLANNED_DETECTORS: readonly PlannedDetector[] = [
  exactDetector("gitlab-ci", [".gitlab-ci.yml", ".gitlab-ci.yaml"]),
  exactDetector("circleci", [".circleci/config.yml", ".circleci/config.yaml"]),
  exactDetector("buildkite", [
    ".buildkite/pipeline.yml",
    ".buildkite/pipeline.yaml",
    "buildkite.yml",
    "buildkite.yaml",
  ]),
  exactDetector("azure-pipelines", [
    "azure-pipelines.yml",
    "azure-pipelines.yaml",
    ".azure-pipelines.yml",
    ".azure-pipelines.yaml",
  ]),
  exactDetector("bitbucket-pipelines", ["bitbucket-pipelines.yml", "bitbucket-pipelines.yaml"]),
  exactDetector("travis-ci", [".travis.yml", ".travis.yaml"]),
  exactDetector("drone-ci", [".drone.yml", ".drone.yaml"]),
  exactDetector("google-cloud-build", [
    "cloudbuild.yaml",
    "cloudbuild.yml",
    "cloudbuild.json",
    "clouddeploy.yaml",
    "clouddeploy.yml",
  ]),
  exactDetector("ansible", [
    "ansible.cfg",
    "site.yml",
    "site.yaml",
    "playbook.yml",
    "playbook.yaml",
  ]),
  prefixDetector("ansible", [
    "roles/",
    "playbooks/",
    "group_vars/",
    "host_vars/",
    "inventory/",
    "inventories/",
  ]),
  suffixDetector("ansible", ["/tasks/main.yml", "/tasks/main.yaml", "/handlers/main.yml"]),
  exactDetector("pulumi", ["Pulumi.yaml", "Pulumi.yml"]),
  prefixDetector("pulumi", ["Pulumi."]),
  contentDetector("cloudformation", /\.(ya?ml|json|template)$/i, [
    /\bAWSTemplateFormatVersion\b/,
    /\bResources\s*:\s*\n/,
    /"Resources"\s*:/,
    /\bTransform:\s*AWS::Serverless/,
    /"Transform"\s*:\s*"AWS::Serverless/,
  ]),
  exactDetector("serverless-framework", ["serverless.yml", "serverless.yaml"]),
  exactDetector("aws-sam", ["samconfig.toml"]),
  contentDetector("aws-sam", /\.(ya?ml|json)$/i, [
    /\bTransform:\s*AWS::Serverless/,
    /"Transform"\s*:\s*"AWS::Serverless/,
    /\bAWS::Serverless::/,
  ]),
  exactDetector("aws-cdk", ["cdk.json", "cdk.context.json"]),
  suffixDetector("aws-cdk", [".cdk.json"]),
  suffixDetector("opentofu", [".tofu", ".tofu.json"]),
  exactDetector("terragrunt", ["terragrunt.hcl"]),
  suffixDetector("terragrunt", ["/terragrunt.hcl"]),
  suffixDetector("packer", [".pkr.hcl", ".pkr.json", ".pkrvars.hcl"]),
  suffixDetector("nomad", [".nomad", ".nomad.hcl", ".nomad.json"]),
  exactDetector("kustomize", ["kustomization.yaml", "kustomization.yml", "Kustomization"]),
  suffixDetector("kustomize", ["/kustomization.yaml", "/kustomization.yml", "/Kustomization"]),
  exactDetector("skaffold", ["skaffold.yaml", "skaffold.yml"]),
  exactDetector("tilt", ["Tiltfile", "tiltfile"]),
  exactDetector("devcontainer", [
    ".devcontainer/devcontainer.json",
    ".devcontainer.json",
    "devcontainer.json",
  ]),
  exactDetector("cloudflare", ["wrangler.toml", "wrangler.json", "wrangler.jsonc"]),
  exactDetector("nix", ["flake.nix", "default.nix", "shell.nix"]),
  suffixDetector("nix", [".nix"]),
  exactDetector("bazel", ["MODULE.bazel", "REPO.bazel", "WORKSPACE", "WORKSPACE.bazel"]),
  suffixDetector("bazel", ["/BUILD", "/BUILD.bazel", ".bzl"]),
  contentDetector("argo-cd", /\.(ya?ml)$/i, [
    /\bapiVersion:\s*argoproj\.io\/v1alpha1\b/,
    /\bkind:\s*(Application|ApplicationSet|AppProject)\b/,
  ]),
  contentDetector("flux", /\.(ya?ml)$/i, [
    /\bapiVersion:\s*(source|kustomize|helm|notification|image)\.toolkit\.fluxcd\.io\//,
    /\bkind:\s*(GitRepository|OCIRepository|Bucket|Kustomization|HelmRelease|HelmRepository|ImageRepository|ImagePolicy|ImageUpdateAutomation)\b/,
  ]),
];

function detectDockerSignals(files: readonly string[]): string[] {
  const reasons: string[] = [];
  const byDir = new Map<string, Set<string>>();
  for (const file of files) {
    const base = path.posix.basename(file);
    if (!/^(compose|docker-compose)(\.[^/]+)?\.ya?ml$/.test(base)) continue;
    const dir = path.posix.dirname(file) === "." ? "" : path.posix.dirname(file);
    byDir.set(dir, new Set([...(byDir.get(dir) ?? []), base]));
  }
  const precedence = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
  for (const [dir, names] of byDir) {
    const canonical = precedence.find((name) => names.has(name));
    if (canonical) {
      const full = dir ? `${dir}/${canonical}` : canonical;
      if (names.size > 1) reasons.push(`${full} (Docker Compose preferred file)`);
      else reasons.push(full);
      continue;
    }
    for (const name of [...names].sort()) reasons.push(dir ? `${dir}/${name}` : name);
  }
  return reasons;
}

function exactDetector(name: string, paths: readonly string[]): PlannedDetector {
  const set = new Set(paths);
  return { name, match: (file) => set.has(file) };
}

function prefixDetector(name: string, prefixes: readonly string[]): PlannedDetector {
  return { name, match: (file) => prefixes.some((prefix) => file.startsWith(prefix)) };
}

function suffixDetector(name: string, suffixes: readonly string[]): PlannedDetector {
  return { name, match: (file) => suffixes.some((suffix) => file.endsWith(suffix)) };
}

function contentDetector(
  name: string,
  filePattern: RegExp,
  patterns: readonly RegExp[],
): PlannedDetector {
  return {
    name,
    match: (file, cwd) => {
      if (!filePattern.test(file)) return false;
      const raw = readTextIfExists(path.join(cwd, file));
      return Boolean(raw && patterns.some((pattern) => pattern.test(raw)));
    },
  };
}

function detectPatternMatches(pattern: string, file: string, cwd: string): boolean {
  if (pattern.startsWith("content:")) {
    if (!/\.(ya?ml)$/i.test(file)) return false;
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
    sitemap_url?: unknown;
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
  if (value.type === "web-docs" && typeof value.sitemap_url === "string") return value.sitemap_url;
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

function cleanupOldProjectFiles(root: string): void {
  fs.rmSync(path.join(projectVegaStackDir(root), ".gitignore"), {
    force: true,
  });
  fs.rmSync(path.join(projectVegaStackDir(root), "project.json"), {
    force: true,
  });
  fs.rmSync(path.join(projectVegaStackDir(root), "vegastack-lock.json"), {
    force: true,
  });
  fs.rmSync(path.join(projectVegaStackDir(root), "instructions"), {
    recursive: true,
    force: true,
  });
}

export function writeSharedInstructionFiles(): void {
  fs.mkdirSync(sharedInstructionsDir(), { recursive: true });
  fs.writeFileSync(path.join(sharedInstructionsDir(), "AGENTS.md"), renderAgentInstructions());
  fs.writeFileSync(path.join(sharedInstructionsDir(), "CLAUDE.md"), renderAgentInstructions());
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

function renderAgentInstructions(): string {
  return `# VegaStack Shared Agent Instructions

This shared instruction file is managed by @vegastack/cli.
For project-specific registry entries, detected stack, and security setup, read the current repository's \`.vegastack/vegastack.yml\`.

## Rules

- For ops, cloud, IaC, CI/CD, Kubernetes, Docker, Supabase, or CLI work, run \`vegastack ask "<user request>"\` and use returned citations.
- For exact source lookup or debugging weak evidence, run \`vegastack search --entry <entry> "<literal text>"\`.
- For Terraform-specific work, run \`vegastack ask --entry terraform --tf-provider <provider> "<user request>"\`.
- Do not invent resource names, arguments, import IDs, command flags, workflow keys, or provider behaviors.
- Do not print secrets from .env files, shell history, cloud credentials, CI variables, or local config.
- If a task may modify infrastructure, show the planned change and ask before destructive actions.
- Prefer project-local context from \`.vegastack/vegastack.yml\`.

## Files

- Project config: \`.vegastack/vegastack.yml\`
- Shared instructions directory: \`${sharedInstructionsDir()}\`
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
