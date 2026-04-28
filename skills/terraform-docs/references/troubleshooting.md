# Troubleshooting (v0.1)

When `vega tf` doesn't behave the way the SKILL.md body promises, work through these in order.

## First: run `vega doctor`

```bash
vega doctor          # human-readable
vega doctor --json   # machine-readable; emit and parse
```

Doctor checks (and the matching repair):

| Check | Fail symptom | Fix |
|---|---|---|
| Bundle present | `BundleMissing` | `vega install` |
| Bundle MANIFEST parseable | `ManifestMalformed` | `vega install --force` (re-extract); if persistent, file an issue with the doctor JSON |
| Per-provider MANIFESTs valid | `vega tf` returns warnings about missing manifests | `vega doctor --verify-bundle` for the full schema-validation pass |
| Bundle freshness | `BundleStale` warning (>14 days) | `vega update` (or `vega install` if no `update` yet) |
| Cosign signatures (v0.3+) | "could not verify shard signature" | `vega doctor --verify-attestations`; check Fulcio root pin |
| `ripgrep` available | Tier-2 falls back to `grep` (slower, still correct) | `brew install ripgrep` / `apt install ripgrep` |
| Disk write to `~/.config/vegastack/` | `EACCES` on install | Check perms; `chown` the dir to your user |

## Common failure modes

### "Could not detect provider from query"

Response code: `ProviderUndetectable`. The query has no canonical provider name, no service alias, and no English-word-provider corroborator.

**Fix:**
- Re-tokenize with the user. Ask which cloud / SaaS they're targeting.
- If you're confident, force the provider with `--provider <name>`.
- Check the alias for the phrase: `grep -r "<phrase>" ~/.config/vegastack/bundle/*/aliases.yaml`. If it should match but doesn't, the alias may be missing — file an issue.

### "Bundle not installed; run `vega install`"

Response code: `BundleMissing`. Doctor will say the same thing.

**Fix:**
- `vega install` (downloads the latest bundle to `~/.config/vegastack/bundle/`).
- If install fails behind a corporate proxy that strips Range headers: `VEGA_NO_RANGE=1 vega install`.
- If install fails on Windows long paths: enable long-path support in the Win10 group policy.

### "Provider <name> not in bundle/MANIFEST.json.providers"

Response code: `ProviderUnknown`. You forced a provider name that doesn't exist in the bundle.

**Fix:**
- `vega tf --json-schema` lists valid providers.
- Common typos: `mongodb_atlas` → `mongodb-atlas`; `redis_cloud` → `redis-cloud`; `1Password` → `1password`.

### `files[]` is empty but `status: "ok"`

Means the manifest scoring + grep fallback found nothing for the query in the detected provider's bundle.

**Fix:**
- Try `vega tf --debug` — `timings` and raw `score` fields show whether the pipeline ran every stage.
- Try `vega tf --raw` — confirms the issue isn't in the enrichment layer.
- Try a different phrasing or `--provider <name>` to force a different scope.
- If the user is asking about a resource you know exists but `files[]` doesn't show it, file an issue with `vega tf --debug "<query>"` output attached.

### `manifest_entry.required_args` looks too short or too long

In v0.1, top-level args are split from sub-block args (`manifest_entry.blocks.*.required_args`). If you remember a resource having more required args than the manifest shows, those args are likely inside one of the blocks. `jq '.resources.<name>.blocks | keys'` lists them.

If the manifest looks wrong (a top-level arg the docs say is required is missing), check `schema_origin`:

```bash
jq '.resources.aws_kms_key.schema_origin' "$VEGA_BUNDLE/aws/MANIFEST.json"
```

Plugin-Framework resources (`"plugin_framework"`) document arguments differently; if the doc-shape parser missed an arg it's a builder bug — file an issue with the resource name and provider.

### Knowledge card didn't fire when you expected it to

`knowledge[]` is empty but you know there's a relevant card.

**Fix:**
- Check the card's `triggers[]`: `cat ~/.config/vegastack/bundle/knowledge/<id>.md | head -30`.
- Triggers use AND-within, OR-across. If the user's tokens are `[s3, lock]` and the trigger is `{tokens: [s3, backend, lock]}`, the trigger doesn't fire (missing `backend`).
- `--debug` shows tokenized form: confirm what tokens the harness actually built.

### Recipe didn't fire when you expected it to

Same matching engine as knowledge cards plus a provider-overlap requirement: the recipe fires either if its triggers match OR if the query mentions ≥2 of its `providers[]` explicitly.

**Fix:**
- `cat ~/.config/vegastack/bundle/recipes/<id>.toml | head -10`.
- If you're querying for one provider only, recipes spanning that provider + others may not fire — surface them via `--provider <name>` with a query that names the other providers.

### Stale bundle warning

`warnings: ["bundle older than 14 days; run `vega update`"]`

**Fix:**
- `vega update` (in v0.2+; v0.1 uses `vega install` to refresh).
- If you can't update (airgap), the warning is informational — the bundle still works, it just may not have the latest knowledge cards.

### Performance regression

If `vega tf` suddenly takes >1 s warm:

- `vega tf --debug "<query>"` and check `timings.tier1_ms` / `timings.tier2_ms`. If `tier2_ms` dominates, ripgrep isn't on PATH and grep is being used; install ripgrep.
- If `enrich_ms` dominates, the bundle's per-provider MANIFESTs may be huge (post v0.4 multi-surface manifests); filter `--max 5`.
- If `tier1_ms` dominates with no obvious reason, file an issue with the bundle version and the query.

## When to escalate

- Bundle install consistently fails on a clean machine: file an issue with `vega doctor --json` output and the install log.
- A resource you know exists never appears in `files[]` for any reasonable query: file an issue with the resource name and three queries you tried.
- A knowledge card fires when it shouldn't (false positive): file an issue with the card ID and the query.
- The same query gives different `files[]` orderings on two consecutive runs: shouldn't happen — the harness is deterministic. File an issue with `--debug` output from both runs.

## Repository links

- CLI source / issues: <https://github.com/vegastack/vegastack-cli>
- Bundle source (provider docs + knowledge + recipes): <https://github.com/vegastack/engg-vegastack-agent-tf-providers>
- Eval dashboard: <https://evals.vegastack.com>
