# S2 — Phase-5 Synthesis (R6 + E9)

**Date:** 2026-04-28 · **Author:** S2 · **Inputs:** R6 (web research, 2,450 words), E9 (76-prompt cross-provider eval), A1 (12-prompt regression), FINAL-VERDICT v0.1.

---

## §1 TL;DR

Across 31 providers and 76 prompts the harness scores **manifest_score 0.623** (E9 §Headline) — meaning, on a 0-1 scale, the average prompt gets the canonical resource into top-rank with proper companion/import metadata about 62% of the time; **32/76 prompts full-pass and 12/76 zero-pass**. The single biggest R6 finding is that **HashiCorp shipped its own `agent-skills` bundle on 2026-02-02 (R6 §1.2)** but it covers *authoring* (write providers, run tests) — *not* per-resource doc lookup — so vegastack-cli has a real, namable moat rather than a competitor; meanwhile **Skills.sh and Tessl registries already index our SKILL.md format for free (R6 §3d)**. The single biggest E9 gap is that **A6/A7 cross-provider topology prompts score 0.536/0.434 (E9 §Archetype)** because the classifier returns `status=ambiguous` and forces the consumer to re-call us per provider — v0.1.x must auto-merge ambiguous envelopes.

---

## §2 Per-provider strength matrix

Reproduced from E9 provider scorecard, clustered into 4 tiers.

| Tier | Providers (manifest_score) | Common pattern |
|---|---|---|
| **STRONG (≥0.8)** | pagerduty 0.938, grafana 0.917, pinecone 0.889, random 0.875, 1password 0.834, splunk 0.834 | Small, focused providers (≤30 resources) with distinctive token vocabulary — no AWS/Terraform-meta noise to compete with (E9 §Top 5). |
| **OK (0.5-0.8)** | vercel 0.767, vault 0.750, ansible/external 0.750, okta 0.700, gcp 0.667, digitalocean/netlify 0.666, snowflake 0.648, redis-cloud 0.611, auth0 0.584, datadog 0.567, time/azure 0.500 | Mid-cardinality providers where canonical-name signal usually wins; failure is companion-misses on A6/A7 topology, not classification (E9 §Per-provider). |
| **WEAK (0.3-0.5)** | helm 0.488, gitlab 0.458, aws 0.428, kubernetes 0.389, clickhouse 0.334, github 0.333, cloudflare 0.312 | Cross-provider noise: AWS shows up in 15 prompts and gets pulled into other providers' queries; cloudflare's worker-topology prompt under-fires because the alias only covers `workers_script` (E9 §Bottom 5). |
| **BROKEN (<0.3)** | mongodb-atlas 0.222, crowdstrike 0.167, tls 0.125, local 0.000 | Token-stem mismatches and a *negative* signal on the literal token "local"; provider classifier exits before the loader runs (E9 §Bottom 5, §Recommendations). |

The *AWS-heavy baseline* (A1 12-prompt regression) gave us "ship it" confidence at score patterns >0.7 on the resources we explicitly cared about; the 0.623 cross-provider mean is honest evidence that the niche/long-tail bundle still has real gaps even though the headline AWS/Terraform-meta cases work.

---

## §3 Bottom-5 deep dive

### local — 0.000 (2 prompts) (E9 §Bottom 5 #1)
**Why low:** `local_file` query is mis-routed to `none/local`; the cross-provider `tls→aws+cf` topology never returns `local`. Root cause per E9: the harness has a *negative* signal for the literal token "local" (treated as Terraform-meta noise like `local.foo`).
**Fix:** Add `local_file` to a default-fallback list; boost when query ends with "local file" / "on disk".
**Effort:** 30 min (token whitelist in `tokenize.ts` plus 2 aliases).
**Blocking?** Real — `local_file` is the canonical "render a templated file to disk" resource that JuniorDev/CI prompts hit first.

### tls — 0.125 (2 prompts) (E9 §Bottom 5 #2)
**Why low:** Standalone "TLS self-signed cert" routes to `local` because the prompt contains `internal-svc.vegastack.local`. The TLS→ACM→Cloudflare topology surfaces `aws_acm_certificate` but `tls_self_signed_cert` never appears.
**Fix:** Add aliases `"self-signed cert"` and `"private key"` → `tls_*`; teach tokenizer that `*.local` hostnames are not the `local` provider.
**Effort:** 30 min (aliases + 1 regex).
**Blocking?** Real — common SecurityEngineer workflow (mTLS bootstrap).

### crowdstrike — 0.167 (2 prompts) (E9 §Bottom 5 #3)
**Why low:** Both `crowdstrike_host_group` and `crowdstrike_cloud_aws_account` are buried below noise from AWS / generic security tokens.
**Fix:** Subcategory mapping for `host_group`/`cloud_aws_account` plus aliases `"falcon sensor"`, `"falcon host group"`, `"register aws account with falcon"`.
**Effort:** 45 min (subcat + 3 aliases + companions for falcon→aws).
**Blocking?** Niche — CrowdStrike is enterprise-only; mostly academic for v0.1.x but cheap to fix.

### mongodb-atlas — 0.222 (3 prompts) (E9 §Bottom 5 #4)
**Why low:** Cost-cutting and deprecation prompts hit `ProviderUndetected` because the harness doesn't recognize "Atlas cluster" without the literal "mongodb" token. Also: the `mongo-cluster-replaced` knowledge card never fires (A12) because trigger is `[mongodbatlas_cluster]` literal but query says "Atlas cluster" (E9 §Archetype A12).
**Fix:** Alias `"atlas cluster"`, `"M40 atlas"` → mongodbatlas; stem `M40`/`M30`/`M10` as distinctive tokens; add token-stemming so `lock`/`locking` and `cluster`/`clusters` collapse (this also closes A1's D1 killer card).
**Effort:** 1 hour (aliases + the stemmer that fixes D1 too).
**Blocking?** Real — Atlas is the dominant managed Mongo; this is the same root cause as the documented D1 regression.

### cloudflare — 0.312 (4 prompts) (E9 §Bottom 5 #5)
**Why low:** Workers+D1+R2 topology returns `cloudflare_workers_script` (alias-driven) but neither `cloudflare_d1_database` nor `cloudflare_r2_bucket`.
**Fix:** Extend the existing `edge worker` / `static site` aliases to add `cloudflare_d1_database` and `cloudflare_r2_bucket` as `recommended_companions` of `cloudflare_workers_script`; OR add fresh `"d1"` / `"r2"` aliases.
**Effort:** 20 min (companions YAML edit).
**Blocking?** Real — Cloudflare Workers is the modal modern-edge stack; this is exactly the prompt LLM consumers will run.

---

## §4 Top-5 deep dive

### pagerduty — 0.938 (E9 §Top 5)
4 prompts, all near top-1. **Why winning:** small focused provider (~50 resources), distinctive token vocabulary (`service`, `escalation_policy`, `maintenance_window`), no cross-provider competition.

### grafana — 0.917
3 prompts, dashboard/folder/contact-point all clean. **Why winning:** distinctive resource names (`grafana_dashboard`, `grafana_folder`) with no AWS/k8s collision; plus A3 import-id query has explicit URL-style ids.

### pinecone — 0.889
3 prompts. **Why winning:** provider has only ~4 resources, so coverage is mathematically tight; `index` and `collection` are unambiguous when paired with "vector" or "rag".

### random — 0.875
2 prompts, 10 resources. **Why winning:** `random_password`, `random_string`, `random_uuid` carry zero ambiguity — the provider's 10 resources cover every plausible query.

### 1password — 0.834
2 prompts. **Why winning:** distinctive `op_item` token vocabulary; recently fixed regex bug (FINAL-VERDICT MUST-FIX #3) means provider name is now properly accepted everywhere.

**Replicable pattern for the bottom 5:** every winning provider has (a) ≤30 resources, (b) distinctive token vocabulary that doesn't collide with AWS/Terraform-meta, and (c) at least one alias or canonical token that disambiguates the *concept* even when the *provider name* isn't typed. The bottom 5 fail (a) or (c). Lift recipe: **for each WEAK/BROKEN provider, add 2-3 concept aliases and 1 companions block** (≈30 min/provider).

---

## §5 Archetype breakdown

| Archetype | n | mean | comment |
|---|---|---|---|
| A2 (argument lookup) | 5 | **1.000** | Easy: query already names the resource |
| A3 (import id) | 5 | **1.000** | Easy: import-id syntax is distinctive |
| A4 (migration) | 4 | 0.792 | Knowledge cards fire when phrasing matches |
| A9 (cost cut) | 4 | 0.750 | Provider name usually present |
| A11 (day-2 ops) | 3 | 0.667 | Lands when provider explicitly named |
| A5 (soft deps) | 4 | 0.667 | Companions YAML doing real work for AWS |
| A1 (single resource) | 19 | 0.579 | Long tail — niche providers drag mean down |
| A12 (deprecation) | 4 | 0.541 | Token-stem mismatches kill knowledge-card cites |
| **A6 (single-prov topology)** | 7 | **0.536** | Companions YAML not comprehensive for niches |
| **A7 (cross-prov topology)** | 14 | **0.434** | Classifier returns `ambiguous`, forces multi-call |

**Why A2/A3 are easy:** the query *names* the resource (A2) or carries the import-id syntax (A3) — both are distinctive tokens that hit the canonical-name boost in the score normalizer (E9 §Archetype).

**Why A7 is hard:** mostly the harness's fault, not the eval's fault. E9's runner had to add an "ambiguous-merge" workaround (re-run once per candidate provider, union the results) for any prompt mentioning ≥2 providers (E9 §What we shipped, §Cross-provider). This is the workflow a real LLM consumer needs and the CLI should provide it natively. The fact that the merged answers are correct (E9 §Cross-provider) means the *bundle* is fine — the *envelope contract* is wrong.

**What the harness needs by default:** when `status=ambiguous` and ≤4 candidate providers, the CLI should fan out internally and emit one envelope `status=ok-merged` with `provider: "aws+cloudflare+tls"` and a unioned `files[]` / `knowledge[]` / `recipes[]` (E9 §Recommendations #2). Without this, every cross-provider workflow incurs a 3-call tax that no LLM consumer should be expected to pay.

---

## §6 Comparative position vs OpenClaw / Hermes / HashiCorp

**Defensible positioning vs HashiCorp `agent-skills` (R6 §1.2, §3a):** HashiCorp's bundle is *authoring* — "how to write a provider", "azure-verified-modules", "run acceptance tests" (11 skills, Terraform + Packer). It deliberately does *not* index per-resource docs. Vegastack-cli is *consumer-side*: "look up `aws_db_instance`", "what are the companions of `vault_pki_secret_backend_root_sign_intermediate`", "import id syntax for `cloudflare_dns_record`". The repos are non-overlapping and complementary. The README should call this out explicitly with a side-by-side install matrix (R6 §6 rec #6).

**Should we register on Skills.sh + Tessl + OpenClaw now? Yes — all three (R6 §3d, §1.1).** Skills.sh and Tessl already auto-index any GitHub repo containing SKILL.md; we just need `keywords: ["agent-skill","skill","terraform","claude-code","codex","cursor","gemini-cli","mcp","iac","hashicorp"]` in `package.json` and the install one-liners in README. OpenClaw catalog inclusion is also free since our SKILL.md doesn't conflict with their `metadata.openclaw.*` namespace (R6 §4 OpenClaw). Submitting PRs to `VoltAgent/awesome-agent-skills`, `heilcheng/awesome-agent-skills`, `quemsah/awesome-claude-plugins`, `mergisi/awesome-openclaw-agents` adds 4 more discovery surfaces (R6 §6 rec #2). Total effort: ~40 min, zero code.

**Single design pattern to adopt — TerraShark's diagnostic-first SKILL.md (R6 §3b).** TerraShark opens its SKILL.md with a 6-line *decision tree* (`If query mentions X → load references/X.md`) before invoking any heavy CLI. Activation cost ~600 tokens vs ~4,400 if everything loaded eagerly. Our SKILL.md currently invokes `vegastack tf` immediately on every turn. Rewriting the body to dispatch first, invoke second cuts per-turn token cost ~7× and matches the convergent 2026 pattern (R6 §5 pattern #4).

**Microsoft Agent Framework recommendation (R6 §3e):** add `compatibility: "Requires Node >=18; @vegastack/cli on PATH"` to SKILL.md frontmatter. They explicitly recommend populating this field; we currently leave it empty.

**Hermes recommendation (R6 §4 Hermes):** add `tags: [Terraform, IaC, Documentation, Multi-Provider, Deterministic]` and `codex: [vegastack-cli]` — surfaces us in Hermes search at zero cost.

**What to EXPLICITLY reject:**
- **Hermes's gateway daemon (R6 §4 Hermes):** serving Telegram/Discord/Slack from one daemon is fun but out of scope; we don't need to be a chat platform.
- **OpenClaw's `metadata.openclaw.*` install block (R6 §1 OpenClaw row):** declaring `install.{brew,node,go,uv}` inside frontmatter conflates skill metadata with package-manager logic; we already have npm + R2 for this. Stay vendor-neutral.
- **Hermes's "skills self-improve" auto-curation (R6 §4 Hermes):** an agent rewriting skills behind the user's back violates our "code owns determinism, LLMs own meaning" stance (R6 §5 pattern #5).
- **Goose recipe YAML (R6 §1 row 11):** orthogonal to skills; can ship later as v0.2 nice-to-have, not v0.1.x.

---

## §7 Concrete v0.1.x recommendations — RANKED

Combined R6 (8 recs) + E9 (5 recs), de-duped and prioritized by impact ÷ effort.

| # | What | Why now | Effort | Expected lift | Success criterion |
|---|---|---|---|---|---|
| 1 | Add `keywords[]` to `package.json` + install one-liners (`npx skills add`, `tessl i`) to README (R6 §6 #1) | Free distribution; both registries already crawl us | 10 min | +3 discovery channels (Skills.sh, Tessl, OpenClaw) | `npx skills find vegastack` returns our package within 24h |
| 2 | Auto-merge ambiguous envelopes: when `status=ambiguous` and ≤4 candidates, fan out and emit `status=ok-merged` (E9 §Recs #2) | Fixes A7 0.434 — biggest archetype gap | 2 hours (~80 LOC in `discover.ts`) | A7 mean: 0.434 → ≈0.7 | E9 prompt `E9-A7-tls-acm-cloudflare` returns merged envelope in one call |
| 3 | Token stemming (`-ing`/`-er`/`-s`/`-es`) in tokenizer + alias matcher (E9 §Recs #1; A1 SHOULD-FIX #8) | Closes D1 killer card *and* mongodb-atlas / helm-v3 / cloudflare-rename | 1 hour | D1 cite hit; A12 0.541 → ≈0.75; mongodb-atlas 0.222 → ≈0.55 | `vegastack tf "S3 backend state locking DynamoDB"` cites `aws-s3-native-state-locking` |
| 4 | Add 12 missing aliases: tls (3), local (2), crowdstrike (3), mongodb-atlas (2), cloudflare workers→d1/r2 (2) (E9 §Recs #3) | Lifts all 5 BROKEN/WEAK providers | 1 hour | local 0.000→≈0.5; tls 0.125→≈0.6; cf 0.312→≈0.7 | E9 bottom-5 mean: 0.165 → ≥0.55 |
| 5 | Add `recommended_companions` for vault-PKI / snowflake-RBAC / cloudflare-workers chains (E9 §Recs #4) | Closes A6 0.536 | 1 hour | A6 mean: 0.536 → ≈0.75 | `E9-A6-cloudflare-workers-d1-r2` and `E9-A6-snowflake-warehouse-rbac` both ≥0.75 |
| 6 | Provider classifier tiebreaker: pick highest-cardinality distinctive_token match instead of `ambiguous` for "X cluster" / "X service" (E9 §Recs #5) | "Atlas cluster" → mongodb-atlas; "Snowflake warehouse" → snowflake | 45 min | mongodb-atlas + snowflake A1/A12 prompts go from `ProviderUndetected` to top-1 | `vegastack tf "tune Atlas cluster cost"` returns `mongodbatlas_advanced_cluster` rank 1 |
| 7 | Rewrite SKILL.md: TerraShark-style 6-line decision tree first; add `compatibility`, `tags[]`, `codex[]` frontmatter (R6 §6 #3) | 7× token savings on activation; matches 2026 convergent pattern; surfaces in Hermes/OpenClaw | 2 hours | activation tokens 4,400 → ~600 | SKILL.md opens with decision tree; per-turn token cost measurably down |
| 8 | Position vs HashiCorp explicitly in README (side-by-side table: authoring vs consuming) (R6 §6 #6) | Turns competition into complementarity | 30 min | clarifies story; defensible vs MPL-2.0 competitor | README has "vs `hashicorp/agent-skills`" section with both install lines |
| 9 | Submit catalog PRs to VoltAgent/awesome-agent-skills + heilcheng + quemsah + mergisi (R6 §6 #2) | 4 free SEO surfaces | 30 min | catalog inclusion in 4 repos | All 4 PRs open within a week |
| 10 | Add `AGENTS.md` router at repo root (atmos pattern); preps multi-skill split (R6 §6 #5) | Token-cheap dispatcher; clean v0.2 path | 30 min | enables future `tf-discover`/`tf-recipes`/`tf-knowledge` split | `AGENTS.md` exists; routes correctly |
| 11 | Cursor renderer: byte-compare before warning (FINAL-VERDICT SHOULD-FIX #6) | Closes A3's idempotency caveat | 15 min | re-install no longer warns falsely | second install run prints "no change" |
| 12 | Default MCP transport `/sse` → `/mcp` (StreamableHTTP) for claude-code + continue (FINAL-VERDICT SHOULD-FIX #7) | Modern clients prefer it | 5 min | Continue/Codex install works out-of-box | `vegastack skills install --agent continue` produces `/mcp` URL |

**Cap:** 12. Items 1-6 are the v0.1.1 release; items 7-12 are v0.1.2.

---

## §8 What v0.1 SHIPS as-is

v0.1.0 already published: 5 MUST-FIX items landed, 308/308 tests, 379/379 across 4 codebases (FINAL-VERDICT). The 12-prompt regression closed the 3 documented baseline failures (D2 dns_record rank, C1 autoscaling, D3 hallucination). **Nothing in R6 or E9 invalidates that ship decision.**

What changes? E9's 0.623 cross-provider mean is *new* honest data showing the long tail (local, tls, crowdstrike, mongodb-atlas, cloudflare-workers) is rougher than the AWS-heavy baseline suggested. R6 adds urgency to the distribution side: HashiCorp's 2026-02-02 launch and Skills.sh/Tessl registries are *now*, and being absent from those for another month is a real cost.

**Honest verdict: ship v0.1.0 as-is, ship v0.1.1 within 1 week with items #1-6 (≈6 hours total), ship v0.1.2 within 2 weeks with items #7-12 (≈4 hours).** The Top-3 polish (auto-merge + stemming + 12 aliases) is high-ROI enough that v0.1.1 should be the *cited* version in any external announcement. The current dashboard `+47%` figure is fixture data per FINAL-VERDICT U6 — replace with real eval before any external lift claim regardless.

---

## §9 Open questions for the user (max 6)

1. **Multi-skill split for v0.2?** Frame: should `terraform-docs` split into `tf-discover` + `tf-recipes` + `tf-knowledge` per atmos/HashiCorp 3-tier pattern (R6 §3a, §3c)? Default: no split for v0.1.x (keep flat). Trade-off: cleaner scaling for v0.2 vs disruption to existing install flows now.

2. **Adopt OpenClaw `metadata.openclaw.*` extension fields?** Frame: declaring `install.{brew,node,go,uv}` inside SKILL.md frontmatter (R6 §1 OpenClaw row) increases discoverability inside their 5,400-skill catalog. Default: no — stay vendor-neutral and let `npm i` do it. Trade-off: ~5% additional crawler ranking in OpenClaw catalog vs spec drift.

3. **Ship Goose recipe YAML alongside SKILL.md?** Frame: Goose moved to AAIF (Linux Foundation) and recipes are portable YAML (R6 §1 row 11). Default: defer to v0.2. Trade-off: +1 discovery surface vs maintaining a second canonical format.

4. **Add Amazon Kiro renderer (currently 6 renderers; agentopology supports 7)?** Frame: Kiro is the gap (R6 §6 #7). Default: ship v0.1.x without it; add in v0.2. Trade-off: 2 hours of work for one more harness.

5. **Reposition messaging: "the consuming half of HashiCorp's agent-skills story"?** Frame: a one-line tagline change in README + npm description (R6 §3a, §6 #6). Default: yes. Trade-off: ties our identity to a competitor's brand vs clarifying we're complementary.

6. **Allow ambiguous-merge to fan out >4 candidate providers?** Frame: the runner caps at 4 today (E9 §Cross-provider). Default: keep cap at 4 to bound latency. Trade-off: a 5-provider topology query (e.g., aws+gcp+azure+vault+k8s) would still need explicit `--provider`.

---

*End S2 — total word count ≈2,950, within 3,000 cap. No code changed. Every claim cited back to R6 §X, E9 §X, A1, or FINAL-VERDICT.*
