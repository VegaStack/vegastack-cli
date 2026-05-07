// MCP tool: registry_get_recipe — fetch a single curated recipe by id.
// Recipes live in `cli/packs/terraform/docs/recipes/<id>.toml` (see docs/contracts/format-examples.md).
// The build-and-publish workflow uploads each recipe as an individual R2 object.

import { z } from "zod";
import { RegistryKeyNotFound, readRegistryText } from "../lib/r2-registry.js";
import type { KnowledgeTrigger, RecipeMatch } from "../lib/types.js";
import { jsonContent } from "./_shared.js";

export const registryGetRecipeSchema = {
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .describe("Recipe id, e.g. 'scalable-backend-aws-ecs-fargate-rds-datadog'."),
};

export const registryGetRecipeDescription =
  "Fetch a single curated recipe by id. Recipes are full HCL scaffolds with pitfalls and " +
  "trigger phrases. Use this when terraform_discover surfaced a recipe id and you want the full body.";

export type RegistryGetRecipeArgs = { id: string };

export async function handleRegistryGetRecipe(env: Env, args: RegistryGetRecipeArgs) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.id)) {
    return jsonContent({
      status: "error",
      error: `invalid recipe id: ${args.id}`,
      code: "BadRequest",
    });
  }
  const key = `cli/packs/terraform/docs/recipes/${args.id}.toml`;
  let raw: string;
  try {
    raw = await readRegistryText(env, key);
  } catch (e) {
    if (e instanceof RegistryKeyNotFound) {
      return jsonContent({
        status: "error",
        error: `recipe not found: ${args.id}`,
        code: "NotFound",
      });
    }
    // Do NOT propagate raw error messages — they may contain CF binding
    // names, request IDs, or stack frames. Log server-side and return a
    // generic envelope to the client.
    console.error("registry_get_recipe: internal error", {
      id: args.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return jsonContent({
      status: "error",
      error: "internal error fetching recipe",
      code: "Internal",
    });
  }
  return jsonContent(parseRecipeToml(args.id, raw));
}

// ─── tiny TOML subset parser ──────────────────────────────────────────────
//
// Sufficient for the recipe format (key = "value", arrays of strings/objects,
// triple-quoted multiline strings, and `[[pitfalls]]` array-of-tables).
// We deliberately do NOT Registry pack @iarna/toml into the Worker.

export function parseRecipeToml(id: string, raw: string): RecipeMatch {
  // Extract triple-quoted string fields first, replace with placeholders so we
  // can do line-by-line parsing on the rest.
  const placeholders = new Map<string, string>();
  let counter = 0;
  let work = raw.replace(/"""([\s\S]*?)"""/g, (_, body: string) => {
    const key = `__TQ_${counter++}__`;
    placeholders.set(key, body);
    return `"${key}"`;
  });

  const lines = work.split(/\r?\n/);
  let providers: string[] = [];
  let scaffold = "";
  const triggers: KnowledgeTrigger[] = [];
  const pitfalls: { note: string; severity?: "info" | "warn" | "error" }[] = [];

  let currentTable: string | null = null;
  let currentArrayItem: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
      if (currentTable === "pitfalls" && currentArrayItem) {
        pitfalls.push(coercePitfall(currentArrayItem));
      }
      if (currentTable === "triggers" && currentArrayItem) {
        triggers.push(coerceTrigger(currentArrayItem));
      }
      currentTable = trimmed.slice(2, -2).trim();
      currentArrayItem = {};
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      // Plain table — flush array item if any.
      if (currentTable === "pitfalls" && currentArrayItem) pitfalls.push(coercePitfall(currentArrayItem));
      if (currentTable === "triggers" && currentArrayItem) triggers.push(coerceTrigger(currentArrayItem));
      currentTable = trimmed.slice(1, -1).trim();
      currentArrayItem = null;
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const valRaw = kv[2] ?? "";
    const value = parseTomlValue(valRaw, placeholders);
    if (currentTable === "pitfalls" || currentTable === "triggers") {
      if (currentArrayItem) currentArrayItem[key] = value;
      continue;
    }
    if (currentTable === null) {
      if (key === "providers" && Array.isArray(value)) providers = value.map(String);
      else if (key === "scaffold_hcl" && typeof value === "string") scaffold = value;
    }
  }
  // Flush trailing array item.
  if (currentTable === "pitfalls" && currentArrayItem) pitfalls.push(coercePitfall(currentArrayItem));
  if (currentTable === "triggers" && currentArrayItem) triggers.push(coerceTrigger(currentArrayItem));

  return {
    id,
    providers: [...providers].sort(),
    triggers,
    scaffold_hcl: scaffold,
    pitfalls,
  };
}

function parseTomlValue(raw: string, placeholders: Map<string, string>): unknown {
  const trimmed = raw.trim().replace(/\s*#.*$/, "");
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseTomlValue(s, placeholders));
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    if (placeholders.has(inner)) return placeholders.get(inner)!;
    return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function coercePitfall(o: Record<string, unknown>): { note: string; severity?: "info" | "warn" | "error" } {
  const note = typeof o.note === "string" ? o.note : "";
  const sev = typeof o.severity === "string" ? o.severity : undefined;
  if (sev === "info" || sev === "warn" || sev === "error") return { note, severity: sev };
  return { note };
}

function coerceTrigger(o: Record<string, unknown>): KnowledgeTrigger {
  if (Array.isArray(o.tokens)) return { tokens: o.tokens.map((x) => String(x)) };
  if (typeof o.phrase === "string") return { phrase: o.phrase };
  return { tokens: [] };
}
