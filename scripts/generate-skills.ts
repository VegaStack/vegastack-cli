#!/usr/bin/env -S node --enable-source-maps
// generate-skills — read recipes/recipes.toml + personas/personas.toml,
// emit one SKILL.md per entry plus deterministic INDEX.json files.
//
// Determinism guarantees (enforced by tests/CI):
//   - Stable iteration order: entries sorted by id.
//   - No timestamps in the output (uses last_verified from each entry).
//   - JSON.stringify with sorted keys and 2-space indent.
//   - Newline-terminated files.
//   - When the registries are empty, output is identical to "no input".
//
// Run via:  npm run generate-skills
//
// Run is a no-op when the TOMLs contain no [[recipes]] / [[personas]] tables.
// CI's `sync-skills.yml` workflow runs this on every PR and fails the build
// if `git diff` shows any untracked changes — i.e., contributors must commit
// what they regenerated.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import toml from "@iarna/toml";

interface Recipe {
  id: string;
  intent: string;
  providers: string[];
  keywords: string[];
  title: string;
  description: string;
  required_resources: Record<string, string[]>;
  data_sources?: Record<string, string[]>;
  authoritative_sources?: string[];
  last_verified: string;
  owner: string;
  body: string;
}

interface Persona {
  id: string;
  title: string;
  description: string;
  providers: string[];
  recipes: string[];
  keywords: string[];
  instructions: string[];
  last_verified: string;
  owner: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const RECIPE_TOML = path.join(ROOT, "recipes", "recipes.toml");
const PERSONA_TOML = path.join(ROOT, "personas", "personas.toml");
const RECIPE_INDEX = path.join(ROOT, "recipes", "INDEX.json");
const PERSONA_INDEX = path.join(ROOT, "personas", "INDEX.json");
const RECIPE_SKILLS_DIR = path.join(ROOT, "skills", "recipes");
const PERSONA_SKILLS_DIR = path.join(ROOT, "skills", "personas");

interface ParsedTable {
  recipes?: Recipe[];
  personas?: Persona[];
}

function readToml(file: string): ParsedTable {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  return toml.parse(raw) as unknown as ParsedTable;
}

function sortedJson(value: unknown): string {
  // Stable JSON: sort keys at every object level. Keeps INDEX.json diff-free
  // across regenerations even if @iarna/toml or the source order changes.
  const stable = JSON.stringify(value, sortedReplacer, 2);
  return `${stable}\n`;
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]]),
  );
}

function ensureCleanDir(dir: string): void {
  // We always rewrite the entire output dir so removed entries don't linger.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfChanged(file: string, content: string): boolean {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (existing === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

// ── Recipes ────────────────────────────────────────────────────
function renderRecipeSkill(r: Recipe): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: recipe-${r.id}`);
  lines.push(`description: |`);
  for (const dline of r.description.trim().split("\n")) lines.push(`  ${dline}`);
  lines.push(`license: MIT`);
  lines.push("metadata:");
  lines.push(`  recipe_id: "${r.id}"`);
  lines.push(`  intent: "${r.intent}"`);
  lines.push(`  providers: ${JSON.stringify(r.providers)}`);
  lines.push(`  last_verified: "${r.last_verified}"`);
  lines.push(`  owner: "${r.owner}"`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${r.title}`);
  lines.push("");
  lines.push(r.description.trim());
  lines.push("");
  lines.push("## Required resources");
  lines.push("");
  for (const provider of Object.keys(r.required_resources).sort()) {
    lines.push(`- **${provider}** — ${r.required_resources[provider]?.join(", ") ?? ""}`);
  }
  lines.push("");
  if (r.data_sources && Object.keys(r.data_sources).length > 0) {
    lines.push("## Data sources");
    lines.push("");
    for (const provider of Object.keys(r.data_sources).sort()) {
      lines.push(`- **${provider}** — ${r.data_sources[provider]?.join(", ") ?? ""}`);
    }
    lines.push("");
  }
  if (r.authoritative_sources && r.authoritative_sources.length > 0) {
    lines.push("## Authoritative sources");
    lines.push("");
    for (const src of r.authoritative_sources) lines.push(`- <${src}>`);
    lines.push("");
  }
  lines.push("## Body");
  lines.push("");
  lines.push(r.body.trim());
  lines.push("");
  return lines.join("\n");
}

function emitRecipes(): { count: number; written: number } {
  const parsed = readToml(RECIPE_TOML);
  const recipes = (parsed.recipes ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));

  ensureCleanDir(RECIPE_SKILLS_DIR);

  let written = 0;
  for (const r of recipes) {
    const dst = path.join(RECIPE_SKILLS_DIR, r.id, "SKILL.md");
    if (writeIfChanged(dst, renderRecipeSkill(r))) written += 1;
  }

  // INDEX.json — minimal, normalized, no body text (it lives in SKILL.md).
  const index = recipes.map((r) => ({
    id: r.id,
    intent: r.intent,
    providers: [...r.providers].sort(),
    keywords: [...r.keywords].sort(),
    title: r.title,
    last_verified: r.last_verified,
    owner: r.owner,
  }));
  if (writeIfChanged(RECIPE_INDEX, sortedJson(index))) written += 1;
  return { count: recipes.length, written };
}

// ── Personas ───────────────────────────────────────────────────
function renderPersonaSkill(p: Persona): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: persona-${p.id}`);
  lines.push(`description: |`);
  for (const dline of p.description.trim().split("\n")) lines.push(`  ${dline}`);
  lines.push("metadata:");
  lines.push(`  persona_id: "${p.id}"`);
  lines.push(`  providers: ${JSON.stringify(p.providers)}`);
  lines.push(`  last_verified: "${p.last_verified}"`);
  lines.push(`  owner: "${p.owner}"`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${p.title}`);
  lines.push("");
  lines.push(p.description.trim());
  lines.push("");
  lines.push(`Typical providers: ${p.providers.join(", ")}`);
  lines.push("");
  if (p.recipes.length > 0) {
    lines.push("## Recipes");
    lines.push("");
    for (const id of p.recipes) lines.push(`- [\`${id}\`](../recipes/${id}/SKILL.md)`);
    lines.push("");
  }
  if (p.instructions.length > 0) {
    lines.push("## Tips");
    lines.push("");
    for (const tip of p.instructions) lines.push(`- ${tip}`);
    lines.push("");
  }
  return lines.join("\n");
}

function emitPersonas(): { count: number; written: number } {
  const parsed = readToml(PERSONA_TOML);
  const personas = (parsed.personas ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));

  ensureCleanDir(PERSONA_SKILLS_DIR);

  let written = 0;
  for (const p of personas) {
    const dst = path.join(PERSONA_SKILLS_DIR, p.id, "SKILL.md");
    if (writeIfChanged(dst, renderPersonaSkill(p))) written += 1;
  }

  const index = personas.map((p) => ({
    id: p.id,
    title: p.title,
    providers: [...p.providers].sort(),
    keywords: [...p.keywords].sort(),
    recipes: [...p.recipes].sort(),
    last_verified: p.last_verified,
    owner: p.owner,
  }));
  if (writeIfChanged(PERSONA_INDEX, sortedJson(index))) written += 1;
  return { count: personas.length, written };
}

// ── Main ───────────────────────────────────────────────────────
function main(): void {
  const r = emitRecipes();
  const p = emitPersonas();
  process.stderr.write(
    `generate-skills: recipes=${r.count} personas=${p.count} files_written=${r.written + p.written}\n`,
  );
}

main();
