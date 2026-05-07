import * as fs from "node:fs";
import * as path from "node:path";
import type { CanonicalScanCategory } from "./config.js";

export interface ScanDetection {
  checks: Partial<Record<CanonicalScanCategory, boolean>>;
  reasons: Partial<Record<CanonicalScanCategory, string[]>>;
}

export function detectScanChecks(cwd: string): ScanDetection {
  const reasons: Partial<Record<CanonicalScanCategory, string[]>> = {};
  const add = (check: CanonicalScanCategory, reason: string) => {
    reasons[check] = [...(reasons[check] ?? []), reason];
  };

  if (fs.existsSync(path.join(cwd, ".git"))) add("secrets", ".git directory");
  if (fs.existsSync(path.join(cwd, ".github", "workflows"))) add("actions", ".github/workflows");
  for (const file of [
    ".gitlab-ci.yml",
    ".gitlab-ci.yaml",
    ".circleci/config.yml",
    ".circleci/config.yaml",
    ".buildkite/pipeline.yml",
    ".buildkite/pipeline.yaml",
    "azure-pipelines.yml",
    "azure-pipelines.yaml",
    "bitbucket-pipelines.yml",
    "bitbucket-pipelines.yaml",
    ".travis.yml",
    ".travis.yaml",
    ".drone.yml",
    ".drone.yaml",
    "cloudbuild.yaml",
    "cloudbuild.yml",
    "cloudbuild.json",
    "clouddeploy.yaml",
    "clouddeploy.yml",
    "Jenkinsfile",
  ]) {
    if (fs.existsSync(path.join(cwd, file))) add("iac", file);
  }
  for (const file of [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "npm-shrinkwrap.json",
  ]) {
    if (fs.existsSync(path.join(cwd, file))) add("dependencies", file);
  }
  for (const file of [
    "Dockerfile",
    "Containerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ]) {
    if (fs.existsSync(path.join(cwd, file))) {
      add("containers", file);
      add("iac", file);
    }
  }
  for (const dir of ["k8s", "kubernetes", "deploy", "deployment", "manifests", "charts", "helm"]) {
    if (fs.existsSync(path.join(cwd, dir))) {
      add("kubernetes", dir);
      add("iac", dir);
    }
  }
  for (const file of [
    "terragrunt.hcl",
    "Pulumi.yaml",
    "Pulumi.yml",
    "serverless.yml",
    "serverless.yaml",
    "samconfig.toml",
    "cdk.json",
    "cdk.context.json",
    "ansible.cfg",
    "site.yml",
    "site.yaml",
    "playbook.yml",
    "playbook.yaml",
    "kustomization.yaml",
    "kustomization.yml",
    "skaffold.yaml",
    "skaffold.yml",
    "Tiltfile",
    "wrangler.toml",
    "wrangler.json",
    "wrangler.jsonc",
    ".devcontainer/devcontainer.json",
    ".devcontainer.json",
    "devcontainer.json",
    "flake.nix",
    "default.nix",
    "shell.nix",
    "MODULE.bazel",
    "REPO.bazel",
    "WORKSPACE",
    "WORKSPACE.bazel",
  ]) {
    if (fs.existsSync(path.join(cwd, file))) add("iac", file);
  }
  if (hasAnyFile(cwd, (file) => file.endsWith(".tf") || file.endsWith(".tf.json")))
    add("iac", "*.tf");
  if (hasAnyFile(cwd, (file) => file.endsWith(".tofu") || file.endsWith(".tofu.json")))
    add("iac", "*.tofu");
  if (hasAnyFile(cwd, (file) => file.endsWith(".pkr.hcl") || file.endsWith(".pkr.json")))
    add("iac", "*.pkr.hcl");
  if (hasAnyFile(cwd, (file) => file.endsWith(".nomad") || file.endsWith(".nomad.hcl")))
    add("iac", "*.nomad");

  return {
    checks: Object.fromEntries(Object.keys(reasons).map((key) => [key, true])) as Partial<
      Record<CanonicalScanCategory, boolean>
    >,
    reasons,
  };
}

function hasAnyFile(cwd: string, predicate: (file: string) => boolean): boolean {
  try {
    return fs.readdirSync(cwd).some(predicate);
  } catch {
    return false;
  }
}
