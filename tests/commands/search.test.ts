import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSearch } from "../../src/commands/search.js";

const tmp: string[] = [];
const oldEnv = { ...process.env };

afterEach(() => {
  process.env = { ...oldEnv };
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("runSearch", () => {
  it("returns deterministic exact matches from a Registry pack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-search-"));
    tmp.push(root);
    process.env.VEGASTACK_REGISTRY_DIR = root;
    process.env.VEGASTACK_NO_MANAGED_TOOLS = "1";
    const file = path.join(root, "jenkins", "docs", "pipeline.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# Pipeline\n\nUse withCredentials in a Jenkinsfile.\n");
    fs.writeFileSync(
      path.join(root, "jenkins", "MANIFEST.json"),
      JSON.stringify({ schema_version: 2, id: "jenkins", docs_root: "docs" }),
    );
    const rel = "docs/pipeline.md";
    fs.writeFileSync(
      path.join(root, "jenkins", "ARTIFACTS.json"),
      JSON.stringify({
        schema_version: 1,
        files: [{ path: rel, bytes: fs.statSync(file).size, sha256: sha256(file) }],
      }),
    );

    let stdout = "";
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout += String(chunk);
        return true;
      });
    try {
      const code = await runSearch("withCredentials", {
        all: false,
        entries: "jenkins",
        regex: false,
        ignoreCase: false,
        installTools: false,
        pretty: true,
      });
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }

    const parsed = JSON.parse(stdout) as {
      engine: string;
      matches: { registry_entry: string; path: string; line: number; verified: boolean }[];
    };
    expect(parsed.engine).toMatch(/ripgrep|typescript/);
    expect(parsed.matches).toMatchObject([
      {
        registry_entry: "jenkins",
        path: "docs/pipeline.md",
        line: 3,
        verified: true,
      },
    ]);
  });
});

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
