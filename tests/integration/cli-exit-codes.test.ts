// Integration test: confirm the documented exit-code rubric is what users
// actually observe end-to-end. Builds against `dist/cli.js`.
//
// Covers:
// - F-002 fix: a commander `InvalidArgumentError` (e.g. `scan --format <bad>`)
//   is translated to a typed `ValidationError` and exits 10, not 1.
// - F-003 doc clarification: unknown command / unknown option still exit 1
//   (commander-level usage errors), as advertised in the help text.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const CLI = path.join(PKG_ROOT, "dist", "cli.js");

function isolatedEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-exitcodes-")),
    VEGASTACK_REGISTRY_URL: "http://127.0.0.1:1",
    VEGASTACK_REGISTRY_DEV_TRUST: "1",
    NO_COLOR: "1",
  };
}

describe("vegastack exit-code contract (integration)", () => {
  it("dist/cli.js is built", () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  it("`scan --format invalid` exits 10 (ValidationError), not 1", () => {
    const r = spawnSync(process.execPath, [CLI, "scan", "--format", "invalid"], {
      env: isolatedEnv(),
      encoding: "utf8",
    });
    // stderr should mention the invalid value; exit code must be 10.
    expect(r.stderr + r.stdout).toMatch(/invalid|expected/i);
    expect(r.status).toBe(10);
  });

  it("`ask -m bogus` (positive-int validator) exits 10", () => {
    const r = spawnSync(process.execPath, [CLI, "ask", "-m", "not-a-number", "hello"], {
      env: isolatedEnv(),
      encoding: "utf8",
    });
    expect(r.status).toBe(10);
  });

  it("unknown command exits 1 (commander usage error, as documented)", () => {
    const r = spawnSync(process.execPath, [CLI, "definitely-not-a-real-command"], {
      env: isolatedEnv(),
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
  });
});
