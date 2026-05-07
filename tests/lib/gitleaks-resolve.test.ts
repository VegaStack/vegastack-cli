import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGitleaksBin } from "../../src/lib/gitleaks.js";
import { resolveRipgrepBin } from "../../src/lib/ripgrep.js";

const isWin = process.platform === "win32";
const RG = isWin ? "rg.exe" : "rg";
const GITLEAKS = isWin ? "gitleaks.exe" : "gitleaks";

interface SnapEnv {
  PATH?: string;
  VEGASTACK_GITLEAKS_BIN?: string;
  VEGASTACK_RIPGREP_BIN?: string;
  VEGASTACK_TOOLS_DIR?: string;
  VEGASTACK_ALLOW_SYSTEM_TOOLS?: string;
}

function snapshotEnv(): SnapEnv {
  return {
    PATH: process.env.PATH,
    VEGASTACK_GITLEAKS_BIN: process.env.VEGASTACK_GITLEAKS_BIN,
    VEGASTACK_RIPGREP_BIN: process.env.VEGASTACK_RIPGREP_BIN,
    VEGASTACK_TOOLS_DIR: process.env.VEGASTACK_TOOLS_DIR,
    VEGASTACK_ALLOW_SYSTEM_TOOLS: process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS,
  };
}

function restoreEnv(snap: SnapEnv): void {
  for (const k of Object.keys(snap) as (keyof SnapEnv)[]) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("resolveGitleaksBin / resolveRipgrepBin — system PATH fallback", () => {
  let tmp: string;
  let snap: SnapEnv;
  beforeEach(() => {
    snap = snapshotEnv();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-resolve-"));
    delete process.env.VEGASTACK_GITLEAKS_BIN;
    delete process.env.VEGASTACK_RIPGREP_BIN;
    delete process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS;
    // Empty managed tool root so no metadata is found.
    process.env.VEGASTACK_TOOLS_DIR = path.join(tmp, "tools");
    fs.mkdirSync(process.env.VEGASTACK_TOOLS_DIR, { recursive: true });
    // Lay down fake binaries on PATH.
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    for (const name of [GITLEAKS, RG]) {
      const p = path.join(bin, name);
      fs.writeFileSync(p, "#!/bin/sh\nexit 0\n");
      fs.chmodSync(p, 0o755);
    }
    process.env.PATH = bin;
  });
  afterEach(() => {
    restoreEnv(snap);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses to fall back to a system gitleaks on PATH without opt-in", () => {
    expect(resolveGitleaksBin()).toBeNull();
  });

  it("refuses to fall back to a system ripgrep on PATH without opt-in", () => {
    expect(resolveRipgrepBin()).toBeNull();
  });

  it("returns the PATH binary when VEGASTACK_ALLOW_SYSTEM_TOOLS=1 is set", () => {
    process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS = "1";
    const g = resolveGitleaksBin();
    const r = resolveRipgrepBin();
    expect(g).toMatch(new RegExp(GITLEAKS.replace(".", "\\.") + "$"));
    expect(r).toMatch(new RegExp(RG.replace(".", "\\.") + "$"));
  });

  it("VEGASTACK_GITLEAKS_BIN override always wins over the gating", () => {
    const fake = path.join(tmp, "bin", GITLEAKS);
    process.env.VEGASTACK_GITLEAKS_BIN = fake;
    expect(resolveGitleaksBin()).toBe(fake);
  });
});
