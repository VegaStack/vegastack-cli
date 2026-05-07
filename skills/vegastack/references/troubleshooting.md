# Troubleshooting (v0.1)

When `vegastack ask`, `vegastack search`, or Terraform evidence doesn't behave the way the SKILL.md body promises, work through these in order.

## First: run `vegastack doctor`

```bash
vegastack doctor          # human-readable
vegastack doctor --json   # machine-readable; emit and parse
```

Doctor checks (and the matching repair):

| Check | Fail symptom | Fix |
|---|---|---|
| Registry pack present | `RegistryEntryMissing` | `vegastack init` or `vegastack registry update` |
| Registry MANIFEST parseable | `ManifestMalformed` | `vegastack registry update --force`; if persistent, file an issue with the doctor JSON |
| Per-provider MANIFESTs valid | `vegastack ask` returns warnings about missing manifests | `vegastack doctor --verify-registry` for the full schema-validation pass |
| Registry freshness | stale warning | `vegastack registry update` |
| `ripgrep` available | search is slow or managed install failed | `vegastack setup` or `vegastack update --yes --no-cli --no-registry` |
| Disk write to `~/.vegastack/` | `EACCES` on install | Check perms; `chown` the dir to your user |

## Common failure modes

### "Could not detect provider from query"

Response code: `ProviderUndetectable`. The query has no canonical provider name, no service alias, and no English-word-provider corroborator.

**Fix:**
- Re-tokenize with the user. Ask which cloud / SaaS they're targeting.
- If you're confident, force the provider with `vegastack ask --entry terraform --tf-provider <name> "<query>"`.
- Check the alias for the phrase in the installed Registry pack under `~/.vegastack/registry/terraform/`. If it should match but doesn't, the alias may be missing — file an issue.

### "Terraform Registry pack not installed"

Response code: `RegistryEntryMissing`. Doctor will say the same thing.

**Fix:**
- `vegastack init` or `vegastack registry update terraform`.
- If install fails, check `curl -fI https://cli-registry.vegastack.com/cli/REGISTRY.json`.
- If install fails on Windows long paths: enable long-path support in the Win10 group policy.

### "Provider <name> not in the Terraform Registry pack"

Response code: `ProviderUnknown`. You forced a provider name that doesn't exist in the Registry pack.

**Fix:**
- Run `vegastack doctor --verify-registry --json` to validate the installed Terraform pack.
- Check the provider directory names under `~/.vegastack/registry/terraform/docs/` when you need the exact local names.
- Common typos: `mongodb_atlas` → `mongodb-atlas`; `redis_cloud` → `redis-cloud`; `1Password` → `1password`.

### `files[]` is empty but `status: "ok"`

Means the manifest scoring + grep fallback found nothing for the query in the detected provider's Registry pack.

**Fix:**
- Try `vegastack ask --entry terraform --tf-provider <provider> --debug` — `timings` and raw `score` fields show whether the pipeline ran every stage.
- Try `vegastack ask --entry terraform --tf-provider <provider> --raw` — confirms the issue isn't in the enrichment layer.
- Try a different phrasing or `--tf-provider <name>` with `vegastack ask --entry terraform` to force a different scope.
- If the user is asking about a resource you know exists but `files[]` doesn't show it, file an issue with `vegastack ask --entry terraform --tf-provider <provider> --debug "<query>"` output attached.

### `manifest_entry.required_args` looks too short or too long

In v0.1, top-level args are split from sub-block args (`manifest_entry.blocks.*.required_args`). If you remember a resource having more required args than the manifest shows, those args are likely inside one of the blocks. `jq '.resources.<name>.blocks | keys'` lists them.

If the manifest looks wrong (a top-level arg the docs say is required is missing), check `schema_origin`:

```bash
jq '.resources.aws_kms_key.schema_origin' "~/.vegastack/registry/terraform/docs/aws/MANIFEST.json"
```

Plugin-Framework resources (`"plugin_framework"`) document arguments differently; if the doc-shape parser missed an arg it's a builder bug — file an issue with the resource name and provider.

### Knowledge card didn't fire when you expected it to

`knowledge[]` is empty but you know there's a relevant card.

**Fix:**
- Check the matching card in `~/.vegastack/registry/terraform/index/knowledge.json`.
- Triggers use AND-within, OR-across. If the user's tokens are `[s3, lock]` and the trigger is `{tokens: [s3, backend, lock]}`, the trigger doesn't fire (missing `backend`).
- `--debug` shows tokenized form: confirm what tokens the harness actually built.

### Recipe didn't fire when you expected it to

Same matching engine as knowledge cards plus a provider-overlap requirement: the recipe fires either if its triggers match OR if the query mentions ≥2 of its `providers[]` explicitly.

**Fix:**
- Check `~/.vegastack/registry/terraform/index/` and the Terraform pack docs for the recipe/citation.
- If you're querying for one provider only, recipes spanning that provider + others may not fire — surface them via `--tf-provider <name>` with a query that names the other providers.

### Stale Registry warning

`warnings: ["Registry pack older than expected; run vegastack registry update"]`

**Fix:**
- `vegastack registry update --force` or `vegastack init --yes`.
- If you can't update (airgap), the warning is informational — the installed Registry pack still works, it just may not have the latest knowledge cards.

### Performance regression

If `vegastack ask` suddenly takes >1 s warm:

- `vegastack ask --entry terraform --tf-provider <provider> --debug "<query>"` and check `timings.tier1_ms` / `timings.tier2_ms`. If search is slow, run `vegastack setup` or `vegastack update --yes --no-cli --no-registry` to install the managed ripgrep binary.
- If `enrich_ms` dominates, the Registry pack's per-provider MANIFESTs may be huge (post v0.4 multi-surface manifests); filter `--max 5`.
- If `tier1_ms` dominates with no obvious reason, file an issue with the Registry pack version and the query.

## When to escalate

- Registry pack install consistently fails on a clean machine: file an issue with `vegastack doctor --json` output and the install log.
- A resource you know exists never appears in `files[]` for any reasonable query: file an issue with the resource name and three queries you tried.
- A knowledge card fires when it shouldn't (false positive): file an issue with the card ID and the query.
- The same query gives different `files[]` orderings on two consecutive runs: shouldn't happen — the harness is deterministic. File an issue with `--debug` output from both runs.

## Repository links

- CLI source / issues: <https://github.com/vegastack/vegastack-cli>
- Registry source (packs, docs, indexes, aliases, dependencies, knowledge): <https://github.com/vegastack/vegastack-cli-registry>
- Eval dashboard: <https://cli-evals.vegastack.com>
