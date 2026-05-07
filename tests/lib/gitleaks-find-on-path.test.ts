import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGitleaksBin } from "../../src/lib/gitleaks.js";

const isWin = process.platform === "win32";
const GITLEAKS = isWin ? "gitleaks.exe" : "gitleaks";

interface SnapEnv {
  PATH: string | undefined;
  VEGASTACK_GITLEAKS_BIN: string | undefined;
  VEGASTACK_TOOLS_DIR: string | undefined;
  VEGASTACK_ALLOW_SYSTEM_TOOLS: string | undefined;
}

function snapshot(): SnapEnv {
  return {
    PATH: process.env.PATH,
    VEGASTACK_GITLEAKS_BIN: process.env.VEGASTACK_GITLEAKS_BIN,
    VEGASTACK_TOOLS_DIR: process.env.VEGASTACK_TOOLS_DIR,
    VEGASTACK_ALLOW_SYSTEM_TOOLS: process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS,
  };
}

function restore(snap: SnapEnv): void {
  for (const k of Object.keys(snap) as (keyof SnapEnv)[]) {
    const v = snap[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("gitleaks findOnPath — executable-bit check", () => {
  let tmp: string;
  let snap: SnapEnv;
  beforeEach(() => {
    snap = snapshot();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-findpath-"));
    process.env.VEGASTACK_TOOLS_DIR = path.join(tmp, "tools");
    fs.mkdirSync(process.env.VEGASTACK_TOOLS_DIR, { recursive: true });
    delete process.env.VEGASTACK_GITLEAKS_BIN;
    process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS = "1";
  });
  afterEach(() => {
    restore(snap);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("skips a non-executable regular file named gitleaks on PATH", () => {
    if (isWin) return; // POSIX semantics: chmod 644 marks non-exec
    const dir = path.join(tmp, "bin");
    fs.mkdirSync(dir);
    const fake = path.join(dir, GITLEAKS);
    fs.writeFileSync(fake, "not actually a binary\n");
    fs.chmodSync(fake, 0o644);
    process.env.PATH = dir;
    expect(resolveGitleaksBin()).toBeNull();
  });

  it("returns the executable when a later PATH entry has an exec gitleaks", () => {
    if (isWin) return;
    const bad = path.join(tmp, "bad");
    const good = path.join(tmp, "good");
    fs.mkdirSync(bad);
    fs.mkdirSync(good);
    fs.writeFileSync(path.join(bad, GITLEAKS), "no exec");
    fs.chmodSync(path.join(bad, GITLEAKS), 0o644);
    const goodBin = path.join(good, GITLEAKS);
    fs.writeFileSync(goodBin, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(goodBin, 0o755);
    process.env.PATH = `${bad}${path.delimiter}${good}`;
    expect(resolveGitleaksBin()).toBe(goodBin);
  });
});
