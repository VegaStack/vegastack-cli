import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildInitPlan,
  scanProject,
  scanProjectWithPacks,
  writeInitFiles,
  type PackDefinition,
} from "../../src/lib/project.js";
import { projectConfigPath, sharedInstructionsDir } from "../../src/lib/paths.js";
import { readProjectConfig } from "../../src/lib/project-config.js";
import { withTmpDir } from "../setup.js";

const oldEnv = { ...process.env };

afterEach(() => {
  process.env = { ...oldEnv };
});

describe("project harness detection", () => {
  it("detects Terraform, GitHub Actions, Docker, Supabase, Kubernetes, and Helm signals", async () => {
    await withTmpDir((dir) => {
      fs.mkdirSync(path.join(dir, ".git"));
      fs.writeFileSync(path.join(dir, "main.tf"), 'resource "aws_s3_bucket" "x" {}\n');
      fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".github", "workflows", "ci.yml"), "name: ci\n");
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22\n");
      fs.mkdirSync(path.join(dir, "supabase"), { recursive: true });
      fs.writeFileSync(path.join(dir, "supabase", "config.toml"), "[project]\n");
      fs.writeFileSync(
        path.join(dir, "deployment.yaml"),
        "apiVersion: apps/v1\nkind: Deployment\n",
      );
      fs.writeFileSync(path.join(dir, "Chart.yaml"), "apiVersion: v2\nname: app\n");

      const scan = scanProject(dir);
      expect(scan.git).toBe(true);
      expect(scan.detected.map((p) => p.name).sort()).toEqual([
        "docker",
        "github-actions",
        "helm",
        "kubernetes",
        "supabase",
        "terraform",
      ]);
      expect(scan.detected.find((p) => p.name === "terraform")?.selected).toBe(true);
      expect(scan.detected.find((p) => p.name === "docker")?.selected).toBe(true);
    });
  });

  it("detects dynamically supplied registry packs such as Jenkins", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, "Jenkinsfile"), "pipeline { agent any }\n");
      const packs: PackDefinition[] = [
        {
          name: "jenkins",
          title: "Jenkins",
          shape: "ci-server+pipeline-docs",
          status: "available",
          description: "Jenkins docs.",
          detects: ["Jenkinsfile", "**/Jenkinsfile"],
          source: "https://cli-registry.vegastack.com/cli",
        },
      ];

      const scan = scanProjectWithPacks(dir, packs);

      expect(scan.detected).toMatchObject([
        {
          name: "jenkins",
          title: "Jenkins",
          shape: "ci-server+pipeline-docs",
          source: "https://cli-registry.vegastack.com/cli",
          selected: true,
          reasons: ["Jenkinsfile"],
        },
      ]);
    });
  });

  it("detects broad ops and CI sources as planned packs without selecting them", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, ".gitlab-ci.yml"), "stages: [test]\n");
      fs.mkdirSync(path.join(dir, ".circleci"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".circleci", "config.yml"), "version: 2.1\n");
      fs.writeFileSync(path.join(dir, "terragrunt.hcl"), 'terraform { source = "./module" }\n');
      fs.writeFileSync(path.join(dir, "Pulumi.yaml"), "name: app\nruntime: nodejs\n");
      fs.writeFileSync(
        path.join(dir, "template.yaml"),
        "AWSTemplateFormatVersion: '2010-09-09'\nResources: {}\n",
      );
      fs.writeFileSync(path.join(dir, "serverless.yml"), "service: app\n");
      fs.writeFileSync(path.join(dir, "cdk.json"), "{}\n");
      fs.writeFileSync(path.join(dir, "app.pkr.hcl"), "packer {}\n");
      fs.writeFileSync(path.join(dir, "app.nomad.hcl"), 'job "app" {}\n');
      fs.writeFileSync(path.join(dir, "kustomization.yaml"), "resources: []\n");
      fs.writeFileSync(path.join(dir, "skaffold.yaml"), "apiVersion: skaffold/v4beta1\n");
      fs.writeFileSync(path.join(dir, "Tiltfile"), "# tilt\n");
      fs.writeFileSync(path.join(dir, "cloudbuild.yaml"), "steps: []\n");
      fs.mkdirSync(path.join(dir, ".devcontainer"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".devcontainer", "devcontainer.json"), "{}\n");
      fs.writeFileSync(path.join(dir, "wrangler.toml"), 'name = "worker"\n');
      fs.writeFileSync(path.join(dir, "flake.nix"), "{ outputs = { self }: {}; }\n");
      fs.writeFileSync(path.join(dir, "MODULE.bazel"), 'module(name = "app")\n');

      const scan = scanProject(dir);
      const detected = new Map(scan.detected.map((p) => [p.name, p]));

      for (const name of [
        "gitlab-ci",
        "circleci",
        "google-cloud-build",
        "terragrunt",
        "pulumi",
        "cloudformation",
        "serverless-framework",
        "aws-cdk",
        "packer",
        "nomad",
        "kustomize",
        "skaffold",
        "tilt",
        "devcontainer",
        "nix",
        "bazel",
      ]) {
        expect(detected.get(name)?.status).toBe("planned");
        expect(detected.get(name)?.selected).toBe(false);
      }
      expect(detected.get("cloudflare")?.status).toBe("available");
      expect(detected.get("cloudflare")?.selected).toBe(true);
    });
  });

  it("uses Docker Compose canonical file precedence in detection reasons", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, "compose.yaml"), "services: {}\n");
      fs.writeFileSync(path.join(dir, "docker-compose.yml"), "services: {}\n");

      const docker = scanProject(dir).detected.find((p) => p.name === "docker");

      expect(docker?.reasons[0]).toBe("compose.yaml (Docker Compose preferred file)");
      expect(docker?.selected).toBe(true);
    });
  });

  it("does not detect Kubernetes from README examples or exported agent sessions", async () => {
    await withTmpDir((dir) => {
      fs.mkdirSync(path.join(dir, ".git"));
      fs.writeFileSync(
        path.join(dir, "README.md"),
        'Example only: `vegastack search --entry kubernetes "kind: Deployment"`\n',
      );
      fs.mkdirSync(path.join(dir, "exports"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "exports", "codex-session.json"),
        JSON.stringify({ text: "apiVersion: apps/v1\nkind: Deployment\n" }),
      );

      const scan = scanProject(dir);

      expect(scan.detected.some((p) => p.name === "kubernetes")).toBe(false);
    });
  });
});

describe("project harness init files", () => {
  it("writes committed vegastack.yml state and shared instructions", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home", ".vegastack");
      fs.mkdirSync(path.join(dir, ".git"));
      fs.writeFileSync(path.join(dir, "main.tf"), "terraform {}\n");

      const plan = buildInitPlan(dir);
      writeInitFiles(plan);

      expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
      expect(fs.existsSync(path.join(dir, ".vegastack", ".gitignore"))).toBe(false);
      expect(fs.existsSync(path.join(dir, ".vegastack", "project.json"))).toBe(false);
      const project = readProjectConfig(dir);
      const raw = fs.readFileSync(projectConfigPath(dir), "utf8");
      expect(raw).toContain("registry:");
      expect(raw).toContain("terraform:");
      expect(project.schema_version).toBe(1);
      expect(project.registry?.entries?.terraform).toBeDefined();
      expect(fs.existsSync(path.join(dir, ".vegastack", "vegastack-lock.json"))).toBe(false);
      expect(fs.existsSync(path.join(dir, ".vegastack", "instructions"))).toBe(false);
      expect(fs.readFileSync(path.join(sharedInstructionsDir(), "AGENTS.md"), "utf8")).toContain(
        'vegastack ask "<user request>"',
      );
    });
  });

  it("writes dynamic registry pack source and shape into .vegastack state", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home", ".vegastack");
      fs.writeFileSync(path.join(dir, "Jenkinsfile"), "pipeline { agent any }\n");
      const packs: PackDefinition[] = [
        {
          name: "jenkins",
          title: "Jenkins",
          shape: "ci-server+pipeline-docs",
          status: "available",
          description: "Jenkins docs.",
          detects: ["Jenkinsfile"],
          source: "https://cli-registry.vegastack.com/cli",
        },
      ];

      const plan = buildInitPlan(dir, undefined, packs);
      writeInitFiles(plan);

      const project = readProjectConfig(dir);
      expect(project.registry?.entries?.jenkins?.source).toBe(
        "https://cli-registry.vegastack.com/cli",
      );
    });
  });
});
