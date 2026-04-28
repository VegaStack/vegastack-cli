// MCP tool: tf_get_knowledge_card — fetch a single curated knowledge card.
// Knowledge cards live in `cli/bundle/knowledge/<id>.md` with YAML frontmatter
// (see docs/contracts/format-examples.md). E3 publishes them; the
// build-and-publish workflow uploads each card as an individual R2 object.
//
// We do NOT bundle a YAML parser into the worker — frontmatter is parsed by
// hand using a small regex (sufficient for the constrained card schema).

import { z } from "zod";
import { BundleNotFound, readBundleText } from "../lib/r2-bundle.js";
import type { KnowledgeCard, KnowledgeTrigger } from "../lib/types.js";
import { jsonContent } from "./_shared.js";

export const tfGetKnowledgeCardSchema = {
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .describe("Knowledge card id, e.g. 'aws-s3-native-state-locking'."),
};

export const tfGetKnowledgeCardDescription =
  "Fetch a single curated knowledge card by id. Cards override model training when " +
  "`overrides_training: true`. The body is markdown with the YAML frontmatter stripped.";

export type TfGetKnowledgeCardArgs = { id: string };

export async function handleTfGetKnowledgeCard(env: Env, args: TfGetKnowledgeCardArgs) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.id)) {
    return jsonContent({
      status: "error",
      error: `invalid card id: ${args.id}`,
      code: "BadRequest",
    });
  }
  const key = `cli/bundle/knowledge/${args.id}.md`;
  let raw: string;
  try {
    raw = await readBundleText(env, key);
  } catch (e) {
    if (e instanceof BundleNotFound) {
      return jsonContent({
        status: "error",
        error: `knowledge card not found: ${args.id}`,
        code: "NotFound",
      });
    }
    throw e;
  }

  return jsonContent(parseKnowledgeCard(args.id, raw));
}

// ─── frontmatter parser ───────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseKnowledgeCard(id: string, raw: string): KnowledgeCard {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return {
      id,
      title: id,
      date_authored: "",
      authoritative_source: "",
      providers: [],
      triggers: [],
      overrides_training: false,
      body: raw,
    };
  }
  const frontmatter = parseSimpleYaml(match[1]!);
  return {
    id,
    title: stringField(frontmatter, "title") ?? id,
    date_authored: stringField(frontmatter, "date_authored") ?? "",
    authoritative_source: stringField(frontmatter, "authoritative_source") ?? "",
    providers: arrayOfStrings(frontmatter, "providers"),
    triggers: parseTriggers(frontmatter),
    overrides_training: boolField(frontmatter, "overrides_training") ?? false,
    body: match[2] ?? "",
  };
}

// Tiny YAML-subset parser: handles `key: value`, `key: [a, b]`, and nested
// list-of-objects via 2-space indented `- key: value` blocks. Sufficient for
// knowledge / recipe frontmatter — NOT a general YAML parser.
function parseSimpleYaml(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    const valRaw = m[2] ?? "";
    if (valRaw === "" || valRaw === "|" || valRaw === ">") {
      // Block scalar or nested list.
      const nested: unknown[] = [];
      i++;
      const blockLines: string[] = [];
      while (i < lines.length) {
        const sub = lines[i]!;
        if (/^\S/.test(sub) && sub.trim() !== "") break;
        if (/^\s*-\s/.test(sub)) {
          // list item
          const item = readListItem(lines, i);
          nested.push(item.value);
          i = item.nextIndex;
          continue;
        }
        blockLines.push(sub);
        i++;
      }
      if (nested.length > 0) out[key] = nested;
      else out[key] = blockLines.map((l) => l.replace(/^\s\s/, "")).join("\n").trim();
      continue;
    }
    out[key] = parseScalar(valRaw);
    i++;
  }
  return out;
}

function readListItem(
  lines: string[],
  startIndex: number,
): { value: unknown; nextIndex: number } {
  // Inline scalar list item: "- foo"
  const first = lines[startIndex]!;
  const inline = first.match(/^\s*-\s+(.*)$/);
  if (!inline) return { value: null, nextIndex: startIndex + 1 };
  const tail = inline[1]!;
  // Object form: "- key: value"
  const objMatch = tail.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
  if (objMatch) {
    const obj: Record<string, unknown> = {};
    obj[objMatch[1]!] = parseScalar(objMatch[2] ?? "");
    let i = startIndex + 1;
    while (i < lines.length) {
      const ln = lines[i]!;
      if (/^\s*-\s/.test(ln)) break;
      if (!/^\s+\S/.test(ln)) break;
      const m = ln.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (m) obj[m[1]!] = parseScalar(m[2] ?? "");
      i++;
    }
    return { value: obj, nextIndex: i };
  }
  return { value: parseScalar(tail), nextIndex: startIndex + 1 };
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseScalar(s));
  }
  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stringField(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}
function boolField(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  return typeof v === "boolean" ? v : undefined;
}
function arrayOfStrings(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}
function parseTriggers(o: Record<string, unknown>): KnowledgeTrigger[] {
  const v = o.triggers;
  if (!Array.isArray(v)) return [];
  const out: KnowledgeTrigger[] = [];
  for (const item of v) {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj.tokens)) {
        out.push({ tokens: obj.tokens.map((x) => String(x)) });
      } else if (typeof obj.phrase === "string") {
        out.push({ phrase: obj.phrase });
      }
    }
  }
  return out;
}
