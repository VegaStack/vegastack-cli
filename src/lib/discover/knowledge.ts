// Knowledge-card loader.
//
// Reads `Registry pack/knowledge/*.md` files, parses YAML frontmatter via
// gray-matter (4.x — battle-tested by Astro/Gatsby/Vitepress), and returns
// the cards whose `triggers[]` matched the current query.
//
// Trigger semantics (binding from /tmp/synthesis/contracts/format-examples.md):
//   • { tokens: [a, b, c] }    — ALL tokens must appear in tokenize(query)
//   • { phrase: "..." }        — case-insensitive substring of original query
// A card matches if ANY trigger matches.
//
// Empty `Registry pack/knowledge/` is NOT an error — returns []. Closes F3, F4.

import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import { stem } from "./tokenize.js";
import type { KnowledgeCard, KnowledgeTrigger } from "./types.js";

interface RawCardFrontmatter {
  id?: string;
  title?: string;
  date_authored?: string;
  authoritative_source?: string;
  providers?: string[];
  triggers?: unknown[];
  overrides_training?: boolean;
}

export interface LoadKnowledgeArgs {
  /** Path to the Terraform root (the dir that contains `knowledge/`). */
  terraformRoot: string;
  /** Tokenized query — used by `tokens` triggers. */
  tokens: string[];
  /** Original (untokenized) query — used by `phrase` triggers. */
  query: string;
  /** Optional provider filter. When provided, only cards whose `providers`
   *  list contains the provider OR contains "*" are eligible. */
  provider?: string;
}

/** Hard cap on a single knowledge card's on-disk size (1 MiB). Cards larger
 *  than this are skipped during load to bound memory. */
export const MAX_KNOWLEDGE_BYTES = 1024 * 1024;

interface ParsedCardEntry {
  mtimeMs: number;
  data: RawCardFrontmatter | null;
  body: string;
}

const PARSE_CACHE = new Map<string, ParsedCardEntry>();

/** Reset the module-level parsed-card cache. Test-only. */
export function clearKnowledgeCache(): void {
  PARSE_CACHE.clear();
}

function getParsedCard(file: string): ParsedCardEntry | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = PARSE_CACHE.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
  if (stat.size > MAX_KNOWLEDGE_BYTES) {
    const skipped: ParsedCardEntry = { mtimeMs: stat.mtimeMs, data: null, body: "" };
    PARSE_CACHE.set(file, skipped);
    return skipped;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    const bad: ParsedCardEntry = { mtimeMs: stat.mtimeMs, data: null, body: "" };
    PARSE_CACHE.set(file, bad);
    return bad;
  }
  const entry: ParsedCardEntry = {
    mtimeMs: stat.mtimeMs,
    data: parsed.data as RawCardFrontmatter,
    body: parsed.content.trim(),
  };
  PARSE_CACHE.set(file, entry);
  return entry;
}

export function loadKnowledge(args: LoadKnowledgeArgs): KnowledgeCard[] {
  const dir = path.join(args.terraformRoot, "knowledge");
  const files = listMarkdownFiles(dir);
  if (files.length === 0) return [];

  const tokenSet = new Set(args.tokens);
  const qLower = args.query.toLowerCase();

  const out: KnowledgeCard[] = [];
  for (const file of files) {
    const entry = getParsedCard(file);
    if (!entry?.data) continue;
    const data = entry.data;
    if (!data.id) continue;

    // Provider filter.
    const providers = Array.isArray(data.providers) ? data.providers : [];
    if (
      args.provider !== undefined &&
      providers.length > 0 &&
      !providers.includes(args.provider) &&
      !providers.includes("*")
    ) {
      continue;
    }

    const triggers = normalizeTriggers(data.triggers);
    if (!matchesAnyTrigger(triggers, tokenSet, qLower)) continue;

    out.push({
      id: data.id,
      title: data.title ?? data.id,
      date_authored: data.date_authored ?? "",
      authoritative_source: data.authoritative_source ?? "",
      providers,
      triggers,
      overrides_training: Boolean(data.overrides_training),
      body: entry.body,
    });
  }

  // Stable order: id ascending.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
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

export function matchesAnyTrigger(
  triggers: KnowledgeTrigger[],
  tokenSet: Set<string>,
  qLower: string,
): boolean {
  // Stem-aware lookup: a trigger token "lock" should match a query token
  // "locking" (and vice-versa). We build a set of all candidate forms for
  // the query side once, then test each trigger token (and its stem)
  // against it.
  let stemmedTokenSet: Set<string> | undefined;
  const tokensWithStems = (): Set<string> => {
    if (stemmedTokenSet) return stemmedTokenSet;
    const s = new Set<string>();
    for (const tok of tokenSet) {
      const lower = tok.toLowerCase();
      s.add(lower);
      const st = stem(lower);
      if (st !== lower) s.add(st);
    }
    stemmedTokenSet = s;
    return s;
  };

  for (const t of triggers) {
    if ("tokens" in t) {
      if (t.tokens.length === 0) continue;
      const candidates = tokensWithStems();
      if (
        t.tokens.every((tok) => {
          const lower = tok.toLowerCase();
          if (candidates.has(lower)) return true;
          const st = stem(lower);
          return st !== lower && candidates.has(st);
        })
      )
        return true;
    } else if ("phrase" in t) {
      if (qLower.includes(t.phrase.toLowerCase())) return true;
    }
  }
  return false;
}
