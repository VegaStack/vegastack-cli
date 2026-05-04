import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInitPlan,
  scanProject,
  scanProjectWithPacks,
  writeInitFiles,
  type PackDefinition,
} from "../../src/lib/project.js";
import { withTmpDir } from "../setup.js";

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
});

describe("project harness init files", () => {
  it("writes ignored .vegastack state and project instructions", async () => {
    await withTmpDir((dir) => {
      fs.mkdirSync(path.join(dir, ".git"));
      fs.writeFileSync(path.join(dir, "main.tf"), "terraform {}\n");

      const plan = buildInitPlan(dir);
      writeInitFiles(plan);

      expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
      expect(fs.readFileSync(path.join(dir, ".vegastack", ".gitignore"), "utf8")).toBe("*\n");
      const project = JSON.parse(
        fs.readFileSync(path.join(dir, ".vegastack", "project.json"), "utf8"),
      ) as {
        schema_version: number;
        registry_entries: Record<string, unknown>;
      };
      expect(project.schema_version).toBe(1);
      expect(project.registry_entries.terraform).toBeDefined();
      expect(fs.existsSync(path.join(dir, ".vegastack", "instructions"))).toBe(true);
      expect(fs.readFileSync(plan.files.instructions[0] ?? "", "utf8")).toContain(
        'vegastack ask "<user request>"',
      );
      expect(fs.existsSync(path.join(dir, ".vegastack", "vegastack-lock.json"))).toBe(true);
    });
  });

  it("writes dynamic registry pack source and shape into .vegastack state", async () => {
    await withTmpDir((dir) => {
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

      const project = JSON.parse(
        fs.readFileSync(path.join(dir, ".vegastack", "project.json"), "utf8"),
      ) as {
        registry_entries: Record<string, { source?: string }>;
      };
      const lock = JSON.parse(
        fs.readFileSync(path.join(dir, ".vegastack", "vegastack-lock.json"), "utf8"),
      ) as {
        registry_entries: Record<string, { source?: string }>;
      };
      expect(project.registry_entries.jenkins?.source).toBe(
        "https://cli-registry.vegastack.com/cli",
      );
      expect(lock.registry_entries.jenkins?.source).toBe("https://cli-registry.vegastack.com/cli");
    });
  });
});
