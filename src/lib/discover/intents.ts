// Intent grouping: when the query hit ≥2 distinct subcategories via
// `subcat_keyword`, surface them as labeled groups so the agent can present
// "this query wants both ELB *and* RDS" answers.
//
// Each file is assigned to its FIRST `subcat_keyword` reason. Files without
// any `subcat_keyword` reason are skipped from the breakdown.

import type { IntentGroup } from "./types.js";
import type { RankedFile } from "./merge.js";

interface IntentBucket {
  intent: string;
  keyword: string;
  files: { path: string; score: number }[];
}

const RX_SUBCAT_DETAIL = /^([^→]+)→(.+)$/;

export function buildIntents(ranked: RankedFile[]): IntentGroup[] {
  const buckets = new Map<string, IntentBucket>();

  for (const f of ranked) {
    for (const r of f.reasons) {
      if (r.kind !== "subcat_keyword") continue;
      const m = RX_SUBCAT_DETAIL.exec(r.detail);
      if (!m) continue;
      const keyword = m[1] ?? "";
      const intent = m[2] ?? "";
      if (!intent) continue;
      let bucket = buckets.get(intent);
      if (!bucket) {
        bucket = { intent, keyword, files: [] };
        buckets.set(intent, bucket);
      }
      bucket.files.push({ path: f.path, score: f.score });
      break;
    }
  }

  if (buckets.size < 2) return [];

  return Array.from(buckets.values())
    .map((b) => ({
      intent: b.intent,
      files: b.files
        .sort((x, y) => y.score - x.score)
        .slice(0, 3)
        .map((x) => x.path),
      rationale: `subcategory keyword '${b.keyword}' matched`,
    }))
    .sort((a, b) => a.intent.localeCompare(b.intent));
}
