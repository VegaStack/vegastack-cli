import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cursor } from "../../src/agents/cursor.js";
import { cursorRulePath } from "../../src/lib/paths.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vega-cursor-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("cursor installer", () => {
  it("reports not-installed initially", () => {
    const r = cursor.status({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
  });

  it("rejects global scope with a clear warning", () => {
    const r = cursor.install({ scope: "global", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/project-scoped/);
  });

  it("dry-run does not write", () => {
    const r = cursor.install({ scope: "project", cwd, force: false, dryRun: true });
    expect(r.installed).toBe(false);
    expect(r.notes.join(" ")).toMatch(/would copy/);
    expect(fs.existsSync(cursorRulePath(cwd))).toBe(false);
  });

  it("install creates the rule file", () => {
    const r = cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(true);
    expect(fs.existsSync(cursorRulePath(cwd))).toBe(true);
  });

  it("re-install without --force warns and leaves the file alone", () => {
    cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    const before = fs.readFileSync(cursorRulePath(cwd), "utf8");

    // Mutate the file to simulate user customization.
    fs.writeFileSync(cursorRulePath(cwd), "# user-edited\n");
    const r = cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/--force/);
    // User edit is preserved.
    expect(fs.readFileSync(cursorRulePath(cwd), "utf8")).toBe("# user-edited\n");
    // Sanity: the original install did write the canonical rule.
    expect(before).toContain("vegastack-terraform");
  });

  it("re-install with byte-identical content is idempotent (no warning, no --force needed)", () => {
    // First install writes the canonical rule.
    const first = cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(first.installed).toBe(true);
    const dest = cursorRulePath(cwd);
    const before = fs.readFileSync(dest, "utf8");
    const beforeMtime = fs.statSync(dest).mtimeMs;

    // Second install with NO change to disk and NO --force flag:
    // expect installed=true, no warnings, byte-identical note.
    const second = cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(second.installed).toBe(true);
    expect(second.warnings).toEqual([]);
    expect(second.notes.join(" ")).toMatch(/byte-identical|up to date/);
    // File content unchanged and no rewrite happened.
    expect(fs.readFileSync(dest, "utf8")).toBe(before);
    expect(fs.statSync(dest).mtimeMs).toBe(beforeMtime);
  });

  it("--force backs up the existing file before overwriting", () => {
    cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    fs.writeFileSync(cursorRulePath(cwd), "# user-edited\n");

    const r = cursor.install({ scope: "project", cwd, force: true, dryRun: false });
    expect(r.installed).toBe(true);

    // Find the .bak-* file
    const dir = path.dirname(cursorRulePath(cwd));
    const backup = fs.readdirSync(dir).find((f) => f.includes(".bak-"));
    expect(backup).toBeDefined();
    if (backup) {
      expect(fs.readFileSync(path.join(dir, backup), "utf8")).toBe("# user-edited\n");
    }
  });

  it("uninstall removes the rule and is idempotent", () => {
    cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(cursorRulePath(cwd))).toBe(true);

    cursor.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(cursorRulePath(cwd))).toBe(false);

    // Idempotent — second uninstall is a no-op.
    const r = cursor.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });

  it("status correctly toggles after install/uninstall", () => {
    expect(cursor.status({ scope: "project", cwd, force: false, dryRun: false }).installed).toBe(
      false,
    );
    cursor.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(cursor.status({ scope: "project", cwd, force: false, dryRun: false }).installed).toBe(
      true,
    );
    cursor.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(cursor.status({ scope: "project", cwd, force: false, dryRun: false }).installed).toBe(
      false,
    );
  });
});
