// Type-shape coverage for AgentRenderer + CanonicalSkill. Validates that
// the SKILL.md frontmatter parser populates name/description/allowedTools and
// preserves the SKILL.md `metadata:` sub-block.

import { describe, expect, it } from "vitest";
import { parseSkill } from "../../src/agents/skill-source.js";
import { ALL_RENDERER_NAMES, getRenderer } from "../../src/agents/index.js";

describe("CanonicalSkill parser", () => {
  it("parses a minimal SKILL.md with required fields only", () => {
    const md = ["---", "name: test-skill", "description: A test skill.", "---", "# body"].join(
      "\n",
    );
    const skill = parseSkill(md);
    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill.");
    expect(skill.allowedTools).toEqual([]);
    expect(skill.body).toContain("# body");
  });

  it("parses a folded description block", () => {
    const md = [
      "---",
      "name: test",
      "description: |",
      "  Use when something happens.",
      "  Do not use otherwise.",
      "---",
      "",
    ].join("\n");
    const skill = parseSkill(md);
    expect(skill.description).toContain("Use when something happens.");
    expect(skill.description).toContain("Do not use otherwise.");
  });

  it("parses allowed-tools as space-separated scalar", () => {
    const md = [
      "---",
      "name: test",
      "description: A test.",
      "allowed-tools: Bash(vega:*) Bash(jq:*) Read Grep Glob",
      "---",
      "",
    ].join("\n");
    const skill = parseSkill(md);
    expect(skill.allowedTools).toContain("Bash(vega:*)");
    expect(skill.allowedTools).toContain("Read");
    expect(skill.allowedTools).toContain("Glob");
  });

  it("parses nested metadata block", () => {
    const md = [
      "---",
      "name: test",
      "description: A test.",
      "metadata:",
      "  homepage: https://example.com",
      "  schema_version: \"1\"",
      "---",
      "",
    ].join("\n");
    const skill = parseSkill(md);
    expect(skill.metadata.metadata).toBeDefined();
    const sub = skill.metadata.metadata as Record<string, unknown>;
    expect(sub.homepage).toBe("https://example.com");
    expect(sub.schema_version).toBe("1");
  });

  it("rejects SKILL.md without name", () => {
    const md = ["---", "description: x", "---", ""].join("\n");
    expect(() => parseSkill(md)).toThrow(/name/);
  });

  it("rejects SKILL.md without description", () => {
    const md = ["---", "name: x", "---", ""].join("\n");
    expect(() => parseSkill(md)).toThrow(/description/);
  });

  it("rejects SKILL.md without frontmatter fences", () => {
    expect(() => parseSkill("# just markdown")).toThrow(/frontmatter/);
  });
});

describe("AgentRenderer registry", () => {
  it("exposes all six v0.1 agents", () => {
    expect([...ALL_RENDERER_NAMES].sort()).toEqual([
      "aider",
      "claude-code",
      "codex",
      "continue",
      "cursor",
      "gemini",
    ]);
  });

  it("each renderer has consistent name + supportsScope methods", () => {
    for (const name of ALL_RENDERER_NAMES) {
      const r = getRenderer(name);
      expect(r).toBeDefined();
      if (!r) continue;
      expect(r.name).toBe(name);
      // every renderer supports at least one scope
      const ok = r.supportsScope("global") || r.supportsScope("project");
      expect(ok).toBe(true);
    }
  });
});
