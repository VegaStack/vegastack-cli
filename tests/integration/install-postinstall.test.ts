import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const INSTALL_JS = path.join(PKG_ROOT, "npm", "install.js");

function runPostinstall(env: Record<string, string> = {}): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, [INSTALL_JS], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stderr: r.stderr };
}

describe("npm/install.js postinstall", () => {
  it("does not download registry data implicitly", () => {
    const r = runPostinstall();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("postinstall: does not download Registry data");
  });

  it("honors VEGASTACK_SKIP_POSTINSTALL", () => {
    const r = runPostinstall({ VEGASTACK_SKIP_POSTINSTALL: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("nothing to do");
  });
});
