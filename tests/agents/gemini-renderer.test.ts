// Renderer tests for the modern Gemini CLI extension layout
// (~/.gemini/extensions/<name>/{gemini-extension.json, skills/, commands/}).

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
    expect(fs.existsSync(path.join(root, "commands", "vegastack.toml"))).toBe(true);

    const tomlText = fs.readFileSync(path.join(root, "commands", "vegastack.toml"), "utf8");
    expect(tomlText).toContain("description");
    expect(tomlText).toContain("VegaStack ops router");
    expect(tomlText).toContain("init, ask, scan");

    const extText = fs.readFileSync(path.join(root, "gemini-extension.json"), "utf8");
    expect(extText).toContain("vegastack");
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

  it("install is atomic: a single conflict aborts before any file is written (F-003)", async () => {
    // Pre-populate gemini-extension.json with hand-edited content. The other
    // two target files (SKILL.md, command.toml) are absent. Without --force,
    // the install must refuse to write *anything* — previously it would
    // happily land SKILL.md and command.toml on disk while flagging
    // installed:false, leaving the extension half-built.
    const root = geminiExtensionRoot("project", cwd);
    const extJson = path.join(root, "gemini-extension.json");
    const skillMd = path.join(root, "skills", "vegastack", "SKILL.md");
    const cmdToml = path.join(root, "commands", "vegastack.toml");
    fs.mkdirSync(path.dirname(extJson), { recursive: true });
    fs.writeFileSync(extJson, '{"name":"user-handcrafted"}');

    const r = await geminiRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/--force/);
    // Crucially, the OTHER files were not written.
    expect(fs.existsSync(skillMd)).toBe(false);
    expect(fs.existsSync(cmdToml)).toBe(false);
    // And the user's handcrafted file is untouched.
    expect(fs.readFileSync(extJson, "utf8")).toBe('{"name":"user-handcrafted"}');
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
