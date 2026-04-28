import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCode } from "../../src/agents/claude-code.js";
import { claudePluginDir, pkgRoot } from "../../src/lib/paths.js";

let fakeHome: string;
let homeBackup: string | undefined;

beforeEach(() => {
  // Sandbox HOME so we don't write into real ~/.claude.
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vega-claude-home-"));
  homeBackup = process.env.HOME;
  process.env.HOME = fakeHome;
});
afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  else delete process.env.HOME;
});

describe("claude-code installer", () => {
  it("rejects project scope", () => {
    const r = claudeCode.install({
      scope: "project",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/global/);
  });

  it("dry-run does not write", () => {
    const r = claudeCode.install({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: true,
    });
    expect(r.installed).toBe(false);
    expect(fs.existsSync(claudePluginDir())).toBe(false);
  });

  it("install creates the plugin dir", () => {
    if (process.platform === "win32") return; // symlink semantics differ
    const r = claudeCode.install({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(true);
    expect(fs.existsSync(claudePluginDir())).toBe(true);
  });

  it("install is idempotent", () => {
    if (process.platform === "win32") return;
    claudeCode.install({ scope: "global", cwd: "/tmp", force: false, dryRun: false });
    const r2 = claudeCode.install({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(r2.installed).toBe(true);
    expect(r2.notes.join(" ")).toMatch(/already linked/);
  });

  it("uninstall removes the plugin and is idempotent", () => {
    if (process.platform === "win32") return;
    claudeCode.install({ scope: "global", cwd: "/tmp", force: false, dryRun: false });
    expect(fs.existsSync(claudePluginDir())).toBe(true);
    claudeCode.uninstall({ scope: "global", cwd: "/tmp", force: false, dryRun: false });
    expect(fs.existsSync(claudePluginDir())).toBe(false);

    const r = claudeCode.uninstall({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });

  it("ships an MCP config that defaults to the modern /mcp StreamableHTTP endpoint", () => {
    // The Claude Code plugin includes .claude-plugin/mcp/mcp.json. The renderer
    // links the package directory in, so this file ships verbatim. Defaulting
    // to /mcp matches the convergent 2026 transport; /sse is still served by
    // apps/mcp/ for legacy clients.
    const mcpJsonPath = path.join(pkgRoot(), ".claude-plugin", "mcp", "mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url: string }>;
    };
    const server = mcp.mcpServers["vegastack-tf"];
    expect(server).toBeDefined();
    expect(server!.url).toBe("https://mcp.vegastack.com/mcp");
    expect(server!.url).not.toContain("/sse");
  });
});
