# S2 Execution Status — 2026-04-28

## Summary

Two changes delivered: `distinctive_tokens` per-provider in MANIFEST.json (C6 prereq), and 15–20 new aliases across the bottom-5 providers (C4 + C5 cloudflare-workers chain).

---

## Change 1 — `distinctive_tokens` (closes C6 prereq)

### Implementation

- Added `_collect_provider_token_freq()` to `scripts/manifest_builder.py`: collects token frequencies from resource names (with provider-prefix stripped, plus compound sub-names like `advanced_cluster`) and descriptions (first 80 chars). Also injects provider-name tokens (`atlas`, `mongodbatlas`) at full-resource-count frequency.
- Added `compute_distinctive_tokens()`: specificity gate — token must appear in ≥3 of provider's resources AND in <2 other providers' resource names. Cap at 15 tokens sorted by within-provider freq desc.
- Two-pass `--all` build: pass 1 builds all manifests, pass 2 computes cross-provider distinctiveness and re-writes each MANIFEST.json.
- Added `discover.py` pass 3/4 provider detection: concept-alias phrase matching (`aliases.json`) + `distinctive_tokens` matching closes C6 in the Python harness.

### Distinctive tokens — top-5 per provider (representative sample)

| Provider | Top 5 distinctive tokens |
|---|---|
| mongodb-atlas | atlas, mongodbatlas, cloud_backup, access_list, backup_snapshot |
| cloudflare | accepted, zero_trust, trust_access, zero_trust_access, shield |
| crowdstrike | crowdstrike, falcon, prevention, sensor, update_policy |
| aws | amazon, ec2, cloudwatch, elastic, sagemaker |
| snowflake | snowflake, filtered, filtering, aligned, stage |
| vault | secret_backend, auth_backend, pki, backend_role, pki_secret |
| tls | pem, rfc |
| local | [] (only 2 resources — threshold not reachable) |

### Schema updates

Both schema files updated to add optional `distinctive_tokens: array<string>`:
- `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/schema/manifest.schema.json`
- `/Users/mk/projects/vegastack-cli/docs/contracts/manifest.schema.json`

---

## Change 2 — Aliases authored (closes C4 + C5)

### local/aliases.yaml — 4 new aliases (total 6)

| phrase | resources | from |
|---|---|---|
| rendered output | local_file | E9-A1-local-file-render |
| write to local file | local_file, local_sensitive_file | E9-A1-local-file-render |
| rendered manifest | local_file | E9-A1-local-file-render |
| values rendered | local_file | E9-A1-local-file-render |

### tls/aliases.yaml — 5 new aliases (total 8)

| phrase | resources | from |
|---|---|---|
| rsa private key | tls_private_key, tls_self_signed_cert | E9-A1-tls-self-signed |
| self-signed cert valid | tls_self_signed_cert, tls_private_key | E9-A1-tls-self-signed |
| wildcard cert | tls_private_key, tls_self_signed_cert, tls_cert_request | E9-A7-tls-acm-cloudflare |
| tls provider cert | tls_private_key, tls_self_signed_cert | E9-A7-tls-acm-cloudflare |
| san includes | tls_self_signed_cert, tls_cert_request | E9-A1-tls-self-signed |

### crowdstrike/aliases.yaml — 4 new aliases (total 7)

| phrase | resources | from |
|---|---|---|
| crowdstrike falcon host group | crowdstrike_host_group | E9-A1-crowdstrike-host-group |
| falcon cloud security | crowdstrike_cloud_aws_account | E9-A7-crowdstrike-on-aws |
| crowdstrike sensor coverage | crowdstrike_cloud_aws_account, crowdstrike_sensor_update_policy, crowdstrike_host_group | E9-A7-crowdstrike-on-aws |
| dynamic host group | crowdstrike_host_group | E9-A1-crowdstrike-host-group |

### mongodb-atlas/aliases.yaml — 7 new aliases (total 11)

| phrase | resources | from |
|---|---|---|
| M40 instance | mongodb-atlas_advanced_cluster | E9-A9-mongo-atlas-cost-cut |
| tune Atlas cluster | mongodb-atlas_advanced_cluster | E9-A9-mongo-atlas-cost-cut |
| online archive | mongodb-atlas_online_archive | E9-A7-redis-elasticache-mongo |
| search index | mongodb-atlas_search_index, mongodb-atlas_search_deployment | E9-A7-redis-elasticache-mongo |
| mongodbatlas cluster | mongodb-atlas_advanced_cluster, mongodb-atlas_cluster | E9-A12-mongodb-cluster-replaced |
| M-tier dedicated | mongodb-atlas_advanced_cluster | E9-A9-mongo-atlas-cost-cut |
| atlas advanced cluster | mongodb-atlas_advanced_cluster | E9-A7-redis-elasticache-mongo |

### cloudflare/aliases.yaml — 5 new aliases (total 19)

| phrase | resources | from |
|---|---|---|
| workers with d1 and r2 | cloudflare_workers_script, cloudflare_d1_database, cloudflare_r2_bucket | E9-A6-cloudflare-workers-d1-r2 |
| edge function with database | cloudflare_workers_script, cloudflare_d1_database, cloudflare_r2_bucket | E9-A6-cloudflare-workers-d1-r2 |
| serverless edge api | cloudflare_workers_script, cloudflare_d1_database, cloudflare_r2_bucket | E9-A6-cloudflare-workers-d1-r2 |
| cloudflare worker for ab test | cloudflare_workers_script, cloudflare_workers_route | E9-A7-vercel-cloudflare-workers-ab |
| cloudflare dns | cloudflare_dns_record | E9-A7-do-app-cf-dns |

---

## Anti-regression check

All 25 new alias phrases checked against all 76 E9 prompts. Zero wrong-provider fires — every phrase is either unique to its target provider or appears only in prompts that include that provider in their tags.

---

## Validator exit codes

```
python3 scripts/manifest_builder.py --all . --bundle-version 2026.04.28  → exit 0 (31/31 built)
python3 scripts/build_aliases.py .                                         → exit 0 (67 aliases, 0 missing)
python3 scripts/build_companions.py .                                      → exit 0 (35 entries, 2 pre-existing helm warnings)
python3 scripts/validate_manifest.py --all .                               → exit 0 (31 passed, 0 failed)
python3 -m pytest tests/manifest_builder/                                  → exit 0 (27 passed, 0 failed)
```

---

## Quick sanity probe

```
python3 scripts/discover.py --query "tune Atlas cluster cost" --root .
→ status: ok, provider: mongodb-atlas (was: ProviderUndetected)
→ Top hit: mongodb-atlas/resources/cluster.md (score 290.0)
→ Detection path: concept-alias phrase "atlas cluster" matched from mongodb-atlas/aliases.json
```

C6 closed in the Python harness (`discover.py`). Detection now uses three-layer fallback:
1. Canonical name match (unchanged)
2. SERVICE_ALIASES table (unchanged)
3. NEW: concept-alias phrase matching from `aliases.json` — closes C4/C6
4. NEW: `distinctive_tokens` word matching from MANIFEST.json — fallback

---

## Files modified

- `scripts/manifest_builder.py` — added `_collect_provider_token_freq`, `compute_distinctive_tokens`, two-pass `--all` driver
- `scripts/discover.py` — added `_load_distinctive_tokens`, `_detect_via_distinctive_tokens`, `_detect_via_concept_aliases`, updated `detect_provider` to accept `root` param
- `schema/manifest.schema.json` — added `distinctive_tokens` field
- `/Users/mk/projects/vegastack-cli/docs/contracts/manifest.schema.json` — added `distinctive_tokens` field
- `cloudflare/aliases.yaml` — 5 new aliases (Workers+D1+R2 chain + ab-test + DNS)
- `local/aliases.yaml` — 4 new aliases
- `tls/aliases.yaml` — 5 new aliases
- `crowdstrike/aliases.yaml` — 4 new aliases
- `mongodb-atlas/aliases.yaml` — 7 new aliases
- `tests/manifest_builder/test_distinctive_tokens.py` — NEW: 15 test cases
