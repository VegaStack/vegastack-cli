import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Shelling to host archive tools is a class of bug because:
//   - `unzip` is missing on Alpine/musl
//   - `Expand-Archive` is missing on pwsh-only Windows / Server Core
//   - Neither validates entry types pre-write (zip-slip, symlink escape,
//     device-file insertion)
//
// All extraction must go through src/lib/safe-extract.ts (uses npm `tar`
// + `yauzl` with explicit per-entry validation).
//
// Audit category: regression-prevention. See
// `.claude/skills/vegastack-audit/references/regression-pins.md` §
// `tar -xzf` / `unzip` / `Expand-Archive` shell-out.

const BAD_PATTERNS = [
  /\b(?:exec(?:File|FileSync|Sync)?|spawn(?:Sync)?)\([^)]*["']tar["']/,
  /\b(?:exec(?:File|FileSync|Sync)?|spawn(?:Sync)?)\([^)]*["']unzip["']/,
  /\b(?:exec(?:File|FileSync|Sync)?|spawn(?:Sync)?)\([^)]*["']gunzip["']/,
  /["']Expand-Archive["']/,
  /["']powershell\.exe["'][\s\S]{0,200}?Expand-Archive/,
];

// Files allowed to mention the patterns directly (the helper itself + tests).
const ALLOWED = new Set<string>(["src/lib/safe-extract.ts"]);

function* walkSrcAndApps(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".astro") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSrcAndApps(full);
    else if (entry.isFile() && entry.name.endsWith(".ts")) yield full;
  }
}

describe("architecture — no-host-archive-tools (regression pin for #75/#76)", () => {
  it("only safe-extract.ts may shell out to tar/unzip/Expand-Archive", () => {
    const offenders: { file: string; pattern: string }[] = [];
    for (const root of ["src", "apps/mcp/src", "apps/dashboard/src", "scripts"]) {
      const fullRoot = path.join(REPO_ROOT, root);
      if (!fs.existsSync(fullRoot)) continue;
      for (const file of walkSrcAndApps(fullRoot)) {
        const rel = path.relative(REPO_ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const text = fs.readFileSync(file, "utf8");
        // Strip comments so docstrings explaining the ban don't trip
        const code = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const re of BAD_PATTERNS) {
          if (re.test(code)) offenders.push({ file: rel, pattern: re.source });
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
