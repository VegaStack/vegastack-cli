/**
 * Sliding-window 2-character bigrams. Identical algorithm to the Python:
 *   "example" → ["ex", "xa", "am", "mp", "pl", "le"]
 *
 * Used by the Tier-1 typo fallback: if no Tier-1 hits found and a token is
 * 5+ chars, look for resources whose pre-computed bigrams overlap ≥70% with
 * the token's bigrams.
 */
export function bigrams(s: string): string[] {
  if (s.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    out.push(s.slice(i, i + 2));
  }
  return out;
}
