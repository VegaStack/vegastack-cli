# E9 — Cross-provider broad-eval (Phase 5)

## What we shipped
- **76 prompts** at `/tmp/exec-status/E9/cross-provider-evals.json`, distributed:
  - **all 31 providers** ≥ 2 prompts (azure had to be topped up; rest landed naturally)
  - **all 12 archetypes** A1–A12 represented (A1 19, A7 14, A6 7 dominate by design)
  - **5 personas**: PlatformEngineer 34, SecurityEngineer 16, SRE 11, JuniorDev 9, FinOps 5
  - **17 cross-provider topology** prompts (target was ≥ 15)
  - **22 prompts** target the previously-thin providers (1password, ansible, auth0, clickhouse, crowdstrike, external, helm, local, netlify, pinecone, random, redis-cloud, splunk, time, tls)
- **Manifest-side eval** of every prompt via TS `vegastack tf`, results at `eval-results.json`, full per-provider scorecard at `provider-scorecard.md`, raw envelopes at `runs/`. No LLM, no API key — every check is reproducible offline.
- **Ambiguous-query handling**: if the harness returned `status=ambiguous`, the runner re-ran once per candidate provider and unioned the result sets — this is what a real cross-provider topology prompt requires today, and the score reflects that workflow.

## Headline numbers
- mean **manifest_score** = **0.623** across 76 prompts (was 0.513 before two scoring-bug fixes — see "Lessons in the runner" below)
- **32/76** prompts full-pass (1.000), **12/76** zero-pass
- knowledge-card hit rate **2/7** (28.6%); recipe hit rate **0/0** (no prompts referenced recipes that were actually triggerable in this set); concept-alias fired on **2/76** queries (cloudflare workers + azure key-vault)
- **52/76** prompts dropped to grep-fallback (tier2) at least somewhere
- **5/76** prompts hit `status=error code=ProviderUndetected` even after the merge step (no provider keyword in the prompt at all)
- **A2/A3 archetypes are fully solved** (1.000 / 1.000) — argument-lookup and import-id queries hit a clear top-1 every time. **A6 (single-provider topology)** at 0.536 and **A7 (cross-provider topology)** at 0.434 are the lowest-scoring archetypes.

## 5 strongest providers (manifest_score)
1. pagerduty — 0.938 (4 prompts, all near top-1)
2. grafana   — 0.917 (3 prompts, dashboard/folder/contact-point all clean)
3. pinecone  — 0.889 (3 prompts; provider has only 4 resources, so coverage is tight)
4. random    — 0.875 (2 prompts; 10 resources, easy to hit)
5. 1password / splunk — 0.834 each

## 5 weakest providers (manifest_score, real signal not bundle gaps)
1. **local — 0.000** (2 prompts). The `local_file` query is mis-routed to `none/local` and the `tls→aws+cf` topology never returns local. Root cause: harness has a *negative* signal for the literal token "local" (treated as Terraform-meta noise?) — no top-1 ever surfaces `local_file.md`. Fix: add `local_file` to a default-fallback list, or boost when query ends with "local file"/"on disk".
2. **tls — 0.125** (2 prompts). The standalone "TLS self-signed cert" query routes to `local` provider because of the `internal-svc.vegastack.local` token in the prompt. The cross-provider TLS→ACM→Cloudflare prompt eventually surfaces `aws_acm_certificate` but `tls_self_signed_cert` never appears. Fix: add `tls` aliases (`"self-signed cert"`, `"private key"` → tls_*).
3. **crowdstrike — 0.167** (2 prompts). Both `crowdstrike_host_group` and `crowdstrike_cloud_aws_account` are buried below noise from AWS / generic security tokens. Fix: crowdstrike provider needs subcategory mapping for `host_group`/`cloud_aws_account` and a few aliases ("falcon sensor", "falcon host group", "register aws account with falcon").
4. **mongodb-atlas — 0.222** (3 prompts). `mongodbatlas_advanced_cluster` is correctly returned for prompts that say "Atlas" + "cluster" together, but the cost-cutting prompt and the deprecation-question prompt both hit `ProviderUndetected` because the harness doesn't recognize "Atlas cluster" without the literal "mongodb" token. Fix: alias `"atlas cluster"`/`"M40 atlas"` → mongodbatlas, and consider stemming so "M40", "M30", "M10" trigger mongodb-atlas as distinctive tokens.
5. **cloudflare — 0.312** (4 prompts). The single failure case is the workers+D1+R2 topology: `cloudflare_workers_script` surfaces (alias-driven), but `cloudflare_d1_database` and `cloudflare_r2_bucket` do not — the existing `worker` alias only includes workers_*. Fix: extend the existing `edge worker` / `static site` aliases to also include `cloudflare_d1_database` and `cloudflare_r2_bucket` as recommended_companions of `cloudflare_workers_script`, OR add new aliases `"d1"`/`"r2"` so multi-resource Cloudflare topology prompts get full coverage.

## Cross-provider topology coverage (the headline ask)
17 cross-provider prompts, mean score **0.434**. The merge-by-candidate-provider workflow successfully retrieves each provider's slice, but two systemic issues remain:
- **Provider classifier is "all-or-nothing"** — a query mentioning `cloudflare_dns_record` AND `aws_acm_certificate` AND `tls_*` returns `status=ambiguous` and forces a re-run loop; the merged result set is correct but the user (and the LLM consumer) has to do that work themselves. The CLI should return the merged envelope by default for ambiguous queries with provider list capped at 4 (this is essentially what my runner does in 30 lines).
- **Knowledge cards underfire** — for cards keyed on tokens like `[mongodbatlas_cluster]` or `[helm, release_name]`, the same token-stemming gap from the original baseline (lock vs locking) recurs. Cards on disk are not the problem; trigger phrases are too narrow.

## Archetype patterns
- **A6/A7 (topologies) are the lowest-scoring** — every soft-dependency miss propagates to a multi-resource expectation failure. The companions YAML is doing real work for AWS but isn't comprehensive for the niche providers (snowflake RBAC, vault PKI, cloudflare workers).
- **A11 (day-2) score 0.667** — ops queries like "rotate this", "schedule maintenance window" land cleanly when the provider is named explicitly.
- **A12 (deprecation) only 0.541** — half the prompts in this archetype expect a knowledge card cite that doesn't fire because of trigger token mismatches (mongo cluster card needs "mongodbatlas_cluster" literal; query says "Atlas cluster"; classifier exits before the loader even runs).

## Recommendations for v0.1.x
1. **Stem tokens in trigger matching** (already flagged in 12-prompt regression for `lock`/`locking`) — add suffix-stripping for `-ing`, `-er`, `-s` in the knowledge-card and concept-alias matchers. Closes mongodb, helm-v3, and cloudflare-rename gaps cheaply.
2. **Auto-merge ambiguous envelopes** — when `status=ambiguous` and ≤ 4 candidate providers, run them all in parallel and emit a single merged envelope with `status=ok-merged`. Removes the "you have to call us 3 times for any topology" tax.
3. **Author 12 missing aliases** for the bottom-5 providers (`tls`, `local`, `crowdstrike`, partial `mongodb-atlas`, partial `cloudflare`). Concrete proposals in the per-provider section.
4. **`recommended_companions` for niche providers** — vault PKI (root → intermediate → role), snowflake (warehouse → resource_monitor → grants), cloudflare workers (workers_script → workers_route → workers_kv_namespace → d1_database → r2_bucket). Closes A6 topology score.
5. **Provider classifier needs a tiebreaker for "X cluster" / "X service" prompts** — when two providers each score 1, the current behaviour is to abort with `ambiguous`. A sensible fallback: pick the highest-cardinality provider distinctive_token match (this would route "Atlas cluster" to mongodb-atlas, "Snowflake warehouse" to snowflake, etc.).

## Lessons in the runner (these affected the headline numbers)
- `vegastack tf` exits non-zero on `ambiguous` (rc=3) and on `ProviderUndetected` (rc=2) but still emits a usable envelope on stdout. The first iteration of my runner discarded those envelopes. Fixed in commit-1.
- `subprocess.run(capture_output=True)` truncated stdout at 64 KB on the snowflake prompt. Fixed by piping to file.
- Two file-extension cases were missing in basename normalization: `.html.md` (Vault) and `redis-cloud` keeps the `rediscloud_` prefix in the filename. Fixed; vault score jumped from 0.584 → 0.750 and redis-cloud from 0.111 → 0.611 just from those two corrections — a reminder that bundle-side "weak provider" claims need careful runner audit before being treated as substantive findings.

## Files in this drop
- `cross-provider-evals.json` — 76-prompt eval set
- `eval-results.json` — per-prompt manifest-side results (76 entries)
- `provider-scorecard.md` — per-provider table + per-prompt detail
- `runs/<id>.json` — raw envelopes for every prompt (debugging)
- `run_evals.py`, `build_scorecard.py` — repro scripts
