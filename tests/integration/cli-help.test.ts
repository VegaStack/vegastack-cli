// Integration test: shell out to the built CLI and verify help/version output.
// This makes sure cli.ts wires up correctly end-to-end without depending on
// the docs Registry pack.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const CLI = path.join(PKG_ROOT, "dist", "cli.js");

describe("vegastack CLI help / version", () => {
  it("dist/cli.js exists (run `npm run build` first)", () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  it("`vegastack --version` matches package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const r = spawnSync("node", [CLI, "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("`vegastack --help` lists every command", () => {
    const r = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const cmd of [
      "init",
      "ask",
      "search",
      "doctor",
      "registry",
      "skills",
      "secrets",
      "preview",
    ]) {
      expect(r.stdout).toContain(cmd);
    }
    expect(r.stdout).not.toMatch(/\n {2}install \[options\]/);
    expect(r.stdout).not.toMatch(/\n {2}refresh \[options\]/);
  });

  it("`vegastack --help` documents env vars and exit codes", () => {
    const r = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("VEGASTACK_REGISTRY_DIR");
    expect(r.stdout).toContain("VEGASTACK_CLOUDFLARED_BIN");
    expect(r.stdout).toContain("NO_COLOR");
    expect(r.stdout).toMatch(/Exit codes/);
  });

  it("`vegastack preview --help` discloses Cloudflare Tunnel usage", () => {
    const r = spawnSync("node", [CLI, "preview", "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Cloudflare Quick Tunnels");
    expect(r.stdout).toContain("cloudflare/cloudflared");
    expect(r.stdout).toContain("--hostname");
  });

  it("`vegastack registry --help` lists registry actions", () => {
    const r = spawnSync("node", [CLI, "registry", "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("list");
    expect(r.stdout).toContain("update");
    expect(r.stdout).toContain("status");
    expect(r.stdout).not.toMatch(/\n\s+install\b/);
  });

  it("`vegastack skills --help` lists the three actions", () => {
    const r = spawnSync("node", [CLI, "skills", "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("install");
    expect(r.stdout).toContain("uninstall");
    expect(r.stdout).toContain("status");
  });

  it("rejects an invalid scope with a clear message", () => {
    const r = spawnSync("node", [CLI, "skills", "install", "--scope", "everywhere"], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/global.*project/);
  });

  it("does not expose legacy Terraform shortcuts", () => {
    const help = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(help.stdout).not.toMatch(/\n\s+terraform\b/);
    expect(help.stdout).not.toMatch(/\n\s+tf\b/);

    const r = spawnSync("node", [CLI, "terraform", ""], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/unknown command/i);
  });
});
