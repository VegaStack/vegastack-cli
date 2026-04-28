// Integration test: shell out to the built CLI and verify help/version output.
// This makes sure cli.ts wires up correctly end-to-end without depending on
// the docs bundle.

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
    for (const cmd of ["doctor", "install", "refresh", "tf", "skills"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("`vegastack --help` documents env vars and exit codes", () => {
    const r = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("VEGASTACK_BUNDLE_DIR");
    expect(r.stdout).toContain("HTTPS_PROXY");
    expect(r.stdout).toContain("NO_COLOR");
    expect(r.stdout).toMatch(/Exit codes/);
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

  it("`vegastack tf` with empty query returns ValidationError exit code", () => {
    const r = spawnSync("node", [CLI, "tf", ""], { encoding: "utf8" });
    expect(r.status).toBe(10); // ValidationError
    expect(`${r.stdout}${r.stderr}`).toMatch(/usage:.*vegastack tf/);
  });
});
