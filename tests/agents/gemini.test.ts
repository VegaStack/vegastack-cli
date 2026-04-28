import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gemini } from "../../src/agents/gemini.js";
import { geminiContextPath, geminiExtensionPath } from "../../src/lib/paths.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-gemini-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("gemini installer", () => {
  it("rejects global scope", () => {
    const r = gemini.install({ scope: "global", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/project-scoped/);
  });

  it("install writes both extension config and CONTEXT.md", () => {
    const r = gemini.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(true);
    expect(fs.existsSync(geminiExtensionPath(cwd))).toBe(true);
    expect(fs.existsSync(geminiContextPath(cwd))).toBe(true);
  });

  it("dry-run does not write", () => {
    const r = gemini.install({ scope: "project", cwd, force: false, dryRun: true });
    expect(r.installed).toBe(false);
    expect(fs.existsSync(geminiExtensionPath(cwd))).toBe(false);
  });

  it("preserves existing CONTEXT.md when --force not passed", () => {
    fs.writeFileSync(geminiContextPath(cwd), "# my own notes\n");
    const r = gemini.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.warnings.join(" ")).toMatch(/CONTEXT\.md/);
    expect(fs.readFileSync(geminiContextPath(cwd), "utf8")).toBe("# my own notes\n");
    // Other file may have written if it didn't exist
    expect(r.installed).toBe(false); // not all files written
  });

  it("--force backs up CONTEXT.md before overwriting", () => {
    fs.writeFileSync(geminiContextPath(cwd), "# my notes\n");
    const r = gemini.install({ scope: "project", cwd, force: true, dryRun: false });
    expect(r.installed).toBe(true);
    const backup = fs.readdirSync(cwd).find((f) => f.includes("CONTEXT.md.bak-"));
    expect(backup).toBeDefined();
    if (backup) expect(fs.readFileSync(path.join(cwd, backup), "utf8")).toBe("# my notes\n");
  });

  it("uninstall removes both files", () => {
    gemini.install({ scope: "project", cwd, force: false, dryRun: false });
    gemini.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(geminiExtensionPath(cwd))).toBe(false);
    expect(fs.existsSync(geminiContextPath(cwd))).toBe(false);
  });

  it("status reports partial install correctly", () => {
    fs.writeFileSync(geminiExtensionPath(cwd), "{}");
    const r = gemini.status({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
    expect(r.notes.join(" ")).toMatch(/extension=ok/);
    expect(r.notes.join(" ")).toMatch(/context=missing/);
  });
});
