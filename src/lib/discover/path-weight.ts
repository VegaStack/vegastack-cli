import { PATH_WEIGHTS } from "./constants.js";

/**
 * Score multiplier (0.2 — 1.0) based on a file path. First-match-wins, mirroring
 * the Python harness. The intent is:
 *   • resources/ and r/ score full weight (the canonical doc location)
 *   • data-sources/ and d/ score 0.8 (slightly less primary)
 *   • index.* docs score 0.5
 *   • guides/ and functions/ score very low — relevant but not the answer
 */
export function pathWeight(filepath: string): number {
  for (const [pattern, weight] of PATH_WEIGHTS) {
    if (filepath.includes(pattern)) return weight;
  }
  return 1.0;
}
