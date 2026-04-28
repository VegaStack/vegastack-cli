// Renderer tests for the modern Gemini CLI extension layout
// (~/.gemini-extensions/<name>/{gemini-extension.json, skills/, commands/}).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { geminiRenderer } from "../../src/agents/gemini.js";
import { geminiExtensionRoot } from "../../src/lib/paths.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-gemini-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("gemini renderer", () => {
  it("reports not-installed initially", async () => {
    const r = await geminiRenderer.status({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
  });

  it("dry-run writes nothing", async () => {
    const r = await geminiRenderer.install({ scope: "project", cwd, force: false, dryRun: true });
    expect(r.installed).toBe(false);
    expect(fs.existsSync(geminiExtensionRoot("project", cwd))).toBe(false);
  });

  it("install creates extension config, SKILL.md, and command TOML", async () => {
    const r = await geminiRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);

    const root = geminiExtensionRoot("project", cwd);
    expect(fs.existsSync(path.join(root, "gemini-extension.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "skills", "vegastack", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "commands", "tf.toml"))).toBe(true);

    const tomlText = fs.readFileSync(path.join(root, "commands", "tf.toml"), "utf8");
    expect(tomlText).toContain("description");
    expect(tomlText).toContain("vegastack tf");

    const extText = fs.readFileSync(path.join(root, "gemini-extension.json"), "utf8");
    expect(extText).toContain("vegastack-terraform");
    expect(extText).toContain("mcpServers");
  });

  it("install is idempotent", async () => {
    await geminiRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const r = await geminiRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);
    expect(r.notes.join(" ")).toMatch(/up to date/);
  });

  it("uninstall removes the entire extension dir", async () => {
    await geminiRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const root = geminiExtensionRoot("project", cwd);
    expect(fs.existsSync(root)).toBe(true);

    await geminiRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(root)).toBe(false);

    // Idempotent
    const r = await geminiRenderer.uninstall({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });
});
