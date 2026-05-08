# `vegastack ask --agent --pack terraform --tf-provider <provider>` CLI reference

This is the full reference for the Terraform-specific Registry engine. Load it when the user wants flag-level detail (e.g. `--max`, `--debug`, `--raw`), or when you need the exhaustive scoring stages and ambiguity-handling contract. For general cloudops / CI / Docker / Kubernetes / Jenkins / Supabase questions, prefer `vegastack ask --agent`.

`vegastack ask --agent --pack terraform --tf-provider <provider>` is the deterministic Terraform discovery harness shipped in `@vegastack/cli`. It resolves the installed Terraform Registry pack under `~/.vegastack/registry/terraform/`, auto-detects the provider, runs an 11-stage manifest scoring pass plus a parallel grep fallback, enriches each top-K hit with `manifest_entry` + `example_usage` inline, and emits a single structured envelope on stdout.

## Synopsis

```
vegastack ask --agent --pack terraform --tf-provider <provider> "<query>" [--max <N>] [--raw] [--debug]
```

| Flag | Default | Notes |
|---|---|---|
| `<query>` (positional) | — | **Required.** Free-text natural-language description of the user's intent. |
| `--tf-provider <name>` | auto-detect | Public CLI flag for forcing the Terraform provider scope. Must be one of the providers in the Terraform Registry pack root `MANIFEST.json`. |
| `--max <N>` | `10` | Cap on `files[]` length. Use `--max 5` for tight context, `--max 20` for surveys. |
| `--raw` | off | Disables enrichment: omits `manifest_entry`, `example_usage`, and the four side-channel arrays. Use only when you specifically need the raw scoring output. |
| `--brief` | off | Strips `manifest_entry` and `example_usage` from each `files[]` entry, adds a `name` field (resource name, e.g. `"aws_s3_bucket"`), and sets `mode: "brief"` in the envelope. Envelope is typically ~80% smaller than default. Use for survey / multi-call dispatch where you only need to know which resources exist. |
| `--full-examples` | off | Restores the full `## Example Usage` section. Default output truncates `example_usage` to the first HCL fenced block plus a `... (truncated; pass --full-examples for the rest)` marker. |
| `--debug` | off | Includes `timings: {…}` and the raw `score` fields in `files[]`. Power-user diagnostic; default UIs should ignore `score` and use `score_norm`. |

## Output schema (v0.1)

The full TypeScript types live at `src/lib/discover/types.ts`. Here's the envelope summary:

```json
{
  "status": "ok" | "ambiguous" | "error",
  "query": "...",
  "provider": "aws",
  "provider_confidence": 0.92,
  "tokens": ["s3", "bucket", "versioning"],
  "tiers_used": ["manifest", "knowledge"],
  "schema_version": 1,
  "registry_version": "2026.04.28",
  "files": [
    {
      "path": "/abs/path/to/aws/r/s3_bucket.html.markdown",
      "score": 360.0,
      "score_norm": 92,
      "tier": "manifest" | "grep" | "manifest+grep",
      "reasons": ["primary_resource:aws_s3_bucket", "subcat_keyword:s3"],
      "manifest_entry": { ... },
      "example_usage": "..."
    }
  ],
  "knowledge": [...],
  "recipes": [...],
  "concept_aliases_used": [...],
  "citations": [...],
  "count": 2,
  "intents": [...],
  "warnings": []
}
```

Side-channel arrays (`knowledge`, `recipes`, `concept_aliases_used`) are always present in `status: "ok"` responses but may be empty `[]`. Treat absence-as-empty rather than absence-as-error.

### Ambiguous response

```json
{
  "status": "ambiguous",
  "query": "...",
  "tokens": [...],
  "candidate_providers": [{"provider": "aws", "score": 0.6}, {"provider": "azure", "score": 0.55}],
  "recipes": [...],
  "hint": "Use --tf-provider <name> with `vegastack ask --agent --pack terraform` to disambiguate."
}
```

Two options: ask the user which provider they meant, or call `vegastack ask --agent --pack terraform --tf-provider <name>` once per candidate.

### Error response

```json
{
  "status": "error",
  "query": "...",
  "error": "Terraform Registry pack not installed; run `vegastack init` or `vegastack registry install terraform`.",
  "code": "RegistryEntryMissing"
}
```

`code` is agent-readable. The codes:

| `code` | Meaning |
|---|---|
| `RegistryEntryMissing` | `~/.vegastack/registry/terraform/` doesn't exist or is empty. User should run `vegastack init`, `vegastack registry install terraform`, or `vegastack registry update terraform`. |
| `RegistryVersionMismatch` | Installed Registry metadata is not compatible with this CLI. Run `vegastack registry update --force`. |
| `ProviderUnknown` | `--tf-provider <name>` was given but `<name>` isn't in the Terraform Registry pack root `MANIFEST.json.providers`. |
| `ProviderUndetectable` | No provider could be detected and no `--tf-provider` was provided. Re-tokenize with the user. |
| `ManifestMalformed` | A per-provider MANIFEST.json failed schema validation. Run `vegastack doctor --verify-registry`. |

## Tier-1 manifest stages (in order)

The harness applies these stages against the per-provider `MANIFEST.json` until enough high-confidence results are collected. Each stage adds score; stages don't replace earlier matches.

| Stage | Match | Score |
|---|---|---|
| 1a | Exact resource / data-source name | +100 / +90 (×1.5 canonical multiplier when `primary_resources[token]` matches) |
| 1a' | Subcategory peers of an exact match (also fires on primary-resource hits in v0.1) | +25 |
| 1a'' | HCL reference graph expansion (companions in upstream examples) | +30 |
| 1b | `subcat_keywords` (e.g. "alb"→"ELB"); `primary_resources` boost | +70 / +100 |
| 1c | Synthetic subcategories (filename-prefix grouping) | +65 |
| 1d | Subcategory substring match | +40 |
| 1e | Partial resource-name component | +35 |
| 1f | Argument / attribute reverse index (`description_token_index`) | +40 |
| 1g | Example-token index (HCL code-block tokens) | +20 |
| 1h | Description substring | +15 |
| 1i | Guides with intent tags (migrate, upgrade) | +45 |
| 1j | Bigram typo fallback (≥70% overlap) | +25 |
| 1k | Provider index page | +5 |
| 1l | `recommended_companions` expansion (uses pre-built `Map<file,resource>` from enrich) | +20 |

Path weighting then scales: `r/`/`resources/` ×1.0, `d/`/`data-sources/` ×0.8, `index.*` ×0.5, `guides/` ×0.3, `functions/` ×0.2.

`score_norm = score / theoretical_max_for_provider * 100`. The quality gate fires Tier-2 unless `top1.score_norm ≥ 50 && top3_avg ≥ 30`. Tie-break: when scores are equal, shorter resource name wins (so `cloudflare_dns_record` beats `cloudflare_zone_dns_settings`).

## Tier-2 grep fallback (parallel)

Runs **in parallel** with Tier 1 (not as a fallback) and is merged with the quality gate. Four passes per provider directory:

1. Exact resource-name grep across markdown bodies.
2. Filename glob match.
3. Multi-token alternation regex.
4. Phrase grep on the raw query.

Uses `rg --json -l` if `ripgrep` is on PATH; otherwise `grep -rlE`. Each invocation is hard-capped at 10 seconds. The "is ripgrep available" check is cached by hashed PATH.

## Token expansions and aliases

The harness expands certain tokens automatically before scoring (canonical + space-split forms are kept; aliases are folded in from Registry-generated pack indexes):

| Input | Expanded to |
|---|---|
| `eip` | `eip`, `elastic_ip` |
| `asg` | `autoscaling_group` |
| `alb`, `nlb` | `alb`, `lb`, `load_balancer` |
| `gke` (in GCP scope) | `container_cluster`, `container_node_pool` |
| `aks` (in Azure scope) | `kubernetes_cluster` |
| `k8s` | (forces provider scope to `kubernetes`) |

Provider-scoped expansions also exist (e.g. Auth0 maps `app` → `client`).

## Provider detection (confidence model)

`detectProvider()` returns `{provider, score, via}`:

- canonical name in query → `1.0`
- substring match (e.g. "amazon", "aws ec2") → `0.9`
- service alias from `service_aliases` (e.g. "rds" → aws) → `0.6`
- English-word providers (`time`, `local`, `random`, `external`, `helm`) capped at `0.2` unless a 2-token corroborator fires (`time_static`, `random_id`, `helm chart`).

If `best − second_best < 0.2` the response is `status: "ambiguous"`. Otherwise the winner is used.

## Environment variables

| Var | Purpose |
|---|---|
| `VEGASTACK_REGISTRY_DIR` | Override the local Registry pack cache. Useful for local development against `vegastack-cli-registry/cli/packs`. |
| `VEGASTACK_REGISTRY_URL` | Override the published Registry base URL. Defaults to `https://cli-registry.vegastack.com/cli`. |
| `VEGASTACK_OFFLINE` | Disables network-dependent checks where supported. |
| `VEGASTACK_NO_UPDATE_NOTIFIER` | Suppresses "new CLI version" nag (also `NO_UPDATE_NOTIFIER`, `CI`, `DO_NOT_TRACK`) |

## When the harness or a manifest is missing

If a per-provider `MANIFEST.json` is missing or unparseable, `vegastack ask --agent --pack terraform --tf-provider <provider>` skips Tier 1 silently and runs Tier 2 only. The response includes `warnings: ["manifest unavailable for <provider>; using grep fallback"]`. Run `vegastack doctor --verify-registry --agent` to diagnose.
