// Merge Tier-1 (manifest) and Tier-2 (grep) scoring maps into a single ranked
// list. A grep hit on a file already in Tier-1 contributes half-weight and
// promotes the file to "manifest+grep". Pure manifest hits stay "manifest";
// pure grep hits stay "grep".
//
// Sort order (deterministic):
//   1. score desc
//   2. resource-name length asc (shorter wins) — F6 tie-break
//   3. path asc

import { tieBreakByNameLength } from "./scoring.js";
import type { ScoredFile } from "./types.js";

export interface RankedFile extends ScoredFile {
  path: string;
}

export function mergeAndRank(
  tier1: ReadonlyMap<string, ScoredFile>,
  tier2: ReadonlyMap<string, ScoredFile>,
  maxFiles: number,
): RankedFile[] {
  const merged = new Map<string, ScoredFile>();

  for (const [path, sf] of tier1) {
    merged.set(path, { score: sf.score, reasons: sf.reasons.slice(), tier: "manifest" });
  }

  for (const [path, sf] of tier2) {
    const existing = merged.get(path);
    if (existing) {
      existing.score += sf.score * 0.5;
      for (const r of sf.reasons) {
        existing.reasons.push({
          kind: "grep_confirmed",
          detail: `${r.kind}:${r.detail}`,
        });
      }
      existing.tier = "manifest+grep";
    } else {
      merged.set(path, {
        score: sf.score,
        reasons: sf.reasons.slice(),
        tier: "grep",
      });
    }
  }

  return Array.from(merged.entries())
    .map(([path, sf]) => ({ path, ...sf }))
    .sort(tieBreakByNameLength)
    .slice(0, maxFiles);
}
