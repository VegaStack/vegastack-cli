// Provider detection — confidence-scored. Closes F8.
//
// Returns { provider, score, via, candidates, ambiguous } where score is
// the winning confidence in 0..1. The caller uses `provider_confidence` in
// the public envelope (status="ok") and `candidates` (status="ambiguous").
//
// Confidence model (per /tmp/synthesis/v1-plan.md §2.5):
//   • canonical name (standalone token)        → 1.0
//   • PROVIDER_SUBSTRING phrase (e.g. "mongodb atlas") → 0.9
//   • SERVICE_ALIASES (per-provider table or default) → 0.6
//
// Anti-detection list {time, local, random, external, helm} caps at 0.2
// unless a 2-token corroborator is also present (e.g. "time_static",
// "random_id", "helm chart").
//
// Ambiguous if best - second_best < AMBIGUOUS_GAP (0.2). Before declaring
// ambiguous we attempt a `distinctive_tokens` tiebreaker (closes E9 §Recs
// #5): for queries like "Atlas cluster" / "Snowflake warehouse" the noun
// is generic so the modifier picks the winner via per-provider distinctive
// vocabulary, returning `via: "tiebreaker"` at confidence 0.7.

import {
  AMBIGUOUS_GAP,
  ANTI_DETECT_CAP,
  ANTI_DETECT_CORROBORATORS,
  ANTI_DETECT_PROVIDERS,
  DEFAULT_SERVICE_ALIASES,
  PROVIDER_CONFIDENCE,
  PROVIDER_CONTEXT_EXCLUSIONS,
  PROVIDER_SUBSTRING_PHRASES,
} from "./constants.js";

export interface ProviderDetection {
  /** Winning provider name; absent when ambiguous or unmatched. */
  provider?: string;
  /** Winning confidence 0..1; 0 when no match. */
  score: number;
  /** Which stage produced the win: "canonical" | "substring" | "alias" |
   *  "tiebreaker" (distinctive_token disambiguation of an otherwise
   *  ambiguous result). */
  via?: "canonical" | "substring" | "alias" | "tiebreaker";
  /** When ambiguous, the candidate ranking (>=2 entries). */
  candidates?: { provider: string; score: number }[];
  /** True when best - second_best < AMBIGUOUS_GAP. */
  ambiguous: boolean;
}

/** A generic-noun token whose presence triggers the distinctive_token
 *  tiebreaker (see SYNTHESIS §7 fix #6). When the query contains one of
 *  these AND two or more providers tie, we let the modifier pick the
 *  winner. */
const GENERIC_NOUNS_FOR_TIEBREAKER: ReadonlySet<string> = new Set([
  "cluster",
  "service",
  "warehouse",
  "instance",
  "database",
  "dataset",
]);

const RX_ESCAPE = /[.*+?^${}()|[\]\\]/g;
function escapeRegExp(s: string): string {
  return s.replace(RX_ESCAPE, "\\$&");
}

interface DetectOptions {
  /** Canonical provider list, resolved at runtime from bundle/MANIFEST.json.
   *  When omitted, an empty list is used (only PROVIDER_SUBSTRING_PHRASES +
   *  service aliases produce hits — useful for unit tests). */
  knownProviders?: readonly string[];
  /** Per-provider service-alias overrides. Merges over DEFAULT_SERVICE_ALIASES. */
  serviceAliases?: readonly (readonly [string, string])[];
  /** Per-provider distinctive_tokens vocabulary. Used by the ambiguous
   *  tiebreaker to pick the modifier that disambiguates a generic noun
   *  ("Atlas cluster" → mongodb-atlas; "Snowflake warehouse" → snowflake).
   *  When omitted or no provider matches a query token at all, the
   *  classifier falls back to the legacy `ambiguous` behavior. */
  distinctiveTokensByProvider?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Detect the target provider for `query`, returning a confidence score. */
export function detectProvider(query: string, opts: DetectOptions = {}): ProviderDetection {
  const q = query.toLowerCase();
  const known = opts.knownProviders ?? [];
  const aliasTable = opts.serviceAliases ?? DEFAULT_SERVICE_ALIASES;

  // Per-provider best score across all stages.
  const best = new Map<string, { score: number; via: ProviderDetection["via"] }>();
  const bump = (provider: string, score: number, via: ProviderDetection["via"]): void => {
    const cur = best.get(provider);
    if (!cur || score > cur.score) best.set(provider, { score, via });
  };

  // Stage 1: canonical name (word-boundary).
  for (const provider of known) {
    const rx = new RegExp(`(?<![a-z0-9])${escapeRegExp(provider)}(?![a-z0-9])`);
    if (rx.test(q)) bump(provider, PROVIDER_CONFIDENCE.canonical, "canonical");
  }

  // Stage 2: PROVIDER_SUBSTRING phrases (e.g. "mongodb atlas").
  for (const [phrase, provider] of PROVIDER_SUBSTRING_PHRASES) {
    const rx = new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}(?![a-z0-9])`);
    if (rx.test(q)) bump(provider, PROVIDER_CONFIDENCE.substring, "substring");
  }

  // Stage 3: SERVICE_ALIASES (default + per-bundle override).
  for (const [alias, provider] of aliasTable) {
    const rx = new RegExp(`\\b${escapeRegExp(alias)}\\b`);
    if (rx.test(q)) bump(provider, PROVIDER_CONFIDENCE.alias, "alias");
  }

  // Apply context exclusions: when X is in the set with score >= alias-floor,
  // drop Y from the result (e.g. "1password vault secret" → drop vault).
  for (const [trigger, dropSet] of Object.entries(PROVIDER_CONTEXT_EXCLUSIONS)) {
    if (best.has(trigger)) {
      for (const drop of dropSet) best.delete(drop);
    }
  }

  // Apply anti-detection cap unless a corroborator is present.
  for (const [provider, info] of [...best.entries()]) {
    if (!ANTI_DETECT_PROVIDERS.has(provider)) continue;
    const corroborators = ANTI_DETECT_CORROBORATORS[provider] ?? [];
    const hasCorroborator = corroborators.some((c) => q.includes(c));
    if (!hasCorroborator && info.score > ANTI_DETECT_CAP) {
      best.set(provider, { score: ANTI_DETECT_CAP, via: info.via });
    }
  }

  // Rank.
  const ranked = [...best.entries()]
    .map(([provider, info]) => ({ provider, score: info.score, via: info.via }))
    .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));

  if (ranked.length === 0) {
    return { score: 0, ambiguous: false };
  }

  const top = ranked[0]!;
  const second = ranked[1];

  // Ambiguous when top two are within AMBIGUOUS_GAP and BOTH scored >= alias.
  // (One alias-only hit at 0.6 with no second never qualifies as ambiguous.)
  if (
    second &&
    top.score - second.score < AMBIGUOUS_GAP &&
    second.score >= ANTI_DETECT_CAP + 0.01
  ) {
    // ── distinctive_tokens tiebreaker (closes E9 §Recs #5) ──
    // Only attempt the tiebreaker when the query contains a generic noun
    // (cluster / service / warehouse / instance / database / dataset).
    // For each tied candidate, count how many of its distinctive_tokens
    // appear in the query; the highest count wins, AT confidence 0.7 to
    // signal it was a tiebreaker rather than a clean canonical match.
    const distinctive = opts.distinctiveTokensByProvider;
    const queryTokens = new Set(q.match(/[a-z0-9_]+/g) ?? []);
    const hasGenericNoun = [...queryTokens].some((t) => GENERIC_NOUNS_FOR_TIEBREAKER.has(t));
    if (distinctive && hasGenericNoun) {
      const tied = ranked.filter((r) => top.score - r.score < AMBIGUOUS_GAP);
      let bestTiebreak: { provider: string; matches: number } | undefined;
      let runnerUpMatches = 0;
      for (const cand of tied) {
        const tokens = distinctive.get(cand.provider);
        if (!tokens || tokens.size === 0) continue;
        let matches = 0;
        for (const tok of queryTokens) if (tokens.has(tok)) matches++;
        if (matches === 0) continue;
        if (!bestTiebreak || matches > bestTiebreak.matches) {
          if (bestTiebreak) runnerUpMatches = bestTiebreak.matches;
          bestTiebreak = { provider: cand.provider, matches };
        } else if (matches > runnerUpMatches) {
          runnerUpMatches = matches;
        }
      }
      // Winner only when there's a strict majority (i.e. runner-up has fewer
      // matches). Two-way ties at the same match count fall through to the
      // legacy `ambiguous` envelope.
      if (bestTiebreak && bestTiebreak.matches > runnerUpMatches) {
        return {
          provider: bestTiebreak.provider,
          score: PROVIDER_TIEBREAK_SCORE,
          via: "tiebreaker",
          ambiguous: false,
        };
      }
    }
    return {
      score: top.score,
      ambiguous: true,
      candidates: ranked.slice(0, 5).map((r) => ({ provider: r.provider, score: r.score })),
    };
  }

  const out: ProviderDetection = {
    provider: top.provider,
    score: top.score,
    ambiguous: false,
  };
  if (top.via !== undefined) out.via = top.via;
  return out;
}

/** Confidence assigned when the ambiguous tiebreaker picks a winner. Lower
 *  than the canonical / substring tiers to signal "won by modifier", not
 *  "matched by canonical name".
 *
 *  closes S7 regression: distinctive_tokens are a stronger signal than
 *  phrase-substring (alias-file phrase = 0.6) but weaker than canonical
 *  name (1.0) or substring (0.9). Lowered from 0.7 → 0.65 so that a
 *  tiebreaker win does not dominate when a true canonical/substring match
 *  for a second provider also lives in the query (e.g. "Atlas cluster on
 *  AWS" — atlas wins via tiebreaker but aws is canonical 1.0; the gap of
 *  0.35 is wide enough that auto-merge no longer fires, which is the
 *  correct outcome — the heuristic in detectMultiProviderPhrasing()
 *  takes over and forces ambiguous in this case). */
export const PROVIDER_TIEBREAK_SCORE = 0.65;
