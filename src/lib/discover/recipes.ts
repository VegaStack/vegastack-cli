// Recipe loader.
//
// Reads `bundle/recipes/*.toml` files (parsed via `@iarna/toml` — already
// in deps). Filters by:
//   1. `triggers[]` matched against current query/tokens (same semantics
//      as knowledge cards).
//   2. Optional `providers[]` overlap with the detected provider — when
//      a provider is set, recipe.providers must contain it (or be empty).
//
// Empty `bundle/recipes/` is NOT an error — returns []. Closes F3, F4.

import * as fs from "node:fs";
import * as path from "node:path";
import TOML from "@iarna/toml";
import { matchesAnyTrigger } from "./knowledge.js";
import type { KnowledgeTrigger, RecipeMatch } from "./types.js";

interface RawRecipe {
  id?: string;
  providers?: string[];
  triggers?: unknown[];
  scaffold?: { hcl?: string };
  pitfalls?: { note?: string; severity?: string }[];
}

export interface LoadRecipesArgs {
  bundleRoot: string;
  tokens: string[];
  query: string;
  provider?: string;
}

export function loadRecipes(args: LoadRecipesArgs): RecipeMatch[] {
  const dir = path.join(args.bundleRoot, "recipes");
  const files = listTomlFiles(dir);
  if (files.length === 0) return [];

  const tokenSet = new Set(args.tokens);
  const qLower = args.query.toLowerCase();

  const out: RecipeMatch[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let parsed: RawRecipe;
    try {
      parsed = TOML.parse(raw) as RawRecipe;
    } catch {
      continue;
    }
    if (!parsed.id) continue;

    const providers = Array.isArray(parsed.providers)
      ? [...parsed.providers].sort((a, b) => a.localeCompare(b))
      : [];

    if (args.provider !== undefined && providers.length > 0 && !providers.includes(args.provider)) {
      continue;
    }

    const triggers = normalizeTriggers(parsed.triggers);
    if (!matchesAnyTrigger(triggers, tokenSet, qLower)) continue;

    const pitfalls = Array.isArray(parsed.pitfalls)
      ? parsed.pitfalls
          .filter((p): p is { note: string; severity?: string } => typeof p?.note === "string")
          .map((p) => {
            const sev = p.severity;
            const out: { note: string; severity?: "info" | "warn" | "error" } = { note: p.note };
            if (sev === "info" || sev === "warn" || sev === "error") out.severity = sev;
            return out;
          })
      : [];

    out.push({
      id: parsed.id,
      providers,
      triggers,
      scaffold_hcl: parsed.scaffold?.hcl ?? "",
      pitfalls,
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function listTomlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.toml$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function normalizeTriggers(raw: unknown): KnowledgeTrigger[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeTrigger[] = [];
  for (const t of raw) {
    if (typeof t !== "object" || t === null) continue;
    const obj = t as Record<string, unknown>;
    if (Array.isArray(obj.tokens) && obj.tokens.every((x): x is string => typeof x === "string")) {
      out.push({ tokens: obj.tokens });
    } else if (typeof obj.phrase === "string") {
      out.push({ phrase: obj.phrase });
    }
  }
  return out;
}
