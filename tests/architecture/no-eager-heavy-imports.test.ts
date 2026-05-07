import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Modules whose static import inflates cold start by tens of ms. They must
// be loaded only inside a command's `.action()` handler via dynamic import.
// Audit category: regression-prevention. See
// `.claude/skills/vegastack-audit/references/regression-pins.md` §
// `import "<heavy-module>"` in cold-start path.
const BANNED_STATIC_IMPORTS_IN_COLD_START = [
  "sigstore",
  // Add more here as new heavy deps land. Keep the list small — every entry
  // is a regression pin saying "this module must never be loaded eagerly".
];

const COLD_START_FILES = [
  "src/cli.ts",
  // src/lib/registry-signature.ts loads sigstore lazily; if a future caller
  // re-introduces the static import, this catches it.
  "src/lib/registry-signature.ts",
];

describe("architecture — no-eager-heavy-imports (regression pin for #84)", () => {
  for (const file of COLD_START_FILES) {
    it(`${file} does not statically import any banned heavy module`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      // Strip line comments so docstrings can mention the banned name.
      const code = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const mod of BANNED_STATIC_IMPORTS_IN_COLD_START) {
        const re = new RegExp(`^\\s*import\\s+[^;]+from\\s+["']${mod}["']`, "m");
        expect(code, `${file} statically imports banned heavy module "${mod}"`).not.toMatch(re);
      }
    });
  }
});
