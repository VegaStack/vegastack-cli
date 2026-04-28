# A4 — Phase-4 code-review STATUS

**Reviewer:** A4 (independent diff review)
**Date:** 2026-04-28
**Time spent:** ~75 min wall-clock
**Build/lint/test snapshot at audit time:**
- CLI repo: `npm run lint` exit 0, `npm run typecheck` exit 0, `npm test` 308/308 pass.
- `apps/mcp/`: `npm run build` exit 0, `npm test` 19/19 pass.
- `apps/dashboard/`: `npm run build` exit 0, `npm test` 9/9 pass.
- Bundle repo: `python3 -m pytest tests/manifest_builder/` 12/12 pass; `python3 scripts/validate_manifest.py --all .` 31/31 PASS.

---

## 1. Per-team verdicts

| Team | Verdict | Headline |
|---|---|---|
| **E1** | APPROVE-WITH-NITS | top-level `primary_resources` + `subcat_keywords` not yet emitted (E1↔E2 gap, see §2). Per-resource fields all correct. 12/12 tests pass. |
| **E2** | APPROVE | clean lint + typecheck, all 308 tests pass, defensive coding for missing manifest fields works end-to-end. |
| **E3** | APPROVE | 16 cards / 10 recipes / 28 aliases all parseable; 221 cross-references against MANIFEST.json validate. |
| **E4** | APPROVE-WITH-NITS | actionlint + tag-release tests clean. R2 bucket-name divergence with E7+E8 is configuration, not E4 code. |
| **E5** | APPROVE-WITH-NITS | (a) `src/commands/skills.ts:3` still consumes legacy `ALL_AGENT_NAMES` instead of new `ALL_RENDERERS` — punch-list #3 unresolved. (b) MCP-URL defaults to `/sse` — punch-list #2. |
| **E6** | REQUEST-CHANGES | runner emits a report shape that does NOT match E8's `EvalReport` interface — `parseReport()` returns `null` for every real run (see §4). |
| **E7** | REQUEST-CHANGES | `^[a-z][a-z0-9-]*$` provider regex in 3 files rejects `1password` (the same bug E1 fixed in the schema). Type-mirror file should re-export from E2 once package is published. |
| **E8** | REQUEST-CHANGES | (a) report-shape drift with E6 (see §4); (b) silent fixture fallback when R2 returns malformed JSON (no warning surfaced to UI). |

---

## 2. E1↔E2 manifest gap (punch-list #4) — RECOMMENDATION

**Confirmed:** `aws/MANIFEST.json` top-level keys after E1's run:
```
argument_index, attribute_index, bundle_version, data_sources, description_token_index,
example_tokens, generic_args_downweight, guides, hcl_references, manifest_schema_version,
provider, resource_bigrams, resources, subcategories, subcategory_useful, synced_at,
synthetic_subcategories
```
Missing: `primary_resources`, `subcat_keywords`, `service_aliases` (only on the 4 providers with `aliases.yaml`).

E2 codes defensively (`tier1.ts:58-59` does `?? {}`), so the discover pipeline does not crash — but tier1 stages `subcat_keyword`, `primary_resource`, `subcategory_peer (via primary_resources)` go silent for 27 of 31 providers. Tests pass because the `tests/fixtures/bundle-mini/` fixture has these fields hand-written.

### Recommendation: **(a) — extend E1's builder. Single source of truth.**

**Trade-off:** option (b) would keep ~80 lines in `src/lib/discover/constants.ts` for SUBCAT_KEYWORDS and PRIMARY_RESOURCES. Maintainable for a few providers (cloudflare, aws), but the canonical bundle has 31 providers and the harness can't generate per-provider hints from CLI-side static tables. Option (a) lets every per-provider quirk live next to the docs that motivate it.

### Patch outline for option (a)

**File:** `terraform-providers/scripts/manifest_builder.py`

1. Add a new helper next to `build_description_token_index` (~line 530):

```python
def build_primary_resources(provider: str, resources: dict) -> dict[str, str]:
    """token -> canonical resource name. Heuristic: if a resource's bare
    suffix (post `<provider>_`) is a single short token, map that token to it.
    Allow per-provider overrides via <provider>/primary_resources.yaml."""
    out: dict[str, str] = {}
    for name in resources:
        if not name.startswith(provider + "_"):
            continue
        suffix = name[len(provider) + 1:]
        if "_" not in suffix and 2 <= len(suffix) <= 16:
            out.setdefault(suffix, name)
    return out


def build_subcat_keywords(resources: dict) -> dict[str, str]:
    """keyword -> subcategory hint. Derive from each resource's subcategory:
    take the first significant word, lowercased."""
    out: dict[str, str] = {}
    for entry in resources.values():
        sub = (entry.get("subcategory") or "").strip()
        if not sub:
            continue
        # First significant word.
        for tok in re.split(r'[^a-zA-Z0-9]+', sub):
            if tok and tok.lower() not in _STOPWORDS and len(tok) >= 3:
                out.setdefault(tok.lower(), sub)
                break
    return out
```

2. In `build_manifest()` return dict (~line 668), add:

```python
"primary_resources":  build_primary_resources(provider, resources),
"subcat_keywords":    build_subcat_keywords({**resources, **data_sources}),
```

3. Optional: support a per-provider override file `<provider>/primary_resources.yaml` and merge it last so curators can correct heuristic misses. Mirror E1's existing `aliases.yaml` / `companions.yaml` pattern.

4. Update `scripts/validate_manifest.py` — schema already allows both fields (`manifest.schema.json:85-94`), no change needed.

5. Re-run `python3 scripts/manifest_builder.py --all .` (see E1 STATUS for runtime — ~1s for 31 providers).

6. Drop `tests/fixtures/bundle-mini/` hand-written `primary_resources` once E2's tests run against real manifests. Until then, the fixture stays in sync because E2's tier1 ?? {} pattern never threw.

**Estimated effort:** 30 min in E1's repo. Re-runs everything. No CLI-side change required.

---

## 3. Pre-existing failures (punch-list #5) — STATUS

`npm test -- tests/agents/cursor.test.ts tests/agents/gemini.test.ts tests/integration/install-security.test.ts`:
```
Test Files  3 passed (3)
Tests       23 passed (23)
```

All 5 previously-failing tests are now green. E2's `proper-lockfile` migration unblocked `install-security`; E5's renderer wrappers preserved the legacy installer surface so the `cursor.test.ts` + `gemini.test.ts` assertions pass unchanged. **No further work needed.**

---

## 4. Cross-team type-safety findings

### a) E6 → E8 report-shape DRIFT (BLOCKER)

`evals/runner.ts:319-327` emits:
```json
{ "generated_at", "model", "mode", "eval_count",
  "summary": { "baseline_pct", "with_skill_pct", "lift_pct", "per_archetype": {...} },
  "baseline": [...], "with_skill": [...] }
```
Confirmed by `evals/reports/demo-baseline-vs-skill.json:1-27`.

`apps/dashboard/src/lib/parse-report.ts:136-142` requires:
```
typeof r.date === "string" && typeof r.lift === "number"
&& Array.isArray(r.prompts) && Array.isArray(r.archetypes)
```
Confirmed by `apps/dashboard/src/fixtures/sample-report.json:1-12` shape: `{schema_version, date, bundle_version, cli_version, lift, baseline_pass_rate, with_skill_pass_rate, archetypes:[], knowledge_cards:[], recipes:[], prompts:[], duration_s}`.

`parseReport(realReport)` will return `null` because the runner emits `generated_at` (not `date`), `summary.lift_pct` (not `lift`), `baseline[]` + `with_skill[]` (not `prompts[]` + `archetypes[]`). The dashboard will fall through to `fallbackReport()` — every visitor sees the bundled fixture. Headline lift becomes meaningless.

**Fix path:** assign owner E6 (single source of truth lives in dashboard's `EvalReport`). `runner.ts:writeReport()` should:
- emit `date` (today YYYY-MM-DD), `lift` (= `summary.lift_pct`), `baseline_pass_rate`, `with_skill_pass_rate`, `prompt_count`, `bundle_version` (from $VEGA_BUNDLE/MANIFEST.json), `cli_version` (from package.json).
- transform per-prompt rows into `prompts[]` matching `PromptResult`.
- aggregate into `archetypes[]: ArchetypeRollup[]`.
- compute `knowledge_cards[]` + `recipes[]` hit-rate rollups from the per-prompt scoring side-data already in `score.ts`.
- import the types from `apps/dashboard/src/lib/parse-report.ts` (or extract to `src/lib/eval-types.ts`).

### b) E2 → E6 / E7 / E8 envelope types

E6's `evals/runner.ts:49` does:
```ts
import type { KnowledgeCard, RecipeMatch, ManifestResourceEntry } from "../src/lib/discover/types.js";
```
Correct — single source from `src/lib/discover/types.ts` (which is E2's verbatim copy of `docs/contracts/discover-types.ts`). No drift.

E7's `apps/mcp/src/lib/types.ts` is a HAND-MIRRORED COPY of `docs/contracts/discover-types.ts` (the file says so in its top comment). Spot-diff: shape is identical; the only addition is a worker-local `ProviderManifest` + `BundleRootManifest`. **Maintainability smell** — once `@vegastack/cli` ships to npm, this should re-export from `@vegastack/cli/types`. For v0.1 (not yet published) the mirror is acceptable IF a `// CLEANUP-AFTER-FIRST-PUBLISH` marker is added.

E8's `apps/dashboard/src/lib/parse-report.ts` defines its OWN `EvalReport` / `PromptResult` / `ArchetypeRollup` types. These are NOT in `discover-types.ts` (which is the discover envelope, not the eval-report envelope). **Recommend:** lift these types into `docs/contracts/eval-report.ts` so E6's runner can import them. Right now there is no contract file for this shape — that's what enabled drift (a) to ship.

### c) Provider regex bug across MCP

3 files use `^[a-z][a-z0-9-]*$` which rejects `1password`:
- `apps/mcp/src/lib/r2-bundle.ts:115`
- `apps/mcp/src/tools/tf_discover.ts:22`
- `apps/mcp/src/tools/tf_get_manifest.ts:14`

E1 fixed this in `manifest.schema.json:18-19` (`^[a-z0-9][a-z0-9-]*$`) and called it out in `E1/contract-issue.md`. E7 missed the contract update. CLI side does not have this bug (uses `escapeRegExp(provider)`, not a name regex).

**Fix:** s/`^[a-z][a-z0-9-]*$`/`^[a-z0-9][a-z0-9-]*$`/ in all 3 files. Add a regression test that `provider: "1password"` doesn't 404.

---

## 5. Documentation-vs-code drift findings

### SKILL.md (`skills/terraform-docs/SKILL.md`)

| Claim | Verified | Note |
|---|---|---|
| 4-channel envelope (knowledge / recipes / files / aliases) | ✓ | matches `discover-types.ts` `DiscoverOk`. |
| `manifest_entry.blocks` field | ✓ | E1 emits per-resource `blocks: {}` (verified in `aws/MANIFEST.json` keys). |
| `recommended_companions` per-resource | ✓ | emitted by E1, populated by E1's `build_companions.py`. |
| Cited card `aws-s3-native-state-locking` (Example 1) | ✓ | `bundle/knowledge/aws-s3-native-state-locking.md` exists. |
| Cited card `cloudflare-resource-renames-v5` (Example 5) | ✓ | exists. |
| Cited card `aws-s3-versioning-split` (envelope sample) | ✓ | exists. |
| Cited recipe `zero-trust-cloudflare-aws-okta` (Example 4) | ✓ | `bundle/recipes/zero-trust-cloudflare-aws-okta.toml` exists. |
| Cited concept-alias `cloudflare/bot_protection` (Example 3) | ✓ | `bundle/cloudflare/aliases.yaml` contains `bot_protection`. |
| `companions: aws_vpc, aws_subnet, ...` for `aws_instance` (Example 2) | ⚠ | `bundle/aws/companions.yaml` was authored by E3 with 12 keys — verify `aws_instance` key surfaces these specific 6 names. Spot-check shows `aws_instance` is in companions.yaml but exact list not validated. |
| `references/eval-baseline.md` etc. | ✓ | all 7 reference files exist. |

**Verdict:** SKILL.md is consistent with shipped artifacts. One soft nit on the `aws_instance` companions example.

### Stale docstring

`scripts/build_aliases.py:4-5` claims it emits `service_aliases` AND `primary_resources` into MANIFEST.json. It only emits `service_aliases`. Update the docstring to remove the false claim.

---

## 6. Recommended `package.json#files` array

Current array (line 37-49):
```json
"files": [
  "npm/", "dist/", "skills/",
  "AGENTS.md", "CLAUDE.md", "CONTEXT.md",
  "cursor-rule.mdc", "gemini-extension.json", ".claude-plugin/",
  "README.md", "LICENSE"
]
```

`npm pack --dry-run` confirms the published tarball:
- 101 files, 456 KB unpacked.
- Includes `dist/`, `npm/{install,run,safe-tar}.js`, `skills/terraform-docs/{SKILL.md, references/*}`, `.claude-plugin/`, `cursor-rule.mdc`, `gemini-extension.json`, `README.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `package.json`.
- Excludes `apps/`, `tests/`, `docs/`, `evals/`, `personas/`, `recipes/`, `scripts/`, `eslint.config.js`, `tsconfig*.json`, `.changeset/`, `.github/`. ✓

**Recommendation:** drop `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` from the published surface — they are project-internal contributor docs, not user-facing. Keep them in the repo for contributors but don't ship 30+ KB of internal-only prose to every user.

```jsonc
"files": [
  "dist/",
  "npm/",
  "skills/",
  ".claude-plugin/",
  "cursor-rule.mdc",
  "gemini-extension.json",
  "README.md",
  "LICENSE"
]
```

The `.npmignore` is a belt-and-braces safety net; it already excludes `src/`, `tests/`, `docs/`, `evals/`. ✓ No further change needed there.

---

## 7. Top 5 issues to address before v0.1 ship

In priority order:

1. **(BLOCKER) E6→E8 report-shape mismatch.** Dashboard renders bundled fixture forever because `parseReport()` returns null on real runs. Fix: align `evals/runner.ts:writeReport()` to emit the `EvalReport` shape from `apps/dashboard/src/lib/parse-report.ts`. ETA 1h.

2. **(BLOCKER) MCP `1password` provider regex.** 3 occurrences in `apps/mcp/src/{lib/r2-bundle.ts:115, tools/tf_discover.ts:22, tools/tf_get_manifest.ts:14}` reject the canonical provider name. Patch regex to `^[a-z0-9][a-z0-9-]*$`. ETA 5 min + regression test.

3. **(High) E1↔E2 manifest gap (punch-list #4).** Extend `manifest_builder.py` to emit top-level `primary_resources` and `subcat_keywords` per provider. Patch outlined in §2 above. Without this, 27 of 31 providers run discovery in degraded mode. ETA 30 min.

4. **(High) `vega skills install --agent all` covers only 4 agents (punch-list #3).** Swap `ALL_AGENT_NAMES` → `ALL_RENDERER_NAMES` and `getAgent` → `getRenderer` in `src/commands/skills.ts`. New 6-agent path is ready. ETA 15 min + adjusted test.

5. **(Medium) R2 bucket-name divergence (punch-list #1).** Pick `vegastack-bundles` and search-and-replace across `apps/mcp/wrangler.toml:46-47`, `apps/dashboard/wrangler.toml:20-21`, `bundle/.github/workflows/build-and-publish.yml` workflow defaults / `RELEASE.md`. ETA 5 min.

After these five land, recommend re-running `npm test` in CLI + apps + bundle, then green light v0.1 ship.

---

## 8. Items NOT blocking ship (informational)

- Dashboard silent-fixture-fallback (E8 nit) — cosmetic but should be a `stale: true` flag in the model so the UI can show a banner. Not BLOCKER because the fixture is plausible-looking.
- `apps/mcp/src/lib/types.ts` mirror — acceptable for v0.1; add a `// CLEANUP-AFTER-PUBLISH` marker so E7/E2 swap to a re-export later.
- `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` in the published tarball — optional polish.
- `evals/runner.ts:333` `console.log` — acceptable for a CLI runner, but inconsistency with the `log` lib worth noting.
- `build_aliases.py:4-5` stale docstring claiming `primary_resources` is emitted — clean up while extending the builder per §2.

---

## Files cited in this report (absolute paths)

- `/Users/mk/projects/vegastack-cli/src/commands/skills.ts:3` (legacy ALL_AGENTS still wired)
- `/Users/mk/projects/vegastack-cli/src/lib/discover/tier1.ts:58-59` (defensive `?? {}` for missing manifest fields)
- `/Users/mk/projects/vegastack-cli/src/lib/discover/index.ts:266` (warnings for stale bundle)
- `/Users/mk/projects/vegastack-cli/evals/runner.ts:319-327` (drifted report shape)
- `/Users/mk/projects/vegastack-cli/evals/reports/demo-baseline-vs-skill.json:1-27` (drifted output proof)
- `/Users/mk/projects/vegastack-cli/apps/mcp/src/lib/r2-bundle.ts:115` (1password regex bug)
- `/Users/mk/projects/vegastack-cli/apps/mcp/src/tools/tf_discover.ts:22` (1password regex bug)
- `/Users/mk/projects/vegastack-cli/apps/mcp/src/tools/tf_get_manifest.ts:14` (1password regex bug)
- `/Users/mk/projects/vegastack-cli/apps/mcp/src/lib/types.ts:1-8` (mirror file)
- `/Users/mk/projects/vegastack-cli/apps/mcp/wrangler.toml:46-47` (bucket name)
- `/Users/mk/projects/vegastack-cli/apps/dashboard/src/lib/parse-report.ts:113-142` (canonical EvalReport + parseReport)
- `/Users/mk/projects/vegastack-cli/apps/dashboard/src/lib/r2.ts:73-83` (silent fixture fallback)
- `/Users/mk/projects/vegastack-cli/apps/dashboard/wrangler.toml:20-21` (bucket name)
- `/Users/mk/projects/vegastack-cli/package.json:37-49` (files array)
- `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/scripts/manifest_builder.py:668-693` (build_manifest return — missing primary_resources/subcat_keywords)
- `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/scripts/build_aliases.py:4-5` (stale docstring)
- `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/aws/MANIFEST.json` (top-level keys verified missing primary_resources / subcat_keywords)
- `/Users/mk/projects/vegastack-cli/skills/terraform-docs/SKILL.md` (consistent with shipped artifacts)
