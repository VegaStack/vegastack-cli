// Renderer tests for Continue.dev. Validates idempotency, dry-run safety,
// partial-failure recovery, and uninstall cleanup.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { continueRenderer } from "../../src/agents/continue.js";
import { continueMcpServerPath } from "../../src/lib/paths.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-continue-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("continue renderer", () => {
  it("reports not-installed initially", async () => {
    const r = await continueRenderer.status({ scope: "project", cwd, force: false, dryRun: false });
    expect(r.installed).toBe(false);
  });

  it("dry-run does not write the YAML file", async () => {
    const r = await continueRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: true,
    });
    expect(r.installed).toBe(false);
    expect(r.notes.join(" ")).toMatch(/would write/);
    expect(fs.existsSync(continueMcpServerPath("project", cwd))).toBe(false);
  });

  it("install writes a valid YAML mcpServers config", async () => {
    const r = await continueRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);
    const dest = continueMcpServerPath("project", cwd);
    expect(fs.existsSync(dest)).toBe(true);
    const text = fs.readFileSync(dest, "utf8");
    expect(text).toContain("mcpServers:");
    expect(text).toContain("vegastack");
    expect(text).toMatch(/url: "https?:\/\//);
  });

  it("defaults to the modern /mcp StreamableHTTP transport", async () => {
    // Ensure no override leaks in from the test runner's env.
    const prev = process.env.VEGASTACK_MCP_URL;
    delete process.env.VEGASTACK_MCP_URL;
    try {
      // Re-import to pick up the unset env. The module reads the env at
      // import time, so we use vi's dynamic import after resetting modules.
      const { continueRenderer: fresh } = await import("../../src/agents/continue.js");
      await fresh.install({ scope: "project", cwd, force: false, dryRun: false });
      const dest = continueMcpServerPath("project", cwd);
      const text = fs.readFileSync(dest, "utf8");
      // Default URL is the modern /mcp endpoint, not the legacy /sse.
      expect(text).toContain('url: "https://mcp.vegastack.com/mcp"');
      expect(text).not.toContain("https://mcp.vegastack.com/sse");
      // Transport tracks the URL: /mcp ⇒ streamable-http.
      expect(text).toContain("transport: streamable-http");
    } finally {
      if (prev !== undefined) process.env.VEGASTACK_MCP_URL = prev;
    }
  });

  it("install is idempotent on identical content", async () => {
    await continueRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const dest = continueMcpServerPath("project", cwd);
    const before = fs.readFileSync(dest, "utf8");
    const r = await continueRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);
    expect(r.notes.join(" ")).toMatch(/already up to date/);
    const after = fs.readFileSync(dest, "utf8");
    expect(after).toBe(before);
  });

  it("install with hand-edited file warns without --force", async () => {
    await continueRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const dest = continueMcpServerPath("project", cwd);
    fs.writeFileSync(dest, "# user-edited\n");

    const r = await continueRenderer.install({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/--force/);
    expect(fs.readFileSync(dest, "utf8")).toBe("# user-edited\n");
  });

  it("install with --force overwrites a hand-edited file", async () => {
    await continueRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const dest = continueMcpServerPath("project", cwd);
    fs.writeFileSync(dest, "# user-edited\n");
    const r = await continueRenderer.install({
      scope: "project",
      cwd,
      force: true,
      dryRun: false,
    });
    expect(r.installed).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).toContain("vegastack");
  });

  it("uninstall removes the file and is idempotent", async () => {
    await continueRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    const dest = continueMcpServerPath("project", cwd);
    expect(fs.existsSync(dest)).toBe(true);

    await continueRenderer.uninstall({ scope: "project", cwd, force: false, dryRun: false });
    expect(fs.existsSync(dest)).toBe(false);

    const r = await continueRenderer.uninstall({
      scope: "project",
      cwd,
      force: false,
      dryRun: false,
    });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });

  it("reads VEGASTACK_MCP_URL at install time, not module-load time (F-001)", async () => {
    const prev = process.env.VEGASTACK_MCP_URL;
    // Note: continueRenderer was already imported at the top of this file,
    // so any module-load capture would have locked in the *initial* env. We
    // mutate it now and assert the renderer picks the new value up.
    process.env.VEGASTACK_MCP_URL = "https://example.com/custom-mcp";
    try {
      await continueRenderer.install({ scope: "project", cwd, force: true, dryRun: false });
      const dest = continueMcpServerPath("project", cwd);
      const text = fs.readFileSync(dest, "utf8");
      expect(text).toContain('url: "https://example.com/custom-mcp"');
    } finally {
      if (prev === undefined) delete process.env.VEGASTACK_MCP_URL;
      else process.env.VEGASTACK_MCP_URL = prev;
    }
  });

  it("rejects javascript: scheme URLs (F-001/F-002)", async () => {
    const prev = process.env.VEGASTACK_MCP_URL;
    process.env.VEGASTACK_MCP_URL = "javascript:alert(1)";
    try {
      const r = await continueRenderer.install({
        scope: "project",
        cwd,
        force: false,
        dryRun: false,
      });
      expect(r.installed).toBe(false);
      expect(r.warnings.join(" ")).toMatch(/http\(s\)/);
      expect(fs.existsSync(continueMcpServerPath("project", cwd))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.VEGASTACK_MCP_URL;
      else process.env.VEGASTACK_MCP_URL = prev;
    }
  });

  it("rejects YAML-injection attempts in VEGASTACK_MCP_URL (F-002)", async () => {
    const prev = process.env.VEGASTACK_MCP_URL;
    // A newline-bearing URL would, without quoting/validation, append rogue
    // YAML keys under mcpServers[0]. We require it be rejected outright.
    process.env.VEGASTACK_MCP_URL = "https://x\nrogueKey: rogueValue";
    try {
      const r = await continueRenderer.install({
        scope: "project",
        cwd,
        force: false,
        dryRun: false,
      });
      expect(r.installed).toBe(false);
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(fs.existsSync(continueMcpServerPath("project", cwd))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.VEGASTACK_MCP_URL;
      else process.env.VEGASTACK_MCP_URL = prev;
    }
  });

  it("status reports installed after install", async () => {
    expect(
      (await continueRenderer.status({ scope: "project", cwd, force: false, dryRun: false }))
        .installed,
    ).toBe(false);
    await continueRenderer.install({ scope: "project", cwd, force: false, dryRun: false });
    expect(
      (await continueRenderer.status({ scope: "project", cwd, force: false, dryRun: false }))
        .installed,
    ).toBe(true);
  });
});
