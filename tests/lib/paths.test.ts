import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudePluginDir,
  cloudflaredMetadataPath,
  cloudflaredToolDir,
  codexAgentsMdPath,
  codexSkillDir,
  cursorRulePath,
  geminiContextPath,
  geminiExtensionPath,
  sharedInstructionsDir,
  projectInstructionsDir,
  projectLockPath,
  projectManifestPath,
  projectVegaStackDir,
  registryCacheRoot,
  terraformEntryDocsDir,
  terraformEntryManifestPath,
} from "../../src/lib/paths.js";

const ENV_KEY = "VEGASTACK_REGISTRY_DIR";
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});
afterEach(() => {
  if (originalEnv !== undefined) process.env[ENV_KEY] = originalEnv;
  else delete process.env[ENV_KEY];
});

describe("terraformEntryDocsDir", () => {
  it("defaults to Terraform docs inside the registry cache", () => {
    const dir = terraformEntryDocsDir();
    expect(dir).toMatch(/[\\/]\.config[\\/]vegastack[\\/]registry[\\/]terraform[\\/]docs$/);
  });

  it("follows VEGASTACK_REGISTRY_DIR", () => {
    process.env[ENV_KEY] = "/tmp/custom-registry";
    expect(terraformEntryDocsDir()).toBe(path.join("/tmp/custom-registry", "terraform", "docs"));
  });
});

describe("Terraform entry paths", () => {
  it("manifest path lives inside Registry pack dir", () => {
    expect(terraformEntryManifestPath()).toBe(path.join(terraformEntryDocsDir(), "MANIFEST.json"));
  });
});

describe("project harness paths", () => {
  it("registry cache defaults to ~/.config/vegastack/registry", () => {
    expect(registryCacheRoot()).toMatch(/[\\/]\.config[\\/]vegastack[\\/]registry$/);
  });

  it("project state lives under .vegastack", () => {
    const cwd = "/tmp/proj";
    expect(projectVegaStackDir(cwd)).toBe(path.join(cwd, ".vegastack"));
    expect(projectManifestPath(cwd)).toBe(path.join(cwd, ".vegastack", "project.json"));
    expect(projectLockPath(cwd)).toBe(path.join(cwd, ".vegastack", "vegastack-lock.json"));
    expect(projectInstructionsDir(cwd)).toBe(path.join(cwd, ".vegastack", "instructions"));
    expect(sharedInstructionsDir()).toMatch(/[\\/]\.config[\\/]vegastack[\\/]instructions$/);
  });

  it("managed cloudflared lives in the shared tools cache", () => {
    expect(cloudflaredToolDir("2026.3.0")).toMatch(
      /[\\/]\.config[\\/]vegastack[\\/]tools[\\/]cloudflared[\\/]2026\.3\.0$/,
    );
    expect(cloudflaredMetadataPath()).toMatch(
      /[\\/]\.config[\\/]vegastack[\\/]tools[\\/]cloudflared[\\/]current\.json$/,
    );
  });
});

describe("agent install paths", () => {
  it("claude plugin dir is global only", () => {
    expect(claudePluginDir()).toMatch(/\.claude[\\/]plugins[\\/]vegastack-cli$/);
  });

  it("codex skill dir uses ~/.agents in global, cwd in project", () => {
    const cwd = "/tmp/my-project";
    const global = codexSkillDir("global", cwd);
    const project = codexSkillDir("project", cwd);
    expect(global).toMatch(/\.agents[\\/]skills[\\/]vegastack$/);
    expect(global).not.toContain(cwd);
    expect(project).toBe(path.join(cwd, ".agents", "skills", "vegastack"));
  });

  it("codex AGENTS.md uses ~/.codex in global, cwd in project", () => {
    const cwd = "/tmp/proj";
    expect(codexAgentsMdPath("global", cwd)).toMatch(/\.codex[\\/]AGENTS\.md$/);
    expect(codexAgentsMdPath("project", cwd)).toBe(path.join(cwd, "AGENTS.md"));
  });

  it("cursor rule path is project-relative", () => {
    const cwd = "/tmp/proj";
    expect(cursorRulePath(cwd)).toBe(path.join(cwd, ".cursor", "rules", "vegastack-cli.mdc"));
  });

  it("gemini extension and context are at project root", () => {
    const cwd = "/tmp/proj";
    expect(geminiExtensionPath(cwd)).toBe(path.join(cwd, "gemini-extension.json"));
    expect(geminiContextPath(cwd)).toBe(path.join(cwd, "CONTEXT.md"));
  });
});
