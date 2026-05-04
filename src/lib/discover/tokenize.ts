// Tokenization for the discoverer.
//
// Algorithm:
//   1. Apply alias phrase rewrites BEFORE token splitting — alias `phrase`
//      strings are looked up case-insensitively against the original query
//      and the matched aliases' canonical names are appended to the query.
//   2. Lowercase, then extract `[a-z0-9]+` runs.
//   3. Drop tokens in NOISE or shorter than 2 characters.
//   4. Drop the canonical provider name AND each space-split component
//      (e.g. `mongodb-atlas` strips both `mongodb` and `atlas`). Closes F25.
//   5. Apply TOKEN_EXPANSIONS (token → synonyms list).
//   6. Append stems for tokens whose stem differs from the original. The
//      original is preserved for exact-match boost; the stem is a fallback
//      so trigger tokens like `lock` match query tokens like `locking`.
//   7. Dedup preserving insertion order.

import { NOISE, TOKEN_EXPANSIONS } from "./constants.js";

/**
 * Strip a small set of English suffixes to collapse common inflections.
 *
 * Priority order (first match wins):
 *   • `-ing`  → "" (e.g. "locking" → "lock")
 *   • `-s`    → "" (e.g. "tables" → "table", "buckets" → "bucket",
 *                       "clusters" → "cluster", "workers" → "worker")
 *     The plural rule subsumes "-ers" / "-es" in practice: if the user
 *     wrote a plural noun, -s strip yields the singular noun the trigger
 *     side likely uses ("cluster" trigger ↔ "clusters" query).
 *   • `-es`   → "" (e.g. "boxes" → "box", "classes" → "class")
 *     ONLY when the -s strip wouldn't be a sensible singular — i.e. when
 *     the resulting stem ends in s/x/z/ch/sh (standard English -es rule).
 *   • `-er`   → "" (e.g. "rotator" → "rotat", "worker" → "work")
 *     Applied only when no plural rule fired and the input is genuinely
 *     an "-er" noun (not a plural).
 *
 * The min-length floor is 3 characters: any rule that would produce a stem
 * shorter than 3 chars is skipped (returns the original token unchanged).
 *
 * Numeric/identifier-style tokens (purely digits, or tokens containing `_`)
 * are returned unchanged — "M40" / "v2" / "kms_alias" must not be stemmed.
 */
export function stem(token: string): string {
  // P5 regressions.md item #1 (E9-A4-k8s-v1-suffix): protect any token
  // that contains a digit.  The original guard only caught *purely numeric*
  // tokens (`/^\d+$/`).  Versioned identifiers like "v1", "v2", "v3",
  // tier-name tokens like "m10"/"m30"/"m40", AWS instance-type suffixes
  // like "t4g"/"r6g", and compound names like "db.r6g.4xlarge" all carry
  // the digit as a *semantic* part of the name — stripping any suffix would
  // produce a wrong/non-existent canonical name and break trigger matching.
  // Returning unchanged before any suffix rule fires is the safest contract:
  // the caller (tokenizeWithAliases) still appends the stem when it differs,
  // so this guard simply short-circuits for digit-bearing tokens.
  if (/[0-9]/.test(token)) return token;
  if (token.length < 4) return token;
  if (token.includes("_")) return token;

  // -ing — needs ≥6 char input so the stem retains ≥3 chars.
  if (token.length >= 6 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  // Plural -es: only when the stem (post-strip) ends in s/x/z/ch/sh,
  // matching the English plural rule for sibilant-ending nouns. This
  // avoids mis-stripping "tables" → "tabl" or "buckets" → "buck".
  if (token.length >= 5 && token.endsWith("es")) {
    const candidate = token.slice(0, -2);
    if (candidate.length >= 3 && /(?:[sxz]|ch|sh)$/.test(candidate)) {
      return candidate;
    }
  }
  // Plural -s: covers "clusters" → "cluster", "buckets" → "bucket",
  // "workers" → "worker", "tables" → "table".
  if (token.endsWith("s") && !token.endsWith("ss") && token.length >= 4) {
    return token.slice(0, -1);
  }
  // -er: agentive noun → verb stem ("rotator" → "rotat"). Applied only
  // when no plural rule matched (single noun, not "-ers" plural).
  if (token.length >= 5 && token.endsWith("er")) {
    return token.slice(0, -2);
  }
  return token;
}

export interface AliasRewrite {
  /** The original phrase that fired (case-insensitive substring match). */
  phrase: string;
  /** Canonical alias name to be added as an extra token. */
  alias: string;
  /** Resource names this alias maps to (used by tier1 stage). */
  resources: string[];
  /** Provider this alias belongs to. */
  provider: string;
}

export interface TokenizeResult {
  tokens: string[];
  /** Alias rewrites that fired, for the envelope's concept_aliases_used[]. */
  aliasMatches: AliasRewrite[];
}

export interface TokenizeOptions {
  /** Aliases for the detected provider (loaded by aliases.ts). */
  aliases?: AliasRewrite[];
}

/** Tokenize and apply expansions; returns both tokens and alias matches. */
export function tokenizeWithAliases(
  query: string,
  provider: string | undefined,
  opts: TokenizeOptions = {},
): TokenizeResult {
  const aliasMatches: AliasRewrite[] = [];
  const aliases = opts.aliases ?? [];

  // Step 1 — alias phrase rewrites BEFORE splitting. We DON'T inject the
  // alias name into the query string (regex splitting would shred a snake_case
  // alias like `bot_protection` into `bot` + `protection`). Instead we collect
  // the matches and append the alias names as literal tokens after splitting.
  const qLower = query.toLowerCase();
  const aliasTokens: string[] = [];
  for (const a of aliases) {
    if (a.phrase && qLower.includes(a.phrase.toLowerCase())) {
      aliasMatches.push(a);
      aliasTokens.push(a.alias.toLowerCase());
    }
  }

  const raw = query.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const out: string[] = [];

  // Build the per-token strip set: canonical provider AND each space-split
  // component when the canonical name has a hyphen / space form.
  const stripSet = new Set<string>();
  if (provider) {
    stripSet.add(provider.replace(/-/g, ""));
    for (const piece of provider.split(/[-_\s]+/)) {
      if (piece.length >= 2) stripSet.add(piece);
    }
  }

  for (const t of raw) {
    if (NOISE.has(t)) continue;
    if (t.length < 2) continue;
    if (stripSet.has(t)) continue;
    out.push(t);
    const expansions = Object.prototype.hasOwnProperty.call(TOKEN_EXPANSIONS, t)
      ? TOKEN_EXPANSIONS[t]
      : undefined;
    if (expansions) out.push(...expansions);
    // Append stem when it differs and survives min-length / strip filters.
    const s = stem(t);
    if (s !== t && s.length >= 3 && !stripSet.has(s) && !NOISE.has(s)) {
      out.push(s);
    }
  }

  // Aliases appended AFTER the natural-language tokens so they don't get
  // dropped by NOISE / strip filters.
  for (const a of aliasTokens) out.push(a);

  return { tokens: Array.from(new Set(out)), aliasMatches };
}

/** Backwards-compat shim: return only the tokens. */
export function tokenize(query: string, provider?: string): string[] {
  return tokenizeWithAliases(query, provider).tokens;
}
