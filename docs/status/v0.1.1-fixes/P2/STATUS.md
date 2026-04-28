# P2 — STATUS

**Date:** 2026-04-28
**Owner:** P2
**Scope:** v0.1.1 bundle content fixes — §7 items #4 (12 missing aliases) and #5 (recommended_companions for niche provider chains).
**Bundle root:** `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/`

---

## Files authored / extended

### Aliases (Fix 4)

| File | Status | Entries added | Notes |
|---|---|---|---|
| `local/aliases.yaml` | NEW | 2 | "render template to disk", "write file on disk" |
| `tls/aliases.yaml` | NEW | 3 | "self-signed cert", "private key", "csr" |
| `crowdstrike/aliases.yaml` | NEW | 3 | "falcon sensor", "falcon host group", "register aws account with falcon" |
| `mongodb-atlas/aliases.yaml` | NEW | 4 | "atlas cluster" + "M40/M30/M10 atlas" tier patterns |
| `cloudflare/aliases.yaml` | EXTEND | +2 (now 14 total) | "d1 database", "r2 bucket" — explicit phrasings (existing file already had `d1`/`r2` under "managed database"/"object storage") |

**Total new alias phrases authored: 14** (spec target: 12; the M-tier expansion adds 2 extras for M30/M10 alongside the M40 example).

### Companions (Fix 5)

| File | Status | Notes |
|---|---|---|
| `vault/companions.yaml` | EXTEND | Extended `vault_pki_secret_backend_root_cert` with 3 more PKI-chain companions; added new entry `vault_pki_secret_backend_role → [vault_mount, vault_pki_secret_backend_root_cert]` |
| `snowflake/companions.yaml` | EXTEND | Already had `snowflake_warehouse` chain — preserved; added new `snowflake_database → [snowflake_schema, snowflake_account_role]` |
| `cloudflare/companions.yaml` | EXTEND | `cloudflare_workers_script` already had route/kv/r2/d1; added reverse `cloudflare_d1_database → [cloudflare_workers_script]` |

---

## Resources dropped because missing from MANIFEST.json

| Provider | Resource requested | Reason |
|---|---|---|
| cloudflare | `cloudflare_workers_secret` | Not in `cloudflare/MANIFEST.json` (the manifest only lists `cloudflare_workers_*` of: cron_trigger, custom_domain, deployment, for_platforms_dispatch_namespace, kv, kv_namespace, route, script, script_subdomain). Dropped from the new `cloudflare_workers_script` companions extension; secret-handling resource appears not to exist in this provider version. |

### Naming-convention note (no drop, but worth flagging)

The task spec lists mongodb-atlas resources as `mongodbatlas_advanced_cluster` / `mongodbatlas_cluster` (upstream Terraform names). The bundle MANIFEST uses `mongodb-atlas_*` (hyphen retained) — consistent with the existing `mongodb-atlas/companions.yaml`. I authored aliases against the bundle's actual `mongodb-atlas_*` names so the validator passes. If the TS runtime maps queries to upstream names elsewhere, a reverse-mapping shim may be needed; no change required in this YAML layer.

---

## Validation exit codes

```
$ python3 scripts/build_aliases.py .
… 8 providers · 42 aliases written · 0 missing references warned
EXIT: 0

$ python3 scripts/build_companions.py .
… 12 providers · 35 entries merged · 2 missing references warned
   (the 2 warnings are pre-existing helm→k8s cross-provider references; not P2's edits)
EXIT: 0

$ python3 scripts/validate_manifest.py --all .
Result: 31 passed, 0 failed
EXIT: 0
```

YAML parse sanity-check (each file authored): all 8 files parsed cleanly with `python3 -c "import yaml; yaml.safe_load(open(...))"`.

---

## Inlined into MANIFEST.json — spot checks

`service_aliases` for the 5 bottom providers all populated correctly (atlas_cluster, atlas_m_tier, falcon_*, tls_*, local_file, plus existing+new cloudflare entries including new `d1` / `r2` mapped to the explicit phrasings).

`recommended_companions` confirmed inlined for:
- `vault_pki_secret_backend_root_cert` → 6 PKI-chain companions (full chain)
- `vault_pki_secret_backend_role` → [vault_mount, vault_pki_secret_backend_root_cert]
- `snowflake_warehouse` → 5 RBAC bootstrap companions
- `snowflake_database` → [snowflake_schema, snowflake_account_role]
- `cloudflare_workers_script` → [route, kv_namespace, r2_bucket, d1_database] (workers_secret dropped)
- `cloudflare_d1_database` → [cloudflare_workers_script]

---

## Quick before/after sanity check

Picked **mongodb-atlas** and **local** (2 of the bottom-5).

### mongodb-atlas — `python3 scripts/discover.py --query "atlas cluster" --provider mongodb-atlas --root .`

Top-2 results:
1. `mongodb-atlas/resources/cluster.md` (score 290.0, reasons: `exact_resource:mongodb-atlas_cluster`, subcategory_peer:Clusters, subcat_keyword:cluster→Clusters)
2. `mongodb-atlas/resources/advanced_cluster.md` (score 210.0, reasons: subcategory_peer:Clusters, subcat_keyword:cluster→Clusters, name_partial:mongodb-atlas_advanced_cluster)

Both target resources surface at top-2 — the new `atlas cluster` alias (resources `[mongodb-atlas_advanced_cluster, mongodb-atlas_cluster]`) reinforces this exactly. Note the Python `discover.py` reference impl appears not to walk the alias tier explicitly, but the alias data is correctly inlined into `service_aliases` in MANIFEST.json for the TS runtime to consume.

### local — `python3 scripts/discover.py --query "render template to disk" --provider local --root .`

The Python reference impl returns only `local/index.md` (low score 2.5 from `provider_index` reason), confirming the *known* upstream gap (E9 §Bottom 5 #1: token-stem mismatches + classifier exits early on the literal token "local"). The `service_aliases.local_file → [local_file, local_sensitive_file]` IS now inlined into MANIFEST.json, so as soon as P1's tokenizer/classifier work in `src/lib/discover/{tokenize,provider,aliases}.ts` lands the alias will fire.

### Provider classification (still upstream-blocked)

Without `--provider`, both queries return `status=error: Could not detect provider from query`. This is **expected and not a P2 regression** — it's exactly the root cause documented in §7 item #6 (provider classifier tiebreaker), which P1 owns. The data layer (this work) is complete; the classifier layer (P1) needs the tiebreaker rule to route "atlas cluster" → mongodb-atlas without an explicit hint.

---

## Cross-team status

- **P1 (discover.ts edits):** no overlap; my work is YAML-only under `terraform-providers/`. P1's tokenizer/classifier changes are the consumer of the new alias data.
- **P3 (SKILL.md):** no overlap.
- **P4 (package.json/README):** no overlap.
- **E3 baseline content:** EXTENDED (never replaced). Existing aliases.yaml/companions.yaml entries preserved verbatim; new entries appended after a `# P2 v0.1.1 — …` comment block.

---

## Time

- Estimated budget: 2 hours.
- Actual: ~30 minutes (small content surface, all validators clean on first run).

---

## Recommendation for P1

When the tokenizer stems plurals/-ing forms (per §7 item #3), the `atlas cluster` alias will fire on inputs like "Atlas clusters" / "atlas cluster setup". The alias resources resolve to bundle-local names (`mongodb-atlas_*`) — confirm the TS tier1-alias matcher reads the hyphenated form correctly (the Python validator does).
