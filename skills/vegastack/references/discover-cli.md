# `vegastack tf` CLI reference (v0.1)

This is the full reference for the single CLI command the SKILL.md body invokes. Load it when the user wants flag-level detail (e.g. `--max`, `--debug`, `--raw`, `--json-schema`), or when you need the exhaustive scoring stages and ambiguity-handling contract. For the dispatch decision tree and 4-channel envelope summary, read the SKILL.md body — this file is the deeper layer of progressive disclosure.

`vegastack tf` is the deterministic discovery harness shipped in `@vegastack/cli`. It auto-resolves the docs bundle (`~/.config/vegastack/bundle/`), auto-detects the provider, runs an 11-stage manifest scoring pass plus a parallel grep fallback, enriches each top-K hit with `manifest_entry` + `example_usage` inline, and emits a single JSON envelope on stdout.

## Synopsis

```
vegastack tf "<query>" [--provider <name>] [--max <N>] [--raw] [--debug]
                  [--json-schema] [--bundle <path>]
```

| Flag | Default | Notes |
|---|---|---|
| `<query>` (positional) | — | **Required.** Free-text natural-language description of the user's intent. |
| `--provider <name>` | auto-detect | Force the provider scope. Skips the ambiguity check. Must be one of the providers in `bundle/MANIFEST.json.providers`. |
| `--max <N>` | `10` | Cap on `files[]` length. Use `--max 5` for tight context, `--max 20` for surveys. |
| `--raw` | off | Disables enrichment: omits `manifest_entry`, `example_usage`, and the four side-channel arrays. Use only when you specifically need the raw scoring output. |
| `--brief` | off | E1: Strips `manifest_entry` and `example_usage` from each `files[]` entry, adds a `name` field (resource name, e.g. `"aws_s3_bucket"`), and sets `mode: "brief"` in the envelope. Envelope is typically ~80% smaller than default. Use for survey / multi-call dispatch where you only need to know which resources exist. Backward-compatible: default behavior is unchanged. |
| `--full-examples` | off | E2: Restores the full `## Example Usage` section (pre-truncation behavior). Default (no flag) truncates `example_usage` to the first HCL fenced block plus a `... (truncated; pass --full-examples for the rest)` marker. NOTE: the default truncation is a soft-breaking change for callers that relied on the full example body. |
| `--debug` | off | Includes `timings: {…}` and the raw `score` fields in `files[]`. Power-user diagnostic; default UIs should ignore `score` and use `score_norm`. |
| `--json-schema` | off | Prints the JSON schema of the response envelope and exits. Useful for tooling. |
| `--bundle <path>` | from `$VEGASTACK_BUNDLE_DIR` then `~/.config/vegastack/bundle/` | Override the bundle directory. Mostly for tests. |

## Output schema (v0.1)

The full TypeScript types live at `src/lib/discover/types.ts` (sourced from `/tmp/synthesis/contracts/discover-types.ts`) and the wire schema at `bundle/schema/manifest.schema.json`. Here's the envelope summary:

```json
{
  "status": "ok" | "ambiguous" | "error",
  "query": "...",
  "provider": "aws",
  "provider_confidence": 0.92,
  "tokens": ["s3", "bucket", "versioning"],
  "tiers_used": ["manifest", "knowledge"],
  "schema_version": 1,
  "bundle_version": "2026.04.28",
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
  "hint": "Use --provider <name> to disambiguate."
}
```

Two options: ask the user which provider they meant, or call `vegastack tf --provider <name>` once per candidate.

### Error response

```json
{
  "status": "error",
  "query": "...",
  "error": "Bundle not installed; run `vegastack install`.",
  "code": "BundleMissing"
}
```

`code` is machine-readable. The codes:

| `code` | Meaning |
|---|---|
| `BundleMissing` | `~/.config/vegastack/bundle/` doesn't exist or is empty. User should `vegastack install`. |
| `BundleStale` | Bundle exists but the MANIFEST is older than 14 days. Soft-warning version emits as `warnings[]` in an `ok` response; hard-error version is rare. |
| `ProviderUnknown` | `--provider <name>` was given but `<name>` isn't in `bundle/MANIFEST.json.providers`. |
| `ProviderUndetectable` | No `--provider` and the query has no detectable provider signal. Re-tokenize with the user. |
| `ManifestMalformed` | A per-provider MANIFEST.json failed schema validation. Run `vegastack doctor --verify-bundle`. |

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

The harness expands certain tokens automatically before scoring (canonical + space-split forms are kept; aliases are folded in via `bundle/<provider>/aliases.yaml`):

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
| `VEGASTACK_BUNDLE_DIR` | Override `~/.config/vegastack/bundle/` |
| `VEGASTACK_BUNDLE` | Set by `vegastack tf` for child processes — points at the active bundle dir |
| `VEGASTACK_OFFLINE` | Disables any network call (no bundle refresh checks) |
| `VEGASTACK_NO_UPDATE_NOTIFIER` | Suppresses "new CLI version" nag (also `NO_UPDATE_NOTIFIER`, `CI`, `DO_NOT_TRACK`) |
| `VEGASTACK_NO_RANGE` | Disables HTTP Range requests (corporate proxies that strip them) |

## When the harness or a manifest is missing

If a per-provider `MANIFEST.json` is missing or unparseable, `vegastack tf` skips Tier 1 silently and runs Tier 2 only. The response includes `warnings: ["manifest unavailable for <provider>; using grep fallback"]`. Run `vegastack doctor --verify-bundle` to diagnose.
