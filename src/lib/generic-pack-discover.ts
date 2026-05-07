import * as fs from "node:fs";
import * as path from "node:path";
import { registryEntryCachePath } from "./project.js";
import { tokenize } from "./discover/tokenize.js";
import {
  searchRegistry,
  searchTermsForQuery,
  type RegistrySearchMatch,
} from "./registry-search.js";

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

const KNOWLEDGE_TRIGGER_STOPWORDS = new Set([
  ...QUERY_STOPWORDS,
  "warning",
  "warnings",
  "error",
  "errors",
  "security",
  "secure",
  "note",
  "notes",
]);

const GENERIC_PATH_TOKENS = new Set([
  "service",
  "services",
  "create",
  "get",
  "set",
  "list",
  "docs",
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
const DISTINCTIVE_SHORT_TOKENS = new Set(["d1", "ec2", "ecr", "eks", "gke", "kv", "r2", "s3"]);

export interface GenericPackResult {
  status: "ok" | "error";
  query: string;
  mode: "registry-docs";
  registry_entries: string[];
  knowledge: {
    id: string;
    title: string;
    registry_entry: string;
    path: string;
    section_id: string;
    start_line: number;
    end_line: number;
    triggers: string[];
    excerpt: string;
    authoritative_source: string;
    overrides_training: boolean;
  }[];
  concept_aliases_used: {
    registry_entry: string;
    phrase: string;
    source?: string;
    tokens: string[];
    targets: string[];
  }[];
  dependencies: {
    registry_entry: string;
    name: string;
    source: string;
    evidence?: unknown[];
  }[];
  results: {
    registry_entry: string;
    path: string;
    title?: string;
    section_id?: string;
    heading?: string;
    start_line?: number;
    end_line?: number;
    score: number;
    excerpt: string;
    exact_verified?: boolean;
    exact_matches?: {
      line: number;
      column: number;
      text: string;
    }[];
    match_reasons?: string[];
  }[];
  citations: string[];
  errors?: { registry_entry: string; message: string }[];
  warnings?: string[];
}

interface WeightedRegistrySearchMatch extends RegistrySearchMatch {
  query_term: string;
}

interface DiscoverCtx {
  query: string;
  packs: string[];
  max: number;
  opts: { installTools?: boolean };
  baseTokens: string[];
  querySurfaceTokens: string[];
  queryPhrases: string[];
  results: GenericPackResult["results"];
  knowledge: GenericPackResult["knowledge"];
  conceptAliasesUsed: GenericPackResult["concept_aliases_used"];
  dependencies: GenericPackResult["dependencies"];
  errors: { registry_entry: string; message: string }[];
  warnings: string[];
  exactByEntryPath: Map<string, WeightedRegistrySearchMatch[]>;
}

interface PackContext {
  pack: string;
  root: string;
  docsRoot: string;
  manifest: RegistryManifest | undefined;
  fileTitles: Map<string, string>;
  aliasMatches: GenericPackResult["concept_aliases_used"];
  packAliasBoost: number;
  tokens: string[];
  fileTokenScores: Map<string, number>;
}

function preparePackContext(ctx: DiscoverCtx, pack: string): PackContext | null {
  const root = registryEntryCachePath(pack);
  const docsRoot = path.join(root, "docs");
  const manifest = readManifest(root);
  const fileTitles = manifestFileTitles(manifest);
  if (!fs.existsSync(docsRoot)) {
    ctx.errors.push({ registry_entry: pack, message: `docs directory missing at ${docsRoot}` });
    return null;
  }
  const aliases = readAliases(root);
  const aliasMatches = matchAliases(pack, ctx.query, aliases);
  ctx.conceptAliasesUsed.push(...aliasMatches);
  const routingAliasMatches = aliasMatches.filter(
    (a) => a.source === "configured" || a.source === "terraform-aliases-yaml",
  );
  const packAliasBoost =
    ctx.packs.length > 1 &&
    (routingAliasMatches.length > 0 || queryNamesPack(ctx.query, pack))
      ? 700
      : 0;
  const aliasTokens = aliasMatches.flatMap((a) => a.tokens);
  const tokens = [...new Set([...ctx.baseTokens, ...aliasTokens])];
  const fileTokenScores = manifestFileTokenScores(manifest, tokens);
  const metadataTokens = tokensForMetadata(tokens, pack);
  const dependencyHints = readDependencies(root, metadataTokens).map((d) => ({
    registry_entry: pack,
    ...d,
  }));
  ctx.dependencies.push(...dependencyHints);
  ctx.knowledge.push(...readKnowledge(root, pack, metadataTokens));
  return {
    pack,
    root,
    docsRoot,
    manifest,
    fileTitles,
    aliasMatches,
    packAliasBoost,
    tokens,
    fileTokenScores,
  };
}

function exactSearchTermsForPack(query: string, pack: string): string[] {
  const packNameTokens = new Set(tokenize(pack));
  return searchTermsForQuery(query, 10)
    .filter((term) => {
      const termTokens = tokenize(term);
      return !(termTokens.length > 0 && termTokens.every((token) => packNameTokens.has(token)));
    })
    .filter((term) => !tokenize(term).some((token) => packNameTokens.has(token)));
}

async function runExactSearch(ctx: DiscoverCtx, pc: PackContext): Promise<void> {
  const terms = exactSearchTermsForPack(ctx.query, pc.pack);
  for (const term of terms) {
    try {
      const searchOpts: Parameters<typeof searchRegistry>[0] = {
        entries: [pc.pack],
        query: term,
        max: Math.max(100, ctx.max * 20),
      };
      if (ctx.opts.installTools !== undefined) searchOpts.installTools = ctx.opts.installTools;
      const exact = await searchRegistry(searchOpts);
      for (const warning of exact.warnings ?? []) {
        if (!ctx.warnings.includes(warning)) ctx.warnings.push(warning);
      }
      for (const match of exact.matches) {
        const key = `${match.registry_entry}:${match.path}`;
        const arr = ctx.exactByEntryPath.get(key) ?? [];
        const weighted = { ...match, query_term: term };
        if (!arr.some((m) => exactMatchKey(m) === exactMatchKey(weighted))) arr.push(weighted);
        ctx.exactByEntryPath.set(key, arr);
      }
    } catch (e) {
      ctx.warnings.push(
        `exact search skipped for ${pc.pack}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function attachSectionMetadata(
  result: GenericPackResult["results"][number],
  section: SearchRecord,
  manifestTitle: string | undefined,
): void {
  const title = section.heading ?? manifestTitle ?? undefined;
  if (title !== undefined) result.title = title;
  if (section.id !== undefined) result.section_id = section.id;
  if (section.heading !== undefined) result.heading = section.heading;
  if (section.start_line !== undefined) result.start_line = section.start_line;
  if (section.end_line !== undefined) result.end_line = section.end_line;
}

function attachExactMatchMetadata(
  result: GenericPackResult["results"][number],
  exactMatches: ReturnType<typeof exactMatchesForSection>,
): void {
  if (exactMatches.length === 0) return;
  result.exact_verified = exactMatches.some((m) => m.verified);
  result.exact_matches = uniqueExactDisplayMatches(exactMatches)
    .slice(0, 3)
    .map((m) => ({ line: m.line, column: m.column, text: m.text }));
}

function buildMatchReasons(
  section: SearchRecord,
  exactMatches: ReturnType<typeof exactMatchesForSection>,
  manifestScore: number,
): string[] {
  return [
    ...(section.route_reasons ?? []),
    ...(exactMatches.length > 0 ? ["exact:literal"] : []),
    ...(manifestScore > 0 ? [`manifest_tokens:${manifestScore}`] : []),
  ];
}

function buildSectionResult(
  ctx: DiscoverCtx,
  pc: PackContext,
  section: SearchRecord,
): GenericPackResult["results"][number] | null {
  const manifestScore = pc.fileTokenScores.get(section.path) ?? 0;
  const score =
    scoreSection(section, pc.tokens, ctx.queryPhrases, pc.pack, ctx.querySurfaceTokens) +
    (section.route_score ?? 0) +
    manifestScore * 10 +
    pc.packAliasBoost;
  const exactMatches = exactMatchesForSection(
    ctx.exactByEntryPath.get(`${pc.pack}:${section.path}`) ?? [],
    section,
  );
  if (
    hasWeakConceptCoverage(section, ctx.querySurfaceTokens, pc.pack) &&
    !exactMatchesCoverConcepts(exactMatches, ctx.querySurfaceTokens, pc.pack)
  ) {
    return null;
  }
  if (score <= 0 && exactMatches.length === 0) return null;
  const result: GenericPackResult["results"][number] = {
    registry_entry: pc.pack,
    path: section.path,
    score: score + exactMatchScore(exactMatches),
    excerpt: section.excerpt,
  };
  attachSectionMetadata(result, section, pc.fileTitles.get(section.path));
  attachExactMatchMetadata(result, exactMatches);
  const matchReasons = buildMatchReasons(section, exactMatches, manifestScore);
  if (matchReasons.length > 0) result.match_reasons = [...new Set(matchReasons)].slice(0, 12);
  return result;
}

function processPackCandidates(ctx: DiscoverCtx, pc: PackContext): void {
  const targetIds = [
    ...pc.aliasMatches.flatMap((a) => a.targets),
    ...[...ctx.exactByEntryPath.entries()]
      .filter(([key]) => key.startsWith(`${pc.pack}:`))
      .flatMap(([, matches]) => matches.map((m) => `${m.path}#L${m.line}`)),
  ];
  const candidates = candidateSections(pc.root, pc.docsRoot, pc.tokens, targetIds);
  for (const section of candidates) {
    const result = buildSectionResult(ctx, pc, section);
    if (result !== null) ctx.results.push(result);
  }
}

function trimKnowledge(
  knowledge: GenericPackResult["knowledge"],
  baseTokens: string[],
  max: number,
): GenericPackResult["knowledge"] {
  return knowledge
    .filter(
      (k) =>
        scoreKnowledgeForFinal(k, baseTokens) >= 3 && knowledgeMatchesDistinctive(k, baseTokens),
    )
    .sort(
      (a, b) =>
        scoreKnowledgeForFinal(b, baseTokens) - scoreKnowledgeForFinal(a, baseTokens) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.min(8, max));
}

function trimDependencies(
  dependencies: GenericPackResult["dependencies"],
  baseTokens: string[],
  max: number,
): GenericPackResult["dependencies"] {
  return dependencies
    .filter((d) => dependencyUsefulForQuery(d, baseTokens))
    .sort(
      (a, b) =>
        scoreDependency(b, baseTokens) - scoreDependency(a, baseTokens) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, Math.min(6, max));
}

function buildFinalResult(ctx: DiscoverCtx): GenericPackResult {
  ctx.results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const trimmed = diversifyByRegistryEntry(pruneOverlappingResults(ctx.results), ctx.packs, ctx.max);
  const trimmedKnowledge = trimKnowledge(ctx.knowledge, ctx.baseTokens, ctx.max);
  const trimmedDependencies = trimDependencies(ctx.dependencies, ctx.baseTokens, ctx.max);
  return {
    status: ctx.errors.length > 0 && trimmed.length === 0 ? "error" : "ok",
    query: ctx.query,
    mode: "registry-docs",
    registry_entries: ctx.packs,
    knowledge: trimmedKnowledge,
    concept_aliases_used: ctx.conceptAliasesUsed,
    dependencies: trimmedDependencies,
    results: trimmed,
    citations: [
      ...trimmed.map(
        (r) => `${r.registry_entry}:${r.path}${r.start_line ? `:L${r.start_line}` : ""}`,
      ),
      ...trimmedKnowledge.map((k) => k.id),
    ],
    ...(ctx.errors.length ? { errors: ctx.errors } : {}),
    ...(ctx.warnings.length ? { warnings: [...new Set(ctx.warnings)].slice(0, 10) } : {}),
  };
}

export async function discoverGenericPacks(
  query: string,
  packs: string[],
  max = 10,
  opts: { installTools?: boolean } = {},
): Promise<GenericPackResult> {
  const ctx: DiscoverCtx = {
    query,
    packs,
    max,
    opts,
    baseTokens: tokenize(query).filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t)),
    querySurfaceTokens: surfaceTokens(query),
    queryPhrases: meaningfulQueryPhrases(query),
    results: [],
    knowledge: [],
    conceptAliasesUsed: [],
    dependencies: [],
    errors: [],
    warnings: [],
    exactByEntryPath: new Map(),
  };
  for (const pack of packs) {
    const pc = preparePackContext(ctx, pack);
    if (pc === null) continue;
    await runExactSearch(ctx, pc);
    processPackCandidates(ctx, pc);
  }
  return buildFinalResult(ctx);
}

function queryNamesPack(query: string, pack: string): boolean {
  const lower = query.toLowerCase();
  const pieces = pack.split(/[-_]+/).filter((p) => p.length > 1);
  return pieces.length > 0 && pieces.every((piece) => lower.includes(piece));
}

interface RegistryManifest {
  files?: { path: string; title?: string | null; tokens?: string[] }[];
}

interface SearchRecord {
  id?: string;
  path: string;
  heading?: string;
  anchor?: string;
  start_line?: number;
  end_line?: number;
  tokens?: string[];
  excerpt: string;
  path_class?: string;
  entity_refs?: string[];
  rank_terms?: string[];
  route_score?: number;
  route_reasons?: string[];
}

interface AliasRecord {
  phrase: string;
  source?: string;
  tokens?: string[];
  targets?: string[];
}

interface DependencyRecord {
  name: string;
  source: string;
  evidence?: unknown[];
}

interface EntityRecord {
  id: string;
  kind?: string;
  name: string;
  tokens?: string[];
  aliases?: string[];
  sections?: string[];
}

interface RankRecord {
  section_id: string;
  path: string;
  heading?: string;
  start_line?: number;
  end_line?: number;
  path_class?: string;
  entity_refs?: string[];
  rank_terms?: string[];
}

function candidateSections(
  root: string,
  docsRoot: string,
  tokens: string[],
  targetIds: string[],
): SearchRecord[] {
  const records = readSearchRecords(root);
  const byId = new Map(records.map((record) => [record.id, record]));
  const rankCandidates = rankedSectionCandidates(root, tokens, targetIds);
  const routeScores = new Map(rankCandidates.map((candidate) => [candidate.section_id, candidate]));
  const indexedIds = [
    ...new Set([
      ...targetIds,
      ...rankCandidates.map((candidate) => candidate.section_id),
      ...readTokenIndex(root, tokens),
    ]),
  ].slice(0, 800);
  if (indexedIds.length > 0) {
    const indexed = indexedIds
      .map((id) => {
        const record = byId.get(id) ?? sectionRecordFromId(root, id, tokens);
        const route = routeScores.get(id);
        if (!record || !route) return record;
        return {
          ...record,
          path_class: route.path_class ?? record.path_class,
          entity_refs: route.entity_refs ?? record.entity_refs,
          rank_terms: route.rank_terms ?? record.rank_terms,
          route_score: route.score,
          route_reasons: route.reasons,
        };
      })
      .filter((record): record is SearchRecord => record !== undefined);
    const seen = new Set<string>();
    return indexed
      .filter((record) => {
        const key = record.id ?? record.path;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 800);
  }
  if (records.length > 0) return records.slice(0, 800);
  return listTextFiles(docsRoot, 5000).map((file) => {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const raw = readText(file) ?? "";
    const record: SearchRecord = {
      path: rel,
      excerpt: excerpt(raw, tokens),
      tokens: tokenize(`${rel} ${raw.slice(0, 20000)}`),
    };
    const heading = firstHeading(raw);
    if (heading !== undefined) record.heading = heading;
    return record;
  });
}

function rankedSectionCandidates(
  root: string,
  tokens: string[],
  targetIds: string[],
): {
  section_id: string;
  score: number;
  path_class?: string;
  entity_refs?: string[];
  rank_terms?: string[];
  reasons: string[];
}[] {
  const targetSet = new Set(targetIds);
  const entityScores = matchedEntitySectionScores(root, tokens);
  const out: {
    section_id: string;
    score: number;
    path_class?: string;
    entity_refs?: string[];
    rank_terms?: string[];
    reasons: string[];
  }[] = [];

  for (const record of readRankRecords(root)) {
    const scored = scoreRankRecord(record, tokens, targetSet);
    const entity = entityScores.get(record.section_id);
    const total = scored.score + (entity?.score ?? 0);
    if (total <= 0) continue;
    out.push({
      section_id: record.section_id,
      score: total,
      ...(record.path_class ? { path_class: record.path_class } : {}),
      ...(record.entity_refs ? { entity_refs: record.entity_refs } : {}),
      ...(record.rank_terms ? { rank_terms: record.rank_terms } : {}),
      reasons: [...scored.reasons, ...(entity?.reasons ?? [])].slice(0, 12),
    });
  }

  for (const [sectionId, entity] of entityScores) {
    if (out.some((candidate) => candidate.section_id === sectionId)) continue;
    out.push({
      section_id: sectionId,
      score: entity.score,
      reasons: entity.reasons.slice(0, 12),
    });
  }

  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        pathClassWeight(b.path_class) - pathClassWeight(a.path_class) ||
        a.section_id.localeCompare(b.section_id),
    )
    .slice(0, 500);
}

function matchedEntitySectionScores(
  root: string,
  tokens: string[],
): Map<string, { score: number; reasons: string[] }> {
  const out = new Map<string, { score: number; reasons: string[] }>();
  const queryTokens = new Set(tokens);
  for (const entity of readEntityRecords(root)) {
    const sections = entity.sections ?? [];
    if (sections.length === 0) continue;
    const entityTokens = new Set([
      ...tokenize(entity.name),
      ...(entity.tokens ?? []),
      ...(entity.aliases ?? []).flatMap((alias) => tokenize(alias)),
    ]);
    let score = 0;
    for (const token of queryTokens) {
      if (entityTokens.has(token)) score += 35;
      if (entity.name.toLowerCase().includes(token)) score += 25;
    }
    if (score <= 0) continue;
    const capped = Math.min(score + 30, 180);
    for (const sectionId of sections.slice(0, 80)) {
      const prev = out.get(sectionId) ?? { score: 0, reasons: [] };
      prev.score += capped;
      prev.reasons.push(`entity:${entity.id}`);
      out.set(sectionId, prev);
    }
  }
  return out;
}

function scoreRankRecord(
  record: RankRecord,
  tokens: string[],
  targetSet: Set<string>,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const rankTerms = new Set(record.rank_terms ?? []);
  const heading = (record.heading ?? "").toLowerCase();
  const pathValue = record.path.toLowerCase();

  if (targetSet.has(record.section_id)) {
    score += 120;
    reasons.push("target:section");
  }
  for (const token of new Set(tokens)) {
    if (rankTerms.has(token)) {
      score += 12;
      reasons.push(`rank_term:${token}`);
    }
    if (heading.includes(token)) {
      score += 35;
      reasons.push(`heading:${token}`);
    }
    if (pathValue.includes(token)) {
      score += 16;
      reasons.push(`path:${token}`);
    }
  }
  const weight = pathClassWeight(record.path_class);
  if (score > 0 && weight !== 0) {
    score += weight;
    reasons.push(`path_class:${record.path_class ?? "unknown"}`);
  }
  return { score, reasons: [...new Set(reasons)] };
}

function pathClassWeight(pathClass: string | undefined): number {
  switch (pathClass) {
    case "resource-reference":
    case "data-source-reference":
    case "api-reference":
    case "syntax-reference":
      return 80;
    case "cli-reference":
      return 120;
    case "reference":
      return 24;
    case "guide":
      return 16;
    case "example":
      return 12;
    case "tutorial":
      return 6;
    case "nav":
    case "redirect":
    case "changelog":
      return -50;
    default:
      return 0;
  }
}

function manifestFileTokenScores(
  manifest: RegistryManifest | undefined,
  tokens: string[],
): Map<string, number> {
  const queryTokens = new Set(tokens);
  const out = new Map<string, number>();
  for (const file of manifest?.files ?? []) {
    const score = file.tokens?.filter((t) => queryTokens.has(t)).length ?? 0;
    if (score > 0) out.set(file.path, score);
  }
  return out;
}

function manifestFileTitles(manifest: RegistryManifest | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of manifest?.files ?? []) {
    if (file.title) out.set(file.path, file.title);
  }
  return out;
}

function sectionRecordFromId(root: string, id: string, tokens: string[]): SearchRecord | undefined {
  const match = id.match(/^(.*)#L(\d+)$/);
  if (!match) return undefined;
  const rel = match[1];
  const startLine = Number(match[2]);
  if (!rel || !Number.isFinite(startLine)) return undefined;
  const raw = readText(path.join(root, rel));
  if (!raw) return undefined;
  const lines = raw.split(/\r?\n/);
  const startIndex = Math.max(0, startLine - 1);
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i] ?? "")) {
      endIndex = i;
      break;
    }
  }
  const sectionRaw = lines.slice(startIndex, endIndex).join("\n");
  const heading = firstHeading(sectionRaw) ?? firstHeading(raw);
  const record: SearchRecord = {
    id,
    path: rel,
    start_line: startLine,
    end_line: endIndex,
    excerpt: excerpt(sectionRaw || raw, tokens),
    tokens: tokenize(`${rel} ${heading ?? ""} ${sectionRaw.slice(0, 20000)}`),
  };
  if (heading !== undefined) record.heading = heading;
  return record;
}

function readManifest(root: string): RegistryManifest | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, "MANIFEST.json"), "utf8"),
    ) as RegistryManifest;
  } catch {
    return undefined;
  }
}

function readSearchRecords(root: string): SearchRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "index", "search.json"), "utf8")) as {
      records?: SearchRecord[];
    };
    return raw.records ?? [];
  } catch {
    return [];
  }
}

function readRankRecords(root: string): RankRecord[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "index", "rank_index.json"), "utf8"),
    ) as {
      records?: RankRecord[];
    };
    return raw.records ?? [];
  } catch {
    return [];
  }
}

function readEntityRecords(root: string): EntityRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "index", "entities.json"), "utf8")) as {
      entities?: EntityRecord[];
    };
    return raw.entities ?? [];
  } catch {
    return [];
  }
}

function readTokenIndex(root: string, tokens: string[]): string[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "index", "token_index.json"), "utf8"),
    ) as {
      tokens?: Record<string, string[]>;
    };
    const out = new Set<string>();
    for (const token of tokens) {
      for (const file of raw.tokens?.[token] ?? []) out.add(file);
    }
    return [...out].slice(0, 500);
  } catch {
    return [];
  }
}

function readAliases(root: string): AliasRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "index", "aliases.json"), "utf8")) as {
      aliases?: AliasRecord[];
    };
    return raw.aliases ?? [];
  } catch {
    return [];
  }
}

function matchAliases(
  registryEntry: string,
  query: string,
  aliases: AliasRecord[],
): GenericPackResult["concept_aliases_used"] {
  const queryTokens = tokenize(query);
  const originalTokens = query.match(/[A-Za-z0-9]+/g) ?? [];
  return aliases
    .filter(
      (a) =>
        a.phrase.length > 1 &&
        aliasPhraseMatches(query, queryTokens, originalTokens, a.phrase, a.source) &&
        aliasPhraseUseful(a.phrase, a.source),
    )
    .slice(0, 20)
    .map((a) => ({
      registry_entry: registryEntry,
      phrase: a.phrase,
      ...(a.source ? { source: a.source } : {}),
      tokens: a.tokens ?? [],
      targets: a.targets ?? [],
    }));
}

function readDependencies(root: string, tokens: string[]): DependencyRecord[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "index", "dependencies.json"), "utf8"),
    ) as {
      dependencies?: DependencyRecord[];
    };
    return (raw.dependencies ?? []).filter((d) =>
      tokens.some((t) => d.name.includes(t) || JSON.stringify(d.evidence ?? "").includes(t)),
    );
  } catch {
    return [];
  }
}

function scoreDependency(dep: DependencyRecord, tokens: string[]): number {
  const text = `${dep.name} ${JSON.stringify(dep.evidence ?? "")}`.toLowerCase();
  return tokens.reduce(
    (score, token) => score + (token.length > 2 && text.includes(token) ? 1 : 0),
    0,
  );
}

function dependencyUsefulForQuery(dep: DependencyRecord, tokens: string[]): boolean {
  const explicit = tokens.some((token) =>
    ["prerequisite", "prerequisites", "requirement", "requirements", "install", "setup"].includes(
      token,
    ),
  );
  if (dep.source === "detected-section" && !explicit) return false;
  return scoreDependency(dep, tokens) >= (explicit ? 1 : 2);
}

function readKnowledge(
  root: string,
  registryEntry: string,
  tokens: string[],
): GenericPackResult["knowledge"] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "index", "knowledge.json"), "utf8")) as {
      knowledge?: GenericPackResult["knowledge"];
    };
    return (raw.knowledge ?? [])
      .filter(
        (k) =>
          k.registry_entry === registryEntry &&
          knowledgeHasUsefulTrigger(k) &&
          scoreKnowledge(k, tokens) > 0,
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

function listTextFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];
  const allowed = /\.(md|mdx|markdown|txt|ya?ml|json|toml|rst)$/i;
  function walk(dir: string): void {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else if (entry.isFile() && allowed.test(entry.name)) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

function scoreSection(
  section: SearchRecord,
  tokens: string[],
  phrases: string[],
  pack: string,
  originalTokens = tokens,
): number {
  const text =
    `${section.path} ${section.heading ?? ""} ${section.excerpt} ${(section.tokens ?? []).join(" ")}`.toLowerCase();
  const fileText = section.path.toLowerCase();
  const heading = (section.heading ?? "").toLowerCase();
  let score = 0;
  for (const phrase of phrases) {
    if (heading.includes(phrase)) score += 90;
    if (
      fileText.includes(phrase.replace(/\s+/g, "-")) ||
      fileText.includes(phrase.replace(/\s+/g, "_"))
    ) {
      score += 60;
    }
    if (text.includes(phrase)) score += 45;
  }
  for (const token of new Set(tokens)) {
    if (fileText.includes(token)) score += 12;
    if (pathHasSegment(fileText, token)) score += 80;
    if (heading.includes(token)) score += 18;
    if ((section.tokens ?? []).includes(token)) score += 10;
    const matches = text.match(new RegExp(escapeRegExp(token), "g"));
    if (matches) score += Math.min(matches.length, 20);
  }
  for (const token of new Set(tokens.filter((t) => DISTINCTIVE_SHORT_TOKENS.has(t)))) {
    if (pathHasSegment(fileText, token) || tokenAppearsAsWord(text, token)) score += 260;
    else score -= 120;
  }
  score += conceptCoverageScore(text, originalTokens, pack);
  return score;
}

function conceptCoverageScore(text: string, tokens: string[], pack: string): number {
  const important = importantConceptTokens(tokens, pack);
  if (important.length < 4) return 0;
  let present = 0;
  let missing = 0;
  for (const token of important) {
    if (tokenConceptAppears(text, token)) present += 1;
    else missing += 1;
  }
  const raw = present * 36 - missing * 110;
  return present >= Math.ceil(important.length / 2) ? Math.max(0, raw) : raw * 10;
}

function hasWeakConceptCoverage(section: SearchRecord, tokens: string[], pack: string): boolean {
  const important = importantConceptTokens(tokens, pack);
  if (important.length < 4) return false;
  const text =
    `${section.path} ${section.heading ?? ""} ${section.excerpt} ${(section.tokens ?? []).join(" ")}`.toLowerCase();
  const present = important.filter((token) => tokenConceptAppears(text, token)).length;
  return present < Math.ceil(important.length / 2);
}

function exactMatchesCoverConcepts(
  matches: WeightedRegistrySearchMatch[],
  tokens: string[],
  pack: string,
): boolean {
  const important = importantConceptTokens(tokens, pack);
  if (important.length < 4 || matches.length === 0) return matches.length > 0;
  const matchedTerms = matches.map((match) => match.query_term.toLowerCase()).join(" ");
  const covered = important.filter((token) => tokenConceptAppears(matchedTerms, token)).length;
  return covered >= Math.ceil(important.length / 2);
}

function importantConceptTokens(tokens: string[], pack: string): string[] {
  const packTokens = new Set(tokenize(pack));
  return [...new Set(tokens)].filter(
    (token) =>
      !packTokens.has(token) &&
      !QUERY_STOPWORDS.has(token) &&
      (token.length > 2 || DISTINCTIVE_SHORT_TOKENS.has(token)),
  );
}

function pathHasSegment(fileText: string, token: string): boolean {
  if (
    (token.length < 3 && !DISTINCTIVE_SHORT_TOKENS.has(token)) ||
    GENERIC_PATH_TOKENS.has(token)
  ) {
    return false;
  }
  return new RegExp(`(^|[/.@_-])${escapeRegExp(token)}($|[/.@_-])`).test(fileText);
}

function tokenAppearsAsWord(text: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}($|[^a-z0-9])`, "i").test(text);
}

function tokenConceptAppears(text: string, token: string): boolean {
  if (tokenAppearsAsWord(text, token)) return true;
  if (token.endsWith("s") && tokenAppearsAsWord(text, token.slice(0, -1))) return true;
  return tokenAppearsAsWord(text, `${token}s`);
}

function scoreKnowledge(card: GenericPackResult["knowledge"][number], tokens: string[]): number {
  const title = card.title.toLowerCase();
  const triggers = card.triggers.join(" ").toLowerCase();
  return tokens.reduce((score, token) => {
    let next = score;
    if (triggers.includes(token)) next += 3;
    if (title.includes(token)) next += 2;
    return next;
  }, 0);
}

function scoreKnowledgeForFinal(
  card: GenericPackResult["knowledge"][number],
  tokens: string[],
): number {
  const packTokens = new Set(tokenize(card.registry_entry));
  return scoreKnowledge(
    card,
    tokens.filter((token) => !packTokens.has(token)),
  );
}

function knowledgeMatchesDistinctive(
  card: GenericPackResult["knowledge"][number],
  tokens: string[],
): boolean {
  const distinctive = tokens.filter((token) => DISTINCTIVE_SHORT_TOKENS.has(token));
  if (distinctive.length === 0) return true;
  const text =
    `${card.id} ${card.title} ${card.path} ${card.triggers.join(" ")} ${card.excerpt}`.toLowerCase();
  return distinctive.some((token) => tokenAppearsAsWord(text, token));
}

function knowledgeHasUsefulTrigger(card: GenericPackResult["knowledge"][number]): boolean {
  return card.triggers.some((trigger) =>
    tokenize(trigger).some((token) => token.length > 2 && !KNOWLEDGE_TRIGGER_STOPWORDS.has(token)),
  );
}

function firstHeading(raw: string): string | undefined {
  const m = raw.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim();
}

function excerpt(raw: string, tokens: string[]): string {
  const lower = raw.toLowerCase();
  const idx =
    tokens
      .map((t) => lower.indexOf(t))
      .filter((n) => n >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, idx - 160);
  const body = raw
    .slice(start, start + 520)
    .replace(/\s+/g, " ")
    .trim();
  return body.length > 500 ? `${body.slice(0, 500)}...` : body;
}

function readText(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPhraseUseful(phrase: string, source: string | undefined): boolean {
  const tokens = tokenize(phrase);
  if (source === "acronym" && phrase.length < 3) return false;
  if (tokens.length === 1 && tokens[0]!.length < 3 && source !== "configured") return false;
  if (source !== "heading") return true;
  return tokens.some((token) => token.length > 2 && !QUERY_STOPWORDS.has(token));
}

function aliasPhraseMatches(
  query: string,
  queryTokens: string[],
  originalTokens: string[],
  phrase: string,
  source: string | undefined,
): boolean {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.length === 0) return false;
  if (source === "acronym") {
    const original = originalTokens.map((t) => t.toUpperCase());
    return phrase.length >= 3 && original.includes(phrase.toUpperCase());
  }
  if (phraseTokens.length === 1) {
    const token = phraseTokens[0]!;
    if (token.length < 3 && source !== "configured") return false;
    return queryTokens.includes(token);
  }
  return phraseBoundaryRegex(phraseTokens).test(query);
}

function phraseBoundaryRegex(tokens: string[]): RegExp {
  const body = tokens.map(escapeRegExp).join("[\\s_./-]+");
  return new RegExp(`(^|[^A-Za-z0-9])${body}($|[^A-Za-z0-9])`, "i");
}

function meaningfulQueryPhrases(query: string): string[] {
  const tokens = (query.toLowerCase().match(/[a-z0-9]+(?:[_-][a-z0-9]+)*/g) ?? []).filter(
    (t) => !QUERY_STOPWORDS.has(t) && (t.length > 2 || SHORT_DOMAIN_TOKENS.has(t)),
  );
  const out = new Set<string>();
  for (let size = Math.min(4, tokens.length); size >= 2; size--) {
    for (let i = 0; i + size <= tokens.length; i++) out.add(tokens.slice(i, i + size).join(" "));
  }
  return [...out].slice(0, 20);
}

function surfaceTokens(query: string): string[] {
  return [
    ...new Set(
      (query.toLowerCase().match(/[a-z0-9]+(?:[_-][a-z0-9]+)*/g) ?? []).filter(
        (token) => token.length > 1 && !QUERY_STOPWORDS.has(token),
      ),
    ),
  ];
}

function tokensForMetadata(tokens: string[], pack: string): string[] {
  const packTokens = new Set(tokenize(pack));
  return tokens.filter((token) => !packTokens.has(token) && !QUERY_STOPWORDS.has(token));
}

function exactMatchesForSection(
  matches: WeightedRegistrySearchMatch[],
  section: SearchRecord,
): WeightedRegistrySearchMatch[] {
  if (section.start_line === undefined || section.end_line === undefined) return matches;
  return matches.filter((m) => m.line >= section.start_line! && m.line <= section.end_line!);
}

function exactMatchScore(matches: WeightedRegistrySearchMatch[]): number {
  const terms = new Set(matches.map((match) => match.query_term));
  let score = Math.min(matches.length, 3) * 20;
  for (const term of terms) {
    const words = tokenize(term);
    const structuredLiteral = /[-_:.]/.test(term);
    score += Math.min(
      260,
      Math.max(
        words.length > 1 || structuredLiteral ? 130 : 20,
        words.length > 1 || structuredLiteral ? term.length * 12 : term.length * 4,
      ),
    );
  }
  return score;
}

function uniqueExactDisplayMatches(
  matches: WeightedRegistrySearchMatch[],
): WeightedRegistrySearchMatch[] {
  const seen = new Set<string>();
  const out: WeightedRegistrySearchMatch[] = [];
  for (const match of matches) {
    const key = `${match.registry_entry}:${match.path}:${match.line}:${match.column}:${match.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
  }
  return out;
}

function exactMatchKey(match: WeightedRegistrySearchMatch): string {
  return `${match.registry_entry}:${match.path}:${match.line}:${match.column}:${match.text}:${match.query_term}`;
}

function pruneOverlappingResults(
  results: GenericPackResult["results"],
): GenericPackResult["results"] {
  const kept: GenericPackResult["results"] = [];
  const perPath = new Map<string, number>();
  for (const result of results) {
    const pathKey = `${result.registry_entry}:${result.path}`;
    if ((perPath.get(pathKey) ?? 0) >= 3) continue;
    if (kept.some((existing) => sectionsOverlap(existing, result))) continue;
    kept.push(result);
    perPath.set(pathKey, (perPath.get(pathKey) ?? 0) + 1);
  }
  return kept;
}

function diversifyByRegistryEntry(
  results: GenericPackResult["results"],
  packs: readonly string[],
  max: number,
): GenericPackResult["results"] {
  if (packs.length <= 1 || results.length <= max) return results.slice(0, max);
  const selected: GenericPackResult["results"] = [];
  const selectedKeys = new Set<string>();
  const minPerPack = Math.max(1, Math.min(2, Math.floor(max / packs.length)));
  for (const pack of packs) {
    for (const result of results.filter((candidate) => candidate.registry_entry === pack)) {
      if (selected.filter((candidate) => candidate.registry_entry === pack).length >= minPerPack) {
        break;
      }
      const key = resultKey(result);
      if (selectedKeys.has(key)) continue;
      selected.push(result);
      selectedKeys.add(key);
    }
  }
  for (const result of results) {
    if (selected.length >= max) break;
    const key = resultKey(result);
    if (selectedKeys.has(key)) continue;
    selected.push(result);
    selectedKeys.add(key);
  }
  return selected.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, max);
}

function resultKey(result: GenericPackResult["results"][number]): string {
  return `${result.registry_entry}:${result.section_id ?? result.path}:${result.start_line ?? ""}`;
}

function sectionsOverlap(
  a: GenericPackResult["results"][number],
  b: GenericPackResult["results"][number],
): boolean {
  if (a.registry_entry !== b.registry_entry || a.path !== b.path) return false;
  if (a.start_line === undefined || a.end_line === undefined) return true;
  if (b.start_line === undefined || b.end_line === undefined) return true;
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}
