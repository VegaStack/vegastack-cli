import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bundleDir,
  bundleManifestPath,
  bundleVersionFile,
  claudePluginDir,
  codexAgentsMdPath,
  codexSkillDir,
  cursorRulePath,
  geminiContextPath,
  geminiExtensionPath,
} from "../../src/lib/paths.js";

const ENV_KEY = "VEGASTACK_BUNDLE_DIR";
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});
afterEach(() => {
  if (originalEnv !== undefined) process.env[ENV_KEY] = originalEnv;
  else delete process.env[ENV_KEY];
});

describe("bundleDir", () => {
  it("defaults to ~/.config/vegastack/bundle", () => {
    const dir = bundleDir();
    expect(dir).toMatch(/[\\/]\.config[\\/]vegastack[\\/]bundle$/);
  });

  it("respects VEGASTACK_BUNDLE_DIR override", () => {
    process.env[ENV_KEY] = "/tmp/custom-bundle";
    expect(bundleDir()).toBe("/tmp/custom-bundle");
  });
});

describe("bundle paths", () => {
  it("manifest path lives inside bundle dir", () => {
    expect(bundleManifestPath()).toBe(path.join(bundleDir(), "MANIFEST.json"));
  });
  it("version file lives inside bundle dir", () => {
    expect(bundleVersionFile()).toBe(path.join(bundleDir(), ".version"));
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
    expect(cursorRulePath(cwd)).toBe(
      path.join(cwd, ".cursor", "rules", "vegastack-cli.mdc"),
    );
  });

  it("gemini extension and context are at project root", () => {
    const cwd = "/tmp/proj";
    expect(geminiExtensionPath(cwd)).toBe(path.join(cwd, "gemini-extension.json"));
    expect(geminiContextPath(cwd)).toBe(path.join(cwd, "CONTEXT.md"));
  });
});
