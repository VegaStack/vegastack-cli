// src/agents/skill-source.ts
//
// Loads the canonical SKILL.md once and caches it per process. Renderers
// consume the result. The on-disk source is the package-installed
// `skills/vegastack/SKILL.md` (which itself is generated from
// `registry/skill-source/SKILL.md.template` by `scripts/generate-skill-from-registry.ts`).

import * as fs from "node:fs";
import * as path from "node:path";

import { pkgRoot } from "../lib/paths.js";
import type { CanonicalSkill, SkillSourceLoader } from "./types.js";

/**
 * Default skill source: the package's own SKILL.md.
 * Tests pass an alternative SkillSourceLoader to point at a fixture.
 */
export class PackageSkillSource implements SkillSourceLoader {
  private cached: CanonicalSkill | null = null;

  constructor(private readonly skillPath: string = defaultSkillPath()) {}

  load(): CanonicalSkill {
    if (this.cached) return this.cached;
    const body = fs.readFileSync(this.skillPath, "utf8");
    this.cached = parseSkill(body);
    return this.cached;
  }
}

function defaultSkillPath(): string {
  return path.join(pkgRoot(), "skills", "vegastack", "SKILL.md");
}

/**
 * Parses a SKILL.md file (YAML frontmatter + markdown body) into a
 * `CanonicalSkill`. Tolerates missing optional fields; throws when the
 * required `name` or `description` is absent.
 *
 * Note: deliberately tiny YAML parser — no js-yaml dependency. We support
 * scalar values, list-of-strings (`[a, b]` or block-style `- a`), and
 * folded multiline scalars (`description: |`). That's all SKILL.md needs.
 */
export function parseSkill(raw: string): CanonicalSkill {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (fmMatch?.[1] == null || fmMatch[2] == null) {
    throw new Error("SKILL.md missing YAML frontmatter (`---` fences)");
  }
  const meta = parseFrontmatter(fmMatch[1]);

  const name = typeof meta.name === "string" ? meta.name : null;
  const description = typeof meta.description === "string" ? meta.description : null;
  if (!name) throw new Error("SKILL.md frontmatter missing `name`");
  if (!description) throw new Error("SKILL.md frontmatter missing `description`");

  const allowedToolsRaw = meta["allowed-tools"];
  let allowedTools: string[] = [];
  if (typeof allowedToolsRaw === "string") {
    allowedTools = allowedToolsRaw
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(allowedToolsRaw)) {
    allowedTools = allowedToolsRaw.map((s) => String(s));
  }

  return {
    name,
    description: description.trim(),
    body: raw,
    metadata: meta,
    allowedTools,
  };
}

/**
 * Minimal YAML frontmatter parser. Returns an object with raw values:
 * - scalar strings (with `|` folded scalars supported)
 * - flow lists (`[a, b, c]`)
 * - nested dict blocks (one level deep — used for `metadata:`)
 *
 * Anything more exotic should be expressed elsewhere (the SKILL.md template
 * is intentionally simple). We cannot pull in js-yaml from `src/agents/`
 * without a dependency bump and this code path runs in the postinstall
 * skills-install hot-path.
 */
function parseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m?.[1] == null) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2] ?? "";

    if (rest === "|" || rest === ">") {
      // Folded / literal block scalar. Read indented continuation lines.
      const collected: string[] = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        // Spec-compliant YAML forbids tab indentation; silently truncating
        // at the first tab would discard the description body. Diagnose.
        if (cur.startsWith("\t")) {
          throw new Error(
            `SKILL.md frontmatter line ${i + 1}: tab-indented continuation is not allowed (use two spaces)`,
          );
        }
        if (!cur.startsWith("  ") && cur.trim() !== "") break;
        collected.push(cur.replace(/^ {2}/, ""));
        i++;
      }
      out[key] = collected.join("\n").trim();
      continue;
    }

    if (rest === "") {
      // Nested block — collect indented `key: value` lines as a sub-dict.
      const sub: Record<string, unknown> = {};
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        if (cur.startsWith("\t")) {
          throw new Error(
            `SKILL.md frontmatter line ${i + 1}: tab-indented nested key is not allowed (use two spaces)`,
          );
        }
        if (!cur.startsWith("  ") && cur.trim() !== "") break;
        if (cur.trim() === "") {
          i++;
          continue;
        }
        const sm = /^ {2}([A-Za-z0-9_-]+):\s*(.*)$/.exec(cur);
        if (sm?.[1] != null) sub[sm[1]] = stripQuotes(sm[2] ?? "");
        i++;
      }
      out[key] = sub;
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      // Flow list.
      out[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
      i++;
      continue;
    }

    out[key] = stripQuotes(rest);
    i++;
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.length < 2) return s;
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}
