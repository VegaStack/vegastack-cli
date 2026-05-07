// Renderer tests for Aider. Validates the CONVENTIONS file write, the
// .aider.conf.yml read[] patch, idempotency, and uninstall cleanup.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiderRenderer } from "../../src/agents/aider.js";
import { aiderConfPath, aiderConventionsPath } from "../../src/lib/paths.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-aider-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("aider renderer", () => {
  it("reports not-installed initially", async () => {
    const r = await aiderRenderer.status({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
  });

  it("dry-run writes nothing", async () => {
    const r = await aiderRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: true,
    });
    expect(r.installed).toBe(false);
    expect(fs.existsSync(aiderConventionsPath("project", cwd))).toBe(false);
    expect(fs.existsSync(aiderConfPath("project", cwd))).toBe(false);
  });

  it("install writes conventions file and patches .aider.conf.yml", async () => {
    const r = await aiderRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);

    const conv = aiderConventionsPath("project", cwd);
    const conf = aiderConfPath("project", cwd);
    expect(fs.existsSync(conv)).toBe(true);
    expect(fs.existsSync(conf)).toBe(true);

    const confText = fs.readFileSync(conf, "utf8");
    expect(confText).toContain("read:");
    // Audit F-005: project-scope conf records the relative basename, not
    // an absolute machine path that would not transfer across machines/CI.
    expect(confText).toContain("CONVENTIONS.vegastack.md");
    expect(confText).not.toContain(cwd);
  });

  it("install is idempotent on re-run", async () => {
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const conf = aiderConfPath("project", cwd);
    const before = fs.readFileSync(conf, "utf8");

    const r = await aiderRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);
    expect(r.notes.join(" ")).toMatch(/already referenced/);
    expect(fs.readFileSync(conf, "utf8")).toBe(before);
  });

  it("install preserves existing read[] entries when patching", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(
      conf,
      ["model: gpt-5", "read:", "  - existing.md", "  - other.md", ""].join("\n"),
    );

    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const after = fs.readFileSync(conf, "utf8");
    expect(after).toContain("model: gpt-5");
    expect(after).toContain("existing.md");
    expect(after).toContain("other.md");
    expect(after).toContain(path.basename(aiderConventionsPath("project", cwd)));
  });

  it("install handles flow-list read[] (read: [a, b])", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(conf, ["read: [existing.md, other.md]", ""].join("\n"));

    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const after = fs.readFileSync(conf, "utf8");
    expect(after).toContain("existing.md");
    expect(after).toContain("other.md");
    expect(after).toContain(path.basename(aiderConventionsPath("project", cwd)));
  });

  it("uninstall removes both files and unpatches conf, idempotent", async () => {
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(aiderConventionsPath("project", cwd))).toBe(true);

    await aiderRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(aiderConventionsPath("project", cwd))).toBe(false);
    const confText = fs.readFileSync(aiderConfPath("project", cwd), "utf8");
    expect(confText).not.toContain("CONVENTIONS.vegastack.md");

    // Idempotent
    const r = await aiderRenderer.uninstall({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });

  it("install preserves comments and blank lines in .aider.conf.yml (F-004)", async () => {
    const conf = aiderConfPath("project", cwd);
    const original = [
      "# top-level comment",
      "model: gpt-5",
      "",
      "# next section",
      "auto-commits: false",
      "",
      "read:",
      "  - existing.md  # inline note",
      "  - other.md",
      "",
      "# trailing comment",
      "",
    ].join("\n");
    fs.writeFileSync(conf, original);

    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const after = fs.readFileSync(conf, "utf8");

    // Every comment, blank line, and ordering preserved.
    expect(after).toContain("# top-level comment");
    expect(after).toContain("# next section");
    expect(after).toContain("# trailing comment");
    expect(after).toContain("  - existing.md  # inline note");
    expect(after).toContain("auto-commits: false");
    // Original keys remain in original order (model before auto-commits).
    expect(after.indexOf("model: gpt-5")).toBeLessThan(after.indexOf("auto-commits: false"));
    // The vegastack entry was appended into the existing read[] block
    // (not a duplicate `read:` block at the bottom).
    expect((after.match(/^read:/gm) ?? []).length).toBe(1);
  });

  it("install preserves flow-list formatting when patching (F-004)", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(conf, ["read: [existing.md, other.md]", ""].join("\n"));

    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const after = fs.readFileSync(conf, "utf8");
    // Flow style preserved (the renderer used to collapse it into block style).
    expect(after).toMatch(/read: \[existing\.md, other\.md, CONVENTIONS\.vegastack\.md\]/);
    // No block-list `  - ` continuation got injected.
    expect(after).not.toMatch(/\n {2}- existing\.md/);
  });

  it("project-scope install writes a relative path, not an absolute one (F-005)", async () => {
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const conf = aiderConfPath("project", cwd);
    const after = fs.readFileSync(conf, "utf8");
    // The cwd (machine-specific tmp prefix) must not appear.
    expect(after).not.toContain(cwd);
    expect(after).toContain("CONVENTIONS.vegastack.md");
  });

  it("uninstall preserves a user-managed read[] entry sharing the same basename (F-006 companion)", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(conf, ["read:", "  - vendor/CONVENTIONS.vegastack.md", ""].join("\n"));
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    await aiderRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    const after = fs.readFileSync(conf, "utf8");
    // The user's vendor/-prefixed entry must survive the uninstall.
    expect(after).toContain("vendor/CONVENTIONS.vegastack.md");
  });

  it("uninstall preserves other read[] entries", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(conf, ["read:", "  - existing.md", ""].join("\n"));
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    await aiderRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });

    const after = fs.readFileSync(conf, "utf8");
    expect(after).toContain("existing.md");
    expect(after).not.toContain("CONVENTIONS.vegastack.md");
  });
});
