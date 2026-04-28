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
    expect(confText).toContain(conv);
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
    expect(after).toContain(aiderConventionsPath("project", cwd));
  });

  it("install handles flow-list read[] (read: [a, b])", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(conf, ["read: [existing.md, other.md]", ""].join("\n"));

    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const after = fs.readFileSync(conf, "utf8");
    expect(after).toContain("existing.md");
    expect(after).toContain("other.md");
    expect(after).toContain(aiderConventionsPath("project", cwd));
  });

  it("uninstall removes both files and unpatches conf, idempotent", async () => {
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(aiderConventionsPath("project", cwd))).toBe(true);

    await aiderRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(aiderConventionsPath("project", cwd))).toBe(false);
    const confText = fs.readFileSync(aiderConfPath("project", cwd), "utf8");
    expect(confText).not.toContain(aiderConventionsPath("project", cwd));

    // Idempotent
    const r = await aiderRenderer.uninstall({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });

  it("uninstall preserves other read[] entries", async () => {
    const conf = aiderConfPath("project", cwd);
    fs.writeFileSync(conf, ["read:", "  - existing.md", ""].join("\n"));
    await aiderRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    await aiderRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });

    const after = fs.readFileSync(conf, "utf8");
    expect(after).toContain("existing.md");
    expect(after).not.toContain(aiderConventionsPath("project", cwd));
  });
});
