// Regression-prevention tests for the 0.1.13 OSS-readiness pass:
//
//   - the legacy `ALL_AGENTS` registry stays removed from src/agents/index.ts
//   - shipped per-host templates live under skills/vegastack/templates/
//   - pkg* helpers in src/lib/paths.ts resolve into the templates/ dir
//   - references/skills.md enumerates exactly the same hosts as ALL_RENDERER_NAMES
//   - package.json description and gemini-extension.json version stay in sync
//   - GET_STARTED.md / STYLE.md / CONTEXT.md do not reappear at the repo root

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { ALL_RENDERER_NAMES } from "../../src/agents/index.js";
import { pkgAgentsMd, pkgCursorRule, pkgGeminiExtension } from "../../src/lib/paths.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("ALL_AGENTS legacy registry is gone", () => {
  it("src/agents/index.ts does not export ALL_AGENTS, ALL_AGENT_NAMES, or getAgent", () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, "src", "agents", "index.ts"), "utf8");
    expect(text).not.toMatch(/export const ALL_AGENTS\b/);
    expect(text).not.toMatch(/export const ALL_AGENT_NAMES\b/);
    expect(text).not.toMatch(/export function getAgent\b/);
  });

  it("ALL_RENDERERS is the canonical 6-agent list", () => {
    expect(ALL_RENDERER_NAMES).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "gemini",
      "continue",
      "aider",
    ]);
  });
});

describe("skills/vegastack/templates/ holds the shipped per-host artifacts", () => {
  const templatesDir = path.join(REPO_ROOT, "skills", "vegastack", "templates");

  it("contains the per-host templates", () => {
    expect(fs.existsSync(path.join(templatesDir, "cursor-rule.mdc"))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "gemini-extension.json"))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "AGENTS.md"))).toBe(true);
  });

  it("does not leak the legacy gemini-context template (legacy installer was removed)", () => {
    expect(fs.existsSync(path.join(templatesDir, "gemini-context.md"))).toBe(false);
  });

  it("pkg* helpers resolve into templates/", () => {
    expect(pkgCursorRule()).toBe(path.join(templatesDir, "cursor-rule.mdc"));
    expect(pkgGeminiExtension()).toBe(path.join(templatesDir, "gemini-extension.json"));
    expect(pkgAgentsMd()).toBe(path.join(templatesDir, "AGENTS.md"));
  });

  it("the shipped templates do not reside at repo root anymore", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "cursor-rule.mdc"))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "gemini-extension.json"))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "CONTEXT.md"))).toBe(false);
  });
});

describe("references/skills.md host list matches ALL_RENDERER_NAMES", () => {
  it("every supported host is named in references/skills.md", () => {
    const text = fs.readFileSync(
      path.join(REPO_ROOT, "skills", "vegastack", "references", "skills.md"),
      "utf8",
    );
    for (const name of ALL_RENDERER_NAMES) {
      expect(text).toContain(`\`${name}\``);
    }
  });
});

describe("package.json metadata", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    version: string;
    description: string;
    files: string[];
    keywords: string[];
  };

  it("description names every supported agent", () => {
    expect(pkg.description).toContain("Claude Code");
    expect(pkg.description).toContain("Codex");
    expect(pkg.description).toContain("Cursor");
    expect(pkg.description).toContain("Gemini");
    expect(pkg.description).toContain("Continue");
    expect(pkg.description).toContain("Aider");
  });

  it("keywords no longer carry the unused openclaw/hermes tokens", () => {
    expect(pkg.keywords).not.toContain("openclaw");
    expect(pkg.keywords).not.toContain("hermes");
  });

  it("files allowlist no longer ships the moved/renamed root files", () => {
    expect(pkg.files).not.toContain("AGENTS.md");
    expect(pkg.files).not.toContain("CONTEXT.md");
    expect(pkg.files).not.toContain("cursor-rule.mdc");
    expect(pkg.files).not.toContain("gemini-extension.json");
    expect(pkg.files).not.toContain("GET_STARTED.md");
    expect(pkg.files).toContain("GETTING_STARTED.md");
    expect(pkg.files).toContain("GEMINI.md");
  });

  it("gemini-extension.json version matches package.json version", () => {
    const ext = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "skills", "vegastack", "templates", "gemini-extension.json"),
        "utf8",
      ),
    ) as { version: string };
    expect(ext.version).toBe(pkg.version);
  });
});

describe("renamed root docs", () => {
  it("GET_STARTED.md is gone, GETTING_STARTED.md is present", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "GET_STARTED.md"))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "GETTING_STARTED.md"))).toBe(true);
  });

  it("STYLE.md is gone, STYLEGUIDE.md is present", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "STYLE.md"))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "STYLEGUIDE.md"))).toBe(true);
  });

  it("CONTEXT.md is gone, GEMINI.md is present", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "CONTEXT.md"))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "GEMINI.md"))).toBe(true);
  });
});

describe("SKILL.md Node engine line matches package.json", () => {
  it("SKILL.md says Node >=20", () => {
    const skill = fs.readFileSync(path.join(REPO_ROOT, "skills", "vegastack", "SKILL.md"), "utf8");
    expect(skill).toContain("Requires Node >=20");
    expect(skill).not.toContain("Requires Node >=18");
  });
});
