import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { VegaStackError } from "./errors.js";
import { log } from "./log.js";
import { registryEntryCachePath } from "./project.js";
import { installRipgrep, resolveRipgrepBin, ripgrepVersion } from "./ripgrep.js";

const TEXT_EXT =
  /\.(md|mdx|markdown|adoc|asciidoc|txt|ya?ml|json|toml|rst|xml|html?|py|js|ts|tsx|jsx|sh|bash|zsh|tf|hcl)$/i;
const QUERY_STOPWORDS = new Set([
  "how",
  "use",
  "using",
  "to",
  "the",
  "and",
  "for",
  "with",
  "in",
  "on",
  "of",
  "a",
  "an",
  "is",
  "it",
  "file",
  "docs",
  "doc",
  "this",
  "that",
  "what",
  "when",
  "where",
  "why",
  "can",
  "should",
]);
const SHORT_DOMAIN_TOKENS = new Set([
  "ai",
  "d1",
  "ec2",
  "ecr",
  "eks",
  "gke",
  "iam",
  "kv",
  "r2",
  "s3",
]);

export interface RegistrySearchOptions {
  entries: string[];
  query: string;
  max?: number;
  regex?: boolean;
  ignoreCase?: boolean;
  installTools?: boolean;
}

export interface RegistrySearchMatch {
  registry_entry: string;
  path: string;
  line: number;
  column: number;
  text: string;
  byte_start?: number;
  byte_end?: number;
  verified: boolean;
}

export interface RegistrySearchResult {
  query: string;
  mode: "literal" | "regex";
  engine: "ripgrep" | "typescript";
  engine_version?: string;
  policy_hash: string;
  registry_entries: string[];
  matches: RegistrySearchMatch[];
  skipped: { registry_entry?: string; path?: string; reason: string }[];
  citations: string[];
  warnings?: string[];
}

interface ArtifactIndex {
  files?: { path: string; bytes: number; sha256: string }[];
}

interface RgEvent {
  type?: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    absolute_offset?: number;
    submatches?: { start: number; end: number }[];
  };
}

export async function searchRegistry(opts: RegistrySearchOptions): Promise<RegistrySearchResult> {
  if (!opts.query || opts.query.trim() === "") {
    throw new VegaStackError("ValidationError", 'usage: vegastack search "<query>"');
  }
  const max = opts.max ?? 20;
  const skipped: RegistrySearchResult["skipped"] = [];
  const warnings: string[] = [];
  const entries = [...new Set(opts.entries)].sort();
  if (entries.length === 0) {
    throw new VegaStackError("ValidationError", "no registry entries selected for search");
  }
  for (const entry of entries) {
    const root = registryEntryCachePath(entry);
    if (
      !fs.existsSync(path.join(root, "MANIFEST.json")) ||
      !fs.existsSync(path.join(root, "docs"))
    ) {
      throw new VegaStackError(
        "ValidationError",
        `Registry pack '${entry}' is not installed or does not contain docs`,
        { context: { entry, path: root } },
      );
    }
  }

  const rg = await resolveSearchRipgrep(opts.installTools ?? true, warnings);
  const policyHash = searchPolicyHash({
    mode: opts.regex ? "regex" : "literal",
    ignoreCase: Boolean(opts.ignoreCase),
    entries,
  });

  const matches: RegistrySearchMatch[] = [];
  if (rg) {
    for (const entry of entries) {
      matches.push(
        ...searchWithRipgrep({
          entry,
          root: registryEntryCachePath(entry),
          query: opts.query,
          regex: Boolean(opts.regex),
          ignoreCase: Boolean(opts.ignoreCase),
          bin: rg,
          skipped,
        }),
      );
    }
  } else {
    for (const entry of entries) {
      matches.push(
        ...searchWithTypescript({
          entry,
          root: registryEntryCachePath(entry),
          query: opts.query,
          regex: Boolean(opts.regex),
          ignoreCase: Boolean(opts.ignoreCase),
          skipped,
        }),
      );
    }
  }

  matches.sort(
    (a, b) =>
      a.registry_entry.localeCompare(b.registry_entry) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.column - b.column,
  );
  const capped = matches.slice(0, max);
  verifyMatches(capped);
  return {
    query: opts.query,
    mode: opts.regex ? "regex" : "literal",
    engine: rg ? "ripgrep" : "typescript",
    ...(rg ? { engine_version: ripgrepVersion(rg) ?? rg } : {}),
    policy_hash: policyHash,
    registry_entries: entries,
    matches: capped,
    skipped,
    citations: capped.map((m) => `${m.registry_entry}:${m.path}:L${m.line}`),
    ...(warnings.length ? { warnings } : {}),
  };
}

export function searchTermsForQuery(query: string, maxTerms = 4): string[] {
  const lower = query.toLowerCase();
  const quoted = [...query.matchAll(/"([^"]{2,80})"/g)].map((m) => m[1]!).filter(Boolean);
  const hyphenated = [...query.matchAll(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+/g)].map((m) => m[0]);
  const rawTokens = rawQueryTokens(query);
  const tokens =
    rawTokens.length === 1
      ? rawTokens.filter((t) => usefulStandaloneSearchToken(t) && lower.includes(t))
      : [];
  const phrases: string[] = [];
  for (let size = Math.min(4, rawTokens.length); size >= 2; size--) {
    for (let i = 0; i + size <= rawTokens.length; i++) {
      phrases.push(rawTokens.slice(i, i + size).join(" "));
    }
  }
  return [...new Set([...quoted, ...hyphenated, ...phrases, ...tokens])].slice(0, maxTerms);
}

function rawQueryTokens(query: string): string[] {
  return (query.toLowerCase().match(/[a-z0-9]+(?:[_-][a-z0-9]+)*/g) ?? []).filter((t) =>
    usefulSearchToken(t),
  );
}

function usefulSearchToken(token: string): boolean {
  return (
    !/^\d+$/.test(token) &&
    !QUERY_STOPWORDS.has(token) &&
    (token.length > 2 || SHORT_DOMAIN_TOKENS.has(token))
  );
}

function usefulStandaloneSearchToken(token: string): boolean {
  return (
    !/^\d+$/.test(token) &&
    !QUERY_STOPWORDS.has(token) &&
    (token.length > 2 || SHORT_DOMAIN_TOKENS.has(token))
  );
}

async function resolveSearchRipgrep(
  installTools: boolean,
  warnings: string[],
): Promise<string | null> {
  const existing = resolveRipgrepBin();
  if (existing) return existing;
  if (!installTools || process.env.VEGASTACK_NO_MANAGED_TOOLS === "1") return null;
  try {
    const installed = await installRipgrep();
    return installed.bin;
  } catch (e) {
    warnings.push(`managed ripgrep unavailable; using TypeScript fallback (${errorMessage(e)})`);
    log.warn(warnings[warnings.length - 1]!);
    return resolveRipgrepBin();
  }
}

function searchWithRipgrep(args: {
  entry: string;
  root: string;
  query: string;
  regex: boolean;
  ignoreCase: boolean;
  bin: string;
  skipped: RegistrySearchResult["skipped"];
}): RegistrySearchMatch[] {
  const docsRoot = path.join(args.root, "docs");
  if (!fs.existsSync(docsRoot)) {
    args.skipped.push({
      registry_entry: args.entry,
      reason: `docs directory missing at ${docsRoot}`,
    });
    return [];
  }
  const rgArgs = [
    "--json",
    ...(args.regex ? [] : ["--fixed-strings"]),
    args.ignoreCase ? "--ignore-case" : "--case-sensitive",
    "--engine",
    "default",
    "--no-config",
    "--no-ignore",
    "--hidden",
    "--glob",
    "!**/.git/**",
    "--sort",
    "path",
    "--path-separator",
    "/",
    "--encoding",
    "utf-8",
    "--no-mmap",
    "-e",
    args.query,
    docsRoot,
  ];
  const r = spawnSync(args.bin, rgArgs, {
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== 1) {
    args.skipped.push({
      registry_entry: args.entry,
      reason: `ripgrep failed: ${(r.stderr || r.stdout || "").trim()}`,
    });
    return searchWithTypescript({
      entry: args.entry,
      root: args.root,
      query: args.query,
      regex: args.regex,
      ignoreCase: args.ignoreCase,
      skipped: args.skipped,
    });
  }
  const out: RegistrySearchMatch[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    let event: RgEvent;
    try {
      event = JSON.parse(line) as RgEvent;
    } catch {
      continue;
    }
    if (event.type !== "match") continue;
    const data = event.data;
    const fullPath = data?.path?.text;
    const text = data?.lines?.text;
    const lineNumber = data?.line_number;
    const sub = data?.submatches?.[0];
    if (!fullPath || text === undefined || !lineNumber || !sub) continue;
    const rel = path.relative(args.root, fullPath).split(path.sep).join("/");
    out.push({
      registry_entry: args.entry,
      path: rel,
      line: lineNumber,
      column: sub.start + 1,
      text: text.replace(/\r?\n$/, ""),
      byte_start: (data?.absolute_offset ?? 0) + sub.start,
      byte_end: (data?.absolute_offset ?? 0) + sub.end,
      verified: false,
    });
  }
  return out;
}

function searchWithTypescript(args: {
  entry: string;
  root: string;
  query: string;
  regex: boolean;
  ignoreCase: boolean;
  skipped: RegistrySearchResult["skipped"];
}): RegistrySearchMatch[] {
  const docsRoot = path.join(args.root, "docs");
  if (!fs.existsSync(docsRoot)) {
    args.skipped.push({
      registry_entry: args.entry,
      reason: `docs directory missing at ${docsRoot}`,
    });
    return [];
  }
  let matcher: RegExp | string;
  try {
    matcher = args.regex
      ? new RegExp(args.query, args.ignoreCase ? "i" : "")
      : args.ignoreCase
        ? args.query.toLowerCase()
        : args.query;
  } catch (e) {
    throw new VegaStackError("ValidationError", `invalid regex: ${args.query}`, { cause: e });
  }
  const out: RegistrySearchMatch[] = [];
  for (const file of listTextFiles(docsRoot, args.skipped, args.entry)) {
    const rel = path.relative(args.root, file).split(path.sep).join("/");
    const raw = readText(file);
    if (raw === null) {
      args.skipped.push({ registry_entry: args.entry, path: rel, reason: "binary_or_too_large" });
      continue;
    }
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const haystack = args.ignoreCase && typeof matcher === "string" ? line.toLowerCase() : line;
      const match =
        typeof matcher === "string"
          ? { index: haystack.indexOf(matcher), length: matcher.length }
          : regexpLineMatch(matcher, line);
      if (match.index < 0) continue;
      out.push({
        registry_entry: args.entry,
        path: rel,
        line: i + 1,
        column: match.index + 1,
        text: line,
        verified: false,
      });
    }
  }
  return out;
}

function regexpLineMatch(re: RegExp, line: string): { index: number; length: number } {
  re.lastIndex = 0;
  const m = re.exec(line);
  return m?.index === undefined
    ? { index: -1, length: 0 }
    : { index: m.index, length: m[0].length };
}

function listTextFiles(
  root: string,
  skipped: RegistrySearchResult["skipped"],
  entry: string,
): string[] {
  const out: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let rows: fs.Dirent[];
    try {
      rows = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    for (const row of rows) {
      const full = path.join(dir, row.name);
      if (row.isDirectory()) {
        if (row.name === ".git") continue;
        pending.push(full);
      } else if (row.isFile()) {
        if (TEXT_EXT.test(row.name)) out.push(full);
        else {
          skipped.push({
            registry_entry: entry,
            path: path.relative(root, full).split(path.sep).join("/"),
            reason: "extension_policy",
          });
        }
      }
    }
  }
  return out.sort();
}

function readText(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 5 * 1024 * 1024) return null;
    const raw = fs.readFileSync(file);
    if (raw.includes(0)) return null;
    return raw.toString("utf8");
  } catch {
    return null;
  }
}

function verifyMatches(matches: RegistrySearchMatch[]): void {
  const artifactCache = new Map<string, Map<string, { bytes: number; sha256: string }>>();
  for (const match of matches) {
    const root = registryEntryCachePath(match.registry_entry);
    const artifacts =
      artifactCache.get(match.registry_entry) ?? readArtifactMap(path.join(root, "ARTIFACTS.json"));
    artifactCache.set(match.registry_entry, artifacts);
    assertSafeRelativePath(match.path);
    const file = path.join(root, match.path);
    const expected = artifacts.get(match.path);
    if (!expected || !fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    if (stat.size !== expected.bytes) continue;
    match.verified = fileSha256(file) === expected.sha256;
  }
}

function readArtifactMap(file: string): Map<string, { bytes: number; sha256: string }> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ArtifactIndex;
    return new Map((raw.files ?? []).map((f) => [f.path, { bytes: f.bytes, sha256: f.sha256 }]));
  } catch {
    return new Map();
  }
}

function assertSafeRelativePath(value: string): void {
  if (
    value === "" ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").includes("..")
  ) {
    throw new VegaStackError("ArtifactCorrupt", `unsafe registry artifact path '${value}'`, {
      context: { path: value },
    });
  }
}

function searchPolicyHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function fileSha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
