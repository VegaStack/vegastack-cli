import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCode } from "../../src/agents/claude-code.js";
import { pkgRoot } from "../../src/lib/paths.js";

let fakeHome: string;
let homeBackup: string | undefined;
let pathBackup: string | undefined;

beforeEach(() => {
  // Sandbox HOME so we don't write into real ~/.claude.
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-claude-home-"));
  homeBackup = process.env.HOME;
  pathBackup = process.env.PATH;
  process.env.HOME = fakeHome;
  // Empty PATH so `claude` isn't found — the installer should refuse cleanly.
  process.env.PATH = "";
});
afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  else delete process.env.HOME;
  if (pathBackup !== undefined) process.env.PATH = pathBackup;
  else delete process.env.PATH;
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

  it("refuses cleanly when claude binary is not on PATH", () => {
    const r = claudeCode.install({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(r.installed).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/Claude Code .* not found on PATH/i);
  });

  it("dry-run does not invoke claude and reports the planned commands", () => {
    // Put a stub `claude` on PATH so the binaryOnPath check passes.
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-stub-"));
    fs.writeFileSync(path.join(stubDir, "claude"), "#!/bin/sh\necho stub\n", { mode: 0o755 });
    process.env.PATH = stubDir;

    const r = claudeCode.install({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: true,
    });
    expect(r.installed).toBe(false);
    expect(r.notes.join("\n")).toMatch(/marketplace add/);
    expect(r.notes.join("\n")).toMatch(/plugin install/);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it("status reflects installed_plugins.json contents", () => {
    const dir = path.join(fakeHome, ".claude", "plugins");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "installed_plugins.json"),
      JSON.stringify({ plugins: { "vegastack-cli@vegastack-cli": [{ scope: "user" }] } }),
    );
    const s = claudeCode.status({ scope: "global", cwd: "/tmp", force: false, dryRun: false });
    expect(s.installed).toBe(true);
    expect(s.notes.join(" ")).toMatch(/vegastack-cli@vegastack-cli/);
  });

  it("uninstall reports nothing to remove when not installed", () => {
    const r = claudeCode.uninstall({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(r.notes.join(" ")).toMatch(/nothing to remove/);
  });

  it("uninstall cleans up a legacy symlink even without claude on PATH", () => {
    if (process.platform === "win32") return;
    const dir = path.join(fakeHome, ".claude", "plugins");
    fs.mkdirSync(dir, { recursive: true });
    const legacy = path.join(dir, "vegastack-cli");
    fs.symlinkSync(pkgRoot(), legacy);

    const r = claudeCode.uninstall({
      scope: "global",
      cwd: "/tmp",
      force: false,
      dryRun: false,
    });
    expect(fs.existsSync(legacy)).toBe(false);
    expect(r.notes.join(" ")).toMatch(/stale symlink/i);
  });

  it("ships an MCP config that defaults to the modern /mcp StreamableHTTP endpoint", () => {
    // The Claude Code plugin includes .mcp.json at the plugin root.
    // Defaulting to /mcp matches the convergent 2026 transport; /sse is
    // still served by apps/mcp/ for legacy clients.
    const mcpJsonPath = path.join(pkgRoot(), ".mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url: string }>;
    };
    const server = mcp.mcpServers["vegastack-tf"];
    expect(server).toBeDefined();
    expect(server!.url).toBe("https://mcp.vegastack.com/mcp");
    expect(server!.url).not.toContain("/sse");
  });
});
