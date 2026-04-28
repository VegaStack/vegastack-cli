# S9 — Token Cost Re-measurement

Method: byte-count of stdout JSON envelope (proxy for token count, both
include the same JSON keys). Real bundle. Real CLI: `node dist/cli.js tf
"<query>" --max 10` vs same with `--brief`.

---

## §1 Three queries (same as S5/S7)

| Query | full (chars) | brief (chars) | brief/full ratio |
|---|---|---|---|
| "S3 bucket with versioning" | 43,648 | 14,147 | **32.4%** |
| "Cloudflare Workers with D1 database and R2 bucket" | 35,121 | 13,564 | **38.6%** |
| "tls cert with cloudflare and acm" | 24,385 | 12,290 | **50.4%** |

Range: **32%–50%** on the real bundle.

The original S5 design target was ≤ 25%. That number was measured against
fixture-sized envelopes (a few resources each). Real bundle envelopes carry
substantial per-file metadata (path, snippet, score_norm, tier, etc.) that
the brief mode can't entirely strip without breaking downstream consumers.

S7 reported 26%–41% on the same set; S9 reports 32%–50%. The difference is
not a regression — it's that the third query's full envelope is smaller
(no manifest_entry to strip) so the floor of brief output dominates,
pushing the ratio up. With `--max 10` (S9) vs `--max 15` (S7) the full
envelope is smaller too.

**Recommendation:** document compression as **typically 30%–50% on real
bundle**, not ≤25%. The ≤25% target was a fixture-derived aspiration; the
real-world number is what users actually see.

---

## §2 E3 auto `--top 1` short-circuit fire rate

Scanned all 76 run JSONs in `/tmp/exec-status/S9/runs/` for any
`top1_short_circuit` or `auto_top_1` markers.

**Fire count: 0 of 76 (0%)** — same as S7.

S8's confidence changes (alias-floor 0.65→0.6, tiebreaker 0.7→0.65) lowered
the ceiling of single-best results, which would in principle make the E3
short-circuit *less* likely to fire (it requires high-confidence single-best
detection). Empirically: still 0%.

This means the E3 short-circuit code is dead-code-rate on the real bundle.
It's defensible as a future optimization (e.g. when bundle adds many
single-canonical-name providers) but is currently providing no measurable
token savings.
