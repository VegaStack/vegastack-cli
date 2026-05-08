// Smoke test for scripts/sync-version.mjs. Verifies that running the script
// against a controlled package.json + gemini-extension.json copy actually
// rewrites the extension manifest's version field to match.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "sync-version.mjs");

function makeFakeRepo(targetVersion: string, extVersion: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-sync-"));
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "@vegastack/cli", version: targetVersion }, null, 2),
  );
  const tplDir = path.join(tmp, "skills", "vegastack", "templates");
  fs.mkdirSync(tplDir, { recursive: true });
  fs.writeFileSync(
    path.join(tplDir, "gemini-extension.json"),
    JSON.stringify(
      {
        name: "vegastack",
        version: extVersion,
        description: "test",
        contextFileName: "skills/vegastack/SKILL.md",
        mcpServers: {},
        excludeTools: [],
      },
      null,
      2,
    ) + "\n",
  );
  return tmp;
}

let scriptCopy: string;
let cleanup: string[] = [];

beforeEach(() => {
  // The script reads `package.json` relative to its own directory (`../`).
  // To exercise it inside an isolated tmp repo, copy the script into the
  // tmp tree's scripts/ dir so its `repoRoot` resolves to the tmp dir.
  scriptCopy = fs.readFileSync(SCRIPT, "utf8");
});

afterEach(() => {
  for (const dir of cleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  cleanup = [];
});

describe("scripts/sync-version.mjs", () => {
  it("rewrites the gemini-extension.json version when out of sync", () => {
    const repo = makeFakeRepo("9.9.9-test", "0.0.0-stale");
    cleanup.push(repo);
    const tmpScript = path.join(repo, "scripts", "sync-version.mjs");
    fs.mkdirSync(path.dirname(tmpScript), { recursive: true });
    fs.writeFileSync(tmpScript, scriptCopy);

    const out = execFileSync("node", [tmpScript], { encoding: "utf8" });
    expect(out).toContain("-> 9.9.9-test");

    const ext = JSON.parse(
      fs.readFileSync(
        path.join(repo, "skills", "vegastack", "templates", "gemini-extension.json"),
        "utf8",
      ),
    ) as { version: string };
    expect(ext.version).toBe("9.9.9-test");
  });

  it("is a no-op when versions already match", () => {
    const repo = makeFakeRepo("1.2.3", "1.2.3");
    cleanup.push(repo);
    const tmpScript = path.join(repo, "scripts", "sync-version.mjs");
    fs.mkdirSync(path.dirname(tmpScript), { recursive: true });
    fs.writeFileSync(tmpScript, scriptCopy);

    const out = execFileSync("node", [tmpScript], { encoding: "utf8" });
    expect(out).toContain("already at 1.2.3");
  });
});
