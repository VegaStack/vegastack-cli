// Concept-alias loader.
//
// Reads `bundle/<provider>/aliases.yaml` for the detected provider, parses
// each entry into an AliasRewrite, and provides a query-matching helper used
// by tokenize() to fold aliases BEFORE token splitting.
//
// On-disk format (binding from /tmp/synthesis/contracts/format-examples.md):
//
//   - phrase: "protect from bots"
//     alias: bot_protection
//     resources:
//       - cloudflare_bot_management
//       - cloudflare_turnstile_widget
//     rule_phase: bot_management   # optional
//
// Empty `aliases.yaml` is NOT an error — returns []. Closes F3, F4.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { AliasRewrite } from "./tokenize.js";
import type { ConceptAliasMatch } from "./types.js";

interface RawAlias {
  phrase?: string;
  alias?: string;
  resources?: string[];
  rule_phase?: string;
}

export interface LoadAliasesArgs {
  bundleRoot: string;
  provider: string;
}

/** Load all aliases for one provider. Returns [] when the file is absent
 *  or empty — that is NOT an error. */
export function loadAliases(args: LoadAliasesArgs): AliasRewrite[] {
  const file = path.join(args.bundleRoot, args.provider, "aliases.yaml");
  if (!fs.existsSync(file)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: AliasRewrite[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as RawAlias;
    if (!obj.phrase || !obj.alias || !Array.isArray(obj.resources)) continue;
    out.push({
      phrase: obj.phrase,
      alias: obj.alias,
      resources: obj.resources.filter((r): r is string => typeof r === "string"),
      provider: args.provider,
    });
  }
  return out;
}

/** Convert AliasRewrite[] (the matches that fired) into the public
 *  ConceptAliasMatch[] envelope shape. */
export function aliasesToConceptMatches(matches: AliasRewrite[]): ConceptAliasMatch[] {
  return matches.map((m) => ({
    phrase: m.phrase,
    provider: m.provider,
    matched_alias: m.alias,
    resources: m.resources.slice(),
  }));
}
