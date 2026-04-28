// Enrichment + per-provider score normalization.
//
// Two responsibilities in one module:
//   1. Build the public DiscoverFile array from the ranked internal records,
//      attaching `manifest_entry` + `example_usage` (default) and computing
//      `score_norm` 0..100 per provider. Closes F7.
//   2. Build (and return) the `Map<relativeFile, resourceName>` reverse
//      lookup for tier1's stage 1l. Built once per call. Closes F24.
//
// `recommended_companions` is always present on `manifest_entry` (defaults to
// [] when missing in the manifest). SKILL.md callers can rely on the field
// being there.

import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeScores } from "./scoring.js";
import type { DiscoverFile, ManifestResourceEntry, ProviderManifest, ScoredFile } from "./types.js";
import type { RankedFile } from "./merge.js";

const MAX_MARKDOWN_BYTES = 1 * 1024 * 1024;
const MAX_EXAMPLE_BYTES = 16 * 1024;

/**
 * E2: Default truncation — max lines of the example body before a fence is
 * found. If an HCL fence is found, we include through the closing fence.
 * If no fence, we take this many lines.
 */
const DEFAULT_EXAMPLE_MAX_LINES = 30;

interface EnrichArgs {
  ranked: RankedFile[];
  manifest: ProviderManifest;
  providerDir: string;
  /** Whether to attach manifest_entry + example_usage. False with --raw. */
  enrich: boolean;
  /**
   * E1: When true, strips manifest_entry and example_usage from each file
   * and instead adds a `name` field. Produces a much smaller envelope.
   * Default false.
   */
  brief?: boolean;
  /**
   * E2: When true, restores the full example_usage content (pre-truncation
   * behavior). Default false = truncate to first HCL fence + 30 lines.
   */
  fullExamples?: boolean;
}

export interface EnrichResult {
  files: DiscoverFile[];
  /** Reverse lookup: relative file path → resource name. Used by tier1 1l. */
  fileToResource: Map<string, string>;
}

/** Produce the public DiscoverFile array AND the file→resource lookup. */
export function enrichFiles(args: EnrichArgs): EnrichResult {
  const { ranked, manifest, providerDir, enrich, brief = false, fullExamples = false } = args;

  // Build the file→resource lookup once. Used here AND returned for tier1.
  const fileToResource = new Map<string, string>();
  const fileToEntry = new Map<string, ManifestResourceEntry>();
  for (const [name, entry] of Object.entries(manifest.resources ?? {})) {
    fileToResource.set(entry.file, name);
    fileToEntry.set(entry.file, entry);
  }
  for (const [name, entry] of Object.entries(manifest.data_sources ?? {})) {
    fileToResource.set(entry.file, name);
    fileToEntry.set(entry.file, entry);
  }

  // Compute per-provider normalized scores.
  const norms = normalizeScores(new Map(ranked.map((r) => [r.path, { score: r.score }] as const)));

  const out: DiscoverFile[] = [];
  for (const r of ranked) {
    const rel = path.relative(providerDir, r.path);
    const entry = fileToEntry.get(rel);

    // Always populate manifest_entry unless --raw. When the file isn't in the
    // manifest (e.g. a guide page or index), synthesize a minimal entry so
    // SKILL.md consumers can still rely on the field being present.
    const baseEntry: ManifestResourceEntry = entry
      ? normalizeManifestEntry(entry, rel)
      : {
          type: "resource",
          file: rel,
          description: "",
          required_args: [],
          optional_args: [],
          computed_attrs: [],
          blocks: {},
          enum_values: {},
          import_syntax: null,
          deprecated: false,
          suggested_alternative: null,
          recommended_companions: [],
          schema_origin: "sdkv2",
          sections: {},
          sha1_prefix: "00000000",
        };

    // E1: In brief mode, look up the resource name from the reverse map and
    // strip manifest_entry / example_usage entirely to minimise envelope size.
    if (brief) {
      const resourceName = fileToResource.get(rel);
      const briefObj: DiscoverFile = {
        path: r.path,
        score: round1(r.score),
        score_norm: norms.get(r.path) ?? 0,
        tier: r.tier,
        reasons: r.reasons.slice(0, 6).map((x) => `${x.kind}:${x.detail}`),
        manifest_entry: baseEntry, // required by contract shape; left empty-ish
        example_usage: "",
        ...(resourceName !== undefined ? { name: resourceName } : {}),
      };
      // In brief mode, replace manifest_entry with the minimal synthetic form
      // so the contract validates but content is stripped.
      briefObj.manifest_entry = {
        type: baseEntry.type,
        file: baseEntry.file,
        description: "",
        required_args: [],
        optional_args: [],
        computed_attrs: [],
        blocks: {},
        enum_values: {},
        import_syntax: null,
        deprecated: baseEntry.deprecated,
        suggested_alternative: null,
        recommended_companions: [],
        schema_origin: baseEntry.schema_origin,
        sections: {},
        sha1_prefix: baseEntry.sha1_prefix,
      };
      out.push(briefObj);
      continue;
    }

    const fileObj: DiscoverFile = {
      path: r.path,
      score: round1(r.score),
      score_norm: norms.get(r.path) ?? 0,
      tier: r.tier,
      reasons: r.reasons.slice(0, 6).map((x) => `${x.kind}:${x.detail}`),
      manifest_entry: baseEntry,
      example_usage: "",
    };

    if (enrich) {
      if (entry && entry.type === "resource") {
        // E2: Pass fullExamples flag to control truncation behavior.
        const example = extractExampleUsage(r.path, fullExamples);
        if (example !== undefined) fileObj.example_usage = example;
      }
    } else {
      // --raw: keep envelope minimal. Callers that opt out get the synthetic
      // entry so the union shape still validates, but no example body.
      fileObj.example_usage = "";
    }

    out.push(fileObj);
  }

  return { files: out, fileToResource };
}

/** Fill in any missing fields the contract requires (defaults to []). */
function normalizeManifestEntry(
  entry: ManifestResourceEntry,
  relativeFile: string,
): ManifestResourceEntry {
  return {
    type: entry.type,
    file: entry.file ?? relativeFile,
    description: entry.description ?? "",
    ...(entry.subcategory !== undefined ? { subcategory: entry.subcategory } : {}),
    required_args: entry.required_args ?? [],
    optional_args: entry.optional_args ?? [],
    computed_attrs: entry.computed_attrs ?? [],
    blocks: entry.blocks ?? {},
    enum_values: entry.enum_values ?? {},
    import_syntax: entry.import_syntax ?? null,
    deprecated: entry.deprecated ?? false,
    suggested_alternative: entry.suggested_alternative ?? null,
    recommended_companions: entry.recommended_companions ?? [],
    schema_origin: entry.schema_origin ?? "sdkv2",
    sections: entry.sections ?? {},
    sha1_prefix: entry.sha1_prefix ?? "00000000",
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * E2: Extract the ## Example Usage section from a markdown file.
 *
 * Default behavior (fullContent=false): truncates to the first HCL/terraform
 * fenced block plus a trailing marker. If no fence is found, takes the first
 * DEFAULT_EXAMPLE_MAX_LINES lines of the section body. This reduces token
 * usage by ~40-60% vs. the old full-content default.
 *
 * SOFT-BREAKING CHANGE: the default behavior changes with E2. Callers that
 * relied on the full example body must pass --full-examples (fullContent=true).
 *
 * fullContent=true: restores the original full-content behavior (everything
 * from ## Example Usage down to the next ## heading, capped at MAX_EXAMPLE_BYTES).
 */
function extractExampleUsage(filepath: string, fullContent = false): string | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filepath);
  } catch {
    return undefined;
  }
  if (stat.size > MAX_MARKDOWN_BYTES) return undefined;

  let body: string;
  try {
    body = fs.readFileSync(filepath, "utf8");
  } catch {
    return undefined;
  }

  const startMatch = /^##\s+example\s+usage\b.*$/im.exec(body);
  if (startMatch?.index === undefined) return undefined;
  const start = startMatch.index;

  const tail = body.slice(start + startMatch[0].length);
  const nextH2 = /^##\s+/m.exec(tail);
  const sectionEnd =
    nextH2?.index !== undefined ? start + startMatch[0].length + nextH2.index : body.length;

  let block = body.slice(start, sectionEnd).trim();

  if (fullContent) {
    // Original behavior: return full section, capped at byte limit.
    if (block.length > MAX_EXAMPLE_BYTES) {
      block = `${block.slice(0, MAX_EXAMPLE_BYTES)}\n\n... (truncated; full body at ${path.basename(filepath)})`;
    }
    return block;
  }

  // E2 default truncation: find the first HCL/terraform fenced block and
  // return the heading + that block only. If no fence found, take first
  // DEFAULT_EXAMPLE_MAX_LINES lines of the section body.
  const heading = startMatch[0]; // "## Example Usage"
  const sectionBody = tail.slice(0, nextH2?.index); // body between headings

  const fencePattern = /^```(?:hcl|terraform)\b/im;
  const fenceStart = fencePattern.exec(sectionBody);
  if (fenceStart?.index !== undefined) {
    // Find the closing fence after the opening fence.
    const afterOpen = sectionBody.slice(fenceStart.index + fenceStart[0].length);
    const closingFence = /^```\s*$/m.exec(afterOpen);
    let fenceBlock: string;
    if (closingFence?.index !== undefined) {
      fenceBlock = sectionBody.slice(
        0,
        fenceStart.index + fenceStart[0].length + closingFence.index + closingFence[0].length,
      );
    } else {
      // No closing fence — take through end of section.
      fenceBlock = sectionBody;
    }
    const truncated = `${heading}\n\n${fenceBlock.trim()}\n\n... (truncated; pass --full-examples for the rest)`;
    // Safety cap.
    if (truncated.length > MAX_EXAMPLE_BYTES) {
      return `${truncated.slice(0, MAX_EXAMPLE_BYTES)}\n\n... (truncated; full body at ${path.basename(filepath)})`;
    }
    return truncated;
  }

  // No HCL fence found — take first DEFAULT_EXAMPLE_MAX_LINES lines.
  const lines = sectionBody.split("\n");
  const truncatedLines = lines.slice(0, DEFAULT_EXAMPLE_MAX_LINES);
  const hasMore = lines.length > DEFAULT_EXAMPLE_MAX_LINES;
  const truncatedBody = truncatedLines.join("\n").trimEnd();
  const result = `${heading}\n\n${truncatedBody}${hasMore ? "\n\n... (truncated; pass --full-examples for the rest)" : ""}`;
  if (result.length > MAX_EXAMPLE_BYTES) {
    return `${result.slice(0, MAX_EXAMPLE_BYTES)}\n\n... (truncated; full body at ${path.basename(filepath)})`;
  }
  return result;
}

// Re-export ScoredFile for explicit import-graph clarity (the bundler treats
// it as a no-op — there's no runtime cost).
export type { ScoredFile };
