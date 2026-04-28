import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codex } from "../../src/agents/codex.js";
import { codexAgentsMdPath, codexSkillDir } from "../../src/lib/paths.js";

let cwd: string;
let homeBackup: string | undefined;
let fakeHome: string;

beforeEach(() => {
  // Sandbox $HOME so we don't trample the real ~/.agents or ~/.codex.
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-codex-home-"));
  homeBackup = process.env.HOME;
  process.env.HOME = fakeHome;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-codex-cwd-"));
});
afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  else delete process.env.HOME;
});

describe("codex installer (project scope)", () => {
  it("install creates the skill dir under cwd/.agents/skills", () => {
    const r = codex.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(true);
    expect(fs.existsSync(codexSkillDir("project", cwd))).toBe(true);
    // Project AGENTS.md must NOT be created automatically.
    expect(fs.existsSync(path.join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("dry-run does not write", () => {
    const r = codex.install({ scope: "project", cwd, force: false, dryRun: true });
    expect(r.installed).toBe(false);
    expect(fs.existsSync(codexSkillDir("project", cwd))).toBe(false);
  });

  it("uninstall is idempotent", () => {
    codex.install({ scope: "project", cwd, force: false, dryRun: false });
    codex.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(codexSkillDir("project", cwd))).toBe(false);

    const r = codex.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });
});

describe("codex installer (global scope)", () => {
  it("install writes ~/.agents/skills/vegastack and ~/.codex/AGENTS.md", () => {
    if (process.platform === "win32") return; // home-sandbox semantics differ
    const r = codex.install({ scope: "global", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(true);
    expect(fs.existsSync(codexSkillDir("global", cwd))).toBe(true);
    expect(fs.existsSync(codexAgentsMdPath("global", cwd))).toBe(true);
  });

  it("--force on AGENTS.md preserves existing content via .bak-", () => {
    if (process.platform === "win32") return;
    const dst = codexAgentsMdPath("global", cwd);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "# user instructions\n");

    codex.install({ scope: "global", cwd, force: true, dryRun: false });

    const dir = path.dirname(dst);
    const backup = fs.readdirSync(dir).find((f) => f.startsWith("AGENTS.md.bak-"));
    expect(backup).toBeDefined();
    if (backup) {
      expect(fs.readFileSync(path.join(dir, backup), "utf8")).toBe("# user instructions\n");
    }
  });

  it("without --force, existing AGENTS.md is preserved with a warning", () => {
    if (process.platform === "win32") return;
    const dst = codexAgentsMdPath("global", cwd);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "# my own\n");

    const r = codex.install({ scope: "global", cwd, force: false, dryRun: false });
    expect(r.warnings.join(" ")).toMatch(/AGENTS\.md/);
    expect(fs.readFileSync(dst, "utf8")).toBe("# my own\n");
  });
});
