import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAsk } from "../../src/commands/ask.js";

const tmp: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("runAsk", () => {
  it("requires vegastack init for project-scoped queries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-ask-"));
    tmp.push(dir);
    const old = process.cwd();
    process.chdir(dir);
    try {
      const code = await runAsk("deploy ec2", {
        all: false,
        raw: false,
        brief: false,
        fullExamples: false,
        pretty: true,
        debug: false,
      });
      expect(code).toBe(10);
    } finally {
      process.chdir(old);
    }
  });
});
