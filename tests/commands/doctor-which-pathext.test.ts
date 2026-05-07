import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { which } from "../../src/commands/doctor.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("doctor which() — finds tools on every platform", () => {
  let tmp: string;
  let prevPath: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-which-"));
    prevPath = process.env.PATH;
  });
  afterEach(() => {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds a POSIX exec on PATH and reports its --version output", () => {
    if (process.platform === "win32") return;
    const bin = path.join(tmp, "fakejq");
    fs.writeFileSync(bin, "#!/bin/sh\necho jq-1.7.1\n");
    fs.chmodSync(bin, 0o755);
    process.env.PATH = `${tmp}${path.delimiter}${process.env.PATH ?? ""}`;
    const res = which("fakejq");
    expect(res.found).toBe(true);
    expect(res.version).toMatch(/jq-1\.7/);
  });

  it("returns found=false for an obviously missing command", () => {
    process.env.PATH = tmp; // empty dir
    const res = which("definitely-not-installed-vsk-xyz");
    expect(res.found).toBe(false);
  });
});

describe("doctor which() — Windows uses shell:true to honour PATHEXT", () => {
  it("source uses shell:true when running on win32", () => {
    // Static source assertion: regression guard so the win32 branch isn't
    // accidentally removed. Reading fs is fine; the runtime behaviour itself
    // is verified end-to-end by `vegastack doctor` on Windows CI.
    const src = fs.readFileSync(
      path.join(HERE, "..", "..", "src", "commands", "doctor.ts"),
      "utf8",
    );
    expect(src).toMatch(/process\.platform\s*===\s*["']win32["']/);
    expect(src).toMatch(/shell:\s*useShell/);
  });
});
