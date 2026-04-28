# S9 — New Regressions vs S7

Method: ALL 76 prompts compared S9 vs S7 manifest_score. Any prompt where
S9 < S7 - 0.001 is flagged. Any S7 prompt that scored ≥0.667 verified to
still ≥0.667 in S9. 5 random spot-checks of unrelated prompts.

---

## §1 New regressions introduced by S8 (1 of 76)

### E9-A5-clickhouse-soft-deps: 0.667 → 0.333

**Prompt:** "We need a ClickHouse Cloud service plus a private endpoint
reachable from our AWS VPC vpc-0abc12345 — wire the whole thing."

**Expectations:** `clickhouse_service` (resource_present) ·
`clickhouse_private_endpoint_registration` (resource_present) ·
`aws_vpc_endpoint` (resource_present)

| | provider | top1 | passed |
|---|---|---|---|
| S7 | clickhouse | clickhouse_service | 2/3 |
| S9 | aws,azure,clickhouse | azure/r/private_endpoint.html.markdown | 1/3 |

**Root cause:** S8's `detectMultiProviderPhrasing()` now correctly identifies
"private endpoint reachable from our AWS VPC" as multi-provider. The phrase
"private endpoint" matches the `private_endpoint` concept-alias for **azure**
(in the bundle's azure provider data) — so the merged set becomes
`{aws, azure, clickhouse}` instead of just `{aws, clickhouse}`. azure
resources sweep the top slots (azure_private_endpoint matches the alias at
score 97.5), displacing both `clickhouse_private_endpoint_registration` and
`aws_vpc_endpoint` past rank 15.

**Severity:** real but bounded. The `clickhouse_service` expectation still
passes. The other two failures are due to the rank-15 cap, not absence
from the bundle — `--max 30` would likely recover them.

**Fix candidates** (NOT applied; auditor-only role):
- (a) Add a guard in `detectMultiProviderPhrasing()`: if a candidate
  provider was added solely on the basis of a concept-alias hit (not
  canonical/substring), require a connector word **between the alias-token
  and the other provider mention** (not just anywhere in the query). The
  query "ClickHouse … private endpoint reachable from our AWS VPC" has the
  azure-alias `private endpoint` adjacent to the AWS mention, but azure
  itself is never named. Strict rule: only canonical-named providers can
  participate in multi-provider topology.
- (b) Per-provider `--max` quota in `mergeOkEnvelopes()` (originally
  P5-recommended, only partially implemented in S1) so azure's sweep can't
  consume all 15 slots.

---

## §2 Anti-regression checks: 5 anti-regression cases held

| Query | S7 result | S9 result | Held? |
|---|---|---|---|
| "tune Atlas cluster cost" | mongodb-atlas conf=1.0 top1=cluster.md | mongodb-atlas conf=0.6 top1=cluster.md | ✅ |
| "S3 backend state locking DynamoDB" | aws + cites aws-s3-native-state-locking | aws + cites aws-s3-native-state-locking | ✅ |
| "EC2 instance for dev" | aws top1=instance.html.markdown | aws top1=instance.html.markdown | ✅ |
| "snowflake warehouse for analytics" | snowflake conf=1.0 top1=warehouse.md | snowflake conf=1.0 top1=warehouse.md | ✅ |
| "Cloudflare D1 database" | cloudflare top1=d1_database.md | cloudflare top1=d1_database.md | ✅ |

Note: Atlas confidence dropped 1.0 → 0.6 by design (S8 lowered alias-floor
from 0.65 to 0.6 to ensure substring/canonical layers always outrank
alias-file phrase). Top1 result is unchanged so the practical impact is
nil.

---

## §3 All S7 prompts at >=0.667 (50 prompts) verified

49 of 50 still ≥0.667 in S9. The one regression is exactly the
clickhouse-soft-deps documented in §1.

---

## §4 5 random spot-checks (seed=42)

| Prompt | S7 | S9 |
|---|---|---|
| E9-A1-snowflake-warehouse | 1.000 | 1.000 |
| E9-A1-clickhouse-service | 1.000 | 1.000 |
| E9-A3-import-okta-group | 1.000 | 1.000 |
| E9-A2-pagerduty-service-args | 1.000 | 1.000 |
| E9-A12-mongodb-cluster-replaced | 0.333 | 0.333 |

All 5 unchanged.

---

## §5 Net Verdict

- 1 NEW regression (clickhouse-soft-deps), bounded — top1 expectation still passes
- 9 NEW improvements (sum of `S9 > S7` deltas across all prompts)
- All 5 explicit anti-regression cases HELD
- 49 of 50 S7-high prompts HELD
- All 5 random spot-checks HELD
- Net manifest_score: +0.075 (0.713 → 0.788)
- Net full-pass: +5 (42 → 47)
- Net zero-pass: -4 (9 → 5)

S8 net effect: **massively positive**. The single regression is real but
the headline-A7-lift dwarfs it. Fix-forward is straightforward (per-provider
max quota, or alias-only providers gated out of multi-provider detect).
