// Scoring accumulator + post-processing helpers.
//
// The Scorer stays close to the legacy Python harness: each Tier-1 stage
// calls add() and the dedup rules live in one place. New in v0.1:
//
//   • applyCanonicalMultiplier() — boost ×1.5 for files with both
//     `exact_resource` AND `primary_resource` reasons. Closes F6.
//   • tieBreakByNameLength() — when two files tie on score, the shorter
//     resource name wins (so `cloudflare_dns_record` beats
//     `cloudflare_zone_dns_settings`). Closes F6.
//   • normalizeScores() — emits per-provider 0..100 score_norm.
//     Closes F7.

import { CANONICAL_MULTIPLIER, DEDUPE_REASON_KINDS, THEORETICAL_MAX_SCORE } from "./constants.js";
import { pathWeight } from "./path-weight.js";
import type { Reason, ReasonKind, ScoredFile } from "./types.js";

export class Scorer {
  /** filepath → ScoredFile. */
  private readonly entries = new Map<string, ScoredFile>();
  /** "filepath\0kind" → true, used for DEDUPE_REASON_KINDS. */
  private readonly seen = new Set<string>();

  add(filepath: string, score: number, kind: ReasonKind, detail: string): void {
    if (DEDUPE_REASON_KINDS.has(kind)) {
      const seenKey = `${filepath}\0${kind}`;
      if (this.seen.has(seenKey)) return;
      this.seen.add(seenKey);
    }

    let entry = this.entries.get(filepath);
    if (!entry) {
      entry = { score: 0, reasons: [], tier: "manifest" };
      this.entries.set(filepath, entry);
    }
    entry.score += score * pathWeight(filepath);
    entry.reasons.push({ kind, detail });
  }

  size(): number {
    return this.entries.size;
  }

  isEmpty(): boolean {
    return this.entries.size === 0;
  }

  toMap(): ReadonlyMap<string, ScoredFile> {
    return this.entries;
  }
}

/** Format a Reason as the legacy "kind:detail" string. */
export function formatReason(r: Reason): string {
  return `${r.kind}:${r.detail}`;
}

/**
 * Boost any file that has an `exact_resource` OR `primary_resource` reason
 * by CANONICAL_MULTIPLIER. This biases the ranker toward the doc page the
 * user almost certainly meant — a query like "S3 bucket versioning" should
 * surface `aws_s3_bucket` ahead of `aws_s3_bucket_versioning`, even though
 * both pages get hit.
 *
 * Returns a fresh map; the caller should swap it in.
 */
export function applyCanonicalMultiplier(
  scores: ReadonlyMap<string, ScoredFile>,
): Map<string, ScoredFile> {
  const out = new Map<string, ScoredFile>();
  for (const [path, sf] of scores) {
    const kinds = new Set(sf.reasons.map((r) => r.kind));
    const boost = kinds.has("exact_resource") || kinds.has("primary_resource");
    out.set(path, {
      score: boost ? sf.score * CANONICAL_MULTIPLIER : sf.score,
      reasons: sf.reasons.slice(),
      tier: sf.tier,
    });
  }
  return out;
}

/**
 * Stable comparator for ranked files: score desc, then by resource-name
 * length asc (shorter wins), then by path asc.
 *
 * The resource-name length is taken from the file basename minus the doc
 * extension (`.markdown` / `.html.markdown` / `.md`).
 */
export function tieBreakByNameLength(
  a: { path: string; score: number },
  b: { path: string; score: number },
): number {
  if (b.score !== a.score) return b.score - a.score;
  const na = baseName(a.path);
  const nb = baseName(b.path);
  if (na.length !== nb.length) return na.length - nb.length;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function baseName(p: string): string {
  const slash = p.lastIndexOf("/");
  const last = slash >= 0 ? p.slice(slash + 1) : p;
  return last
    .replace(/\.html\.markdown$/, "")
    .replace(/\.markdown$/, "")
    .replace(/\.md$/, "");
}

/**
 * Compute a per-provider 0..100 normalized score for every file.
 *
 * Returns a parallel map of filepath → score_norm. Caller pairs it back
 * with the ranked list before serializing.
 *
 * The denominator is THEORETICAL_MAX_SCORE — chosen so a perfectly-scored
 * canonical+exact+primary+peers+args query lands at ~100. We deliberately
 * cap at 100 even when the raw exceeds the theoretical max (defensive: a
 * tweak to a stage weight should never produce >100).
 */
export function normalizeScores(
  scores: ReadonlyMap<string, { score: number }>,
  theoreticalMax: number = THEORETICAL_MAX_SCORE,
): Map<string, number> {
  const out = new Map<string, number>();
  const max = theoreticalMax > 0 ? theoreticalMax : 1;
  for (const [path, sf] of scores) {
    const norm = (sf.score / max) * 100;
    out.set(path, Math.max(0, Math.min(100, Math.round(norm * 10) / 10)));
  }
  return out;
}
