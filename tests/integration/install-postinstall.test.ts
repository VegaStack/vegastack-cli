import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const INSTALL_JS = path.join(PKG_ROOT, "npm", "install.js");

function runPostinstall(env: Record<string, string> = {}): { status: number; stderr: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-postinstall-"));
  const r = spawnSync(process.execPath, [INSTALL_JS], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: "",
      ...env,
    },
  });
  fs.rmSync(home, { recursive: true, force: true });
  return { status: r.status ?? 1, stderr: r.stderr };
}

describe("npm/install.js postinstall", () => {
  it("does not download registry data implicitly", () => {
    const r = runPostinstall();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("postinstall: does not download Registry data");
    expect(r.stderr).toContain("vegastack setup");
  });

  it("honors VEGASTACK_SKIP_POSTINSTALL", () => {
    const r = runPostinstall({ VEGASTACK_SKIP_POSTINSTALL: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("nothing to do");
  });

  it("honors VEGASTACK_SKIP_SKILL_INSTALL", () => {
    const r = runPostinstall({ VEGASTACK_SKIP_SKILL_INSTALL: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("skipping agent skill registration");
  });

  // Audit security/F-006: defence-in-depth honour `npm_config_ignore_scripts`
  // even when invoked directly (npm itself usually short-circuits earlier).
  it("honors npm_config_ignore_scripts=true", () => {
    const r = runPostinstall({ npm_config_ignore_scripts: "true" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("npm_config_ignore_scripts=true");
    expect(r.stderr).toContain("skipping");
    // Must NOT print the normal Registry-data guidance line — that means the
    // shim took the early-return path.
    expect(r.stderr).not.toContain("does not download Registry data");
  });
});
