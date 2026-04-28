// Determinism test for the generator. Runs `tsx scripts/generate-skills.ts`
// twice and asserts that the second run produces zero diffs — i.e., the
// output is a stable function of the TOML registries.

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");

function fileHash(p: string): string {
  if (!fs.existsSync(p)) return "<missing>";
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function dirHash(dir: string): string {
  if (!fs.existsSync(dir)) return "<missing>";
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  const hash = crypto.createHash("sha256");
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(e.parentPath ?? dir, e.name);
    if (e.isDirectory()) continue;
    hash.update(`${full}\0`);
    hash.update(fs.readFileSync(full));
  }
  return hash.digest("hex");
}

function run(script: string): { ok: boolean; stderr: string } {
  const r = spawnSync("npm", ["run", "--silent", script], {
    cwd: PKG_ROOT,
    encoding: "utf8",
    env: { ...process.env, VEGASTACK_SKIP_POSTINSTALL: "1" },
  });
  return { ok: r.status === 0, stderr: r.stderr };
}

describe("generate-skills determinism", () => {
  it("two consecutive runs produce identical output", () => {
    const r1 = run("generate-skills");
    expect(r1.ok).toBe(true);

    const indexHash1 = fileHash(path.join(PKG_ROOT, "recipes", "INDEX.json"));
    const personaHash1 = fileHash(path.join(PKG_ROOT, "personas", "INDEX.json"));
    const skillsHash1 = dirHash(path.join(PKG_ROOT, "skills", "recipes"));

    const r2 = run("generate-skills");
    expect(r2.ok).toBe(true);

    expect(fileHash(path.join(PKG_ROOT, "recipes", "INDEX.json"))).toBe(indexHash1);
    expect(fileHash(path.join(PKG_ROOT, "personas", "INDEX.json"))).toBe(personaHash1);
    expect(dirHash(path.join(PKG_ROOT, "skills", "recipes"))).toBe(skillsHash1);
  });

  it("INDEX files are valid JSON arrays", () => {
    run("generate-skills");
    const ri = JSON.parse(
      fs.readFileSync(path.join(PKG_ROOT, "recipes", "INDEX.json"), "utf8"),
    ) as unknown;
    const pi = JSON.parse(
      fs.readFileSync(path.join(PKG_ROOT, "personas", "INDEX.json"), "utf8"),
    ) as unknown;
    expect(Array.isArray(ri)).toBe(true);
    expect(Array.isArray(pi)).toBe(true);
  });

  it("INDEX files end with a newline", () => {
    run("generate-skills");
    const ri = fs.readFileSync(path.join(PKG_ROOT, "recipes", "INDEX.json"), "utf8");
    const pi = fs.readFileSync(path.join(PKG_ROOT, "personas", "INDEX.json"), "utf8");
    expect(ri.endsWith("\n")).toBe(true);
    expect(pi.endsWith("\n")).toBe(true);
  });
});
