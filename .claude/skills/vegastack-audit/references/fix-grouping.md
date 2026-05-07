# Fix-Grouping — Recommended Batches

After the audit creates GitHub issues, it must emit a **recommended fix batches**
block — a maintainer-friendly plan that tells `/vegastack-fix` (and the human
running it) which issues can be tackled together in one session, which need
their own session, and which are safe to run in parallel.

This step exists because in practice an audit produces 20+ issues and "fix them
all" is not a single tractable command. Without explicit grouping, the human
has to compute the file-overlap graph in their head every time, and Claude
ends up doing it ad-hoc inside `/vegastack-fix` (badly, and again on every
re-run).

## Where the batches go

1. **Tracking issue body** — appended as a `## Recommended fix batches`
   section so anyone reading the tracking issue sees the plan.
2. **Local audit report** — same section, between Findings and Verification log.
3. **User summary** printed at the end of the audit run — copy-pasteable
   commands.

## When to compute

Step 9b of `SKILL.md` (after issue creation, before the final user summary).
Cheap to compute; runs once per audit.

## Algorithm

### Step A — Build the file-touch set per issue

For each VERIFIED finding that became a GitHub issue:

```
files(issue) = { Location.path }                              ← always
            ∪ { every relative file path mentioned in
                Suggested fix or Suggested test text }
            ∪ { every file referenced in the per-section
                evidence block via `path/to/file.ts` backticks }
```

Strip line numbers, strip glob expansions, normalize to repo-root relative.

### Step B — Build the symbol-touch set (optional precision pass)

For each `.ts` / `.tsx` / `.astro` file in `files(issue)`:

```
symbols(file) = top-level exports declared in that file
              ∪ top-level imports of those exports elsewhere
                (one ts-morph hop, cached across issues)
```

Two issues are **symbol-coupled** if they share at least one symbol that one
of them modifies. This catches the case where issue A renames `foo()` and
issue B has a test asserting `foo()`'s old return value.

If `ts-morph` isn't installed in the project, skip Step B and use file-overlap
only. Document the fallback in the batches output ("symbol coupling not
checked — ts-morph unavailable").

### Step C — Connected-component clustering

Two issues are **interacting** if:

```
files(A) ∩ files(B) ≠ ∅           OR
symbols(A) ∩ symbols(B) ≠ ∅
```

Compute connected components over the issue set with this relation. Each
component is a **must-be-sequential cluster** (one session, one subagent).

### Step D — Effort classification

Each issue gets an effort tag, derived from the validated finding's heuristics:

| Tag | Heuristic |
|---|---|
| **mechanical** | Single file, ≤5 LOC change, change is in config / docs / strings / version field. No new tests needed beyond an architectural pin. |
| **small** | Single file or 2 closely-related files, ≤30 LOC change, clear failing test in mind. |
| **medium** | 2–4 files OR design call (e.g. "auth: yes/no") OR new dependency. |
| **large** | Refactor, investigation, performance work, or anything tagged `area:test-coverage` involving a flake. |

Heuristic source: regex over the finding's title + suggested-fix text. Examples:
- "stale string" / "version sync" / "missing flag" / "rename" / "comment" → mechanical
- "add helper" / "add test" / "single-file fix" → small
- "rewrite" / "refactor" / "investigation" / "design" → large

### Step E — Session packing

For each cluster from Step C, decide its **session shape**:

| Cluster size | Cluster effort sum | Session shape |
|---|---|---|
| 1 issue | mechanical / small | Eligible for **batch with other mechanical/small clusters** in the same session, up to total cap of 8 issues per session. |
| 1 issue | medium / large | **Solo session**, no batching. |
| ≥2 issues | any | **Sequential within one session**, no batching with other clusters (the cluster IS the batch). |

When packing batches across single-issue clusters, pack mechanical first
(many can fit), then small, until session cap (default 8) is reached or no
more single-issue clusters are eligible.

### Step F — Parallel-eligibility flag

For each batch, decide whether it's eligible for `/vegastack-fix --parallel`:

```
parallel_eligible(batch) =
  ALL pairs of issues in batch are non-interacting (Step C)         AND
  ALL issues in batch are tagged mechanical OR small                AND
  ALL issues in batch have no "design call" markers in suggested fix
                                                                    AND
  batch size ≥ 2
```

The flag is a **hint** to `/vegastack-fix`, not a mandate. The fix skill
can override based on its own integration-verify checks.

### Step G — Topic labels

Pure cosmetic — for human readability. Group by category prefix:

- All issues from `code-review/registry` + `security` touching `registry.ts` or `managed-tools` → `registry-security`
- All issues from `code-review/discover` → `discover-perf`
- `release-readiness` + workflow files → `workflow-hygiene`
- `code-review/dashboard` → `dashboard-config`
- `code-review/mcp` → `mcp-worker`
- `code-quality` + `test-coverage` flake → `test-stability`

When in doubt, use the dominant category of the cluster.

## Output format

A single Markdown table, posted verbatim to the tracking issue and printed in
the user summary.

```markdown
## Recommended fix batches

Each row is one suggested session. Run them in order; `/clear` between sessions
to keep context lean.

| # | Command | Issues | Effort | Topic | Parallel-OK |
|---|---|---|---|---|---|
| 1 | `/vegastack-fix #65 #68 #69 #71 #73 #74 #79 #80` | 8 | small × 8 | mixed | ✅ |
| 2 | `/vegastack-fix #64 #72 #81` | 3 | medium × 3 | workflow + registry-security + scripts | ✅ |
| 3 | `/vegastack-fix #75 #76` | 2 | medium × 2 | registry-security (must-sequential — same files) | ❌ |
| 4 | `/vegastack-fix #77 --dry-run` then `/vegastack-fix #77` | 1 | medium | mcp-worker (design decision) | n/a |
| 5 | `/vegastack-fix #60` | 1 | large | test-stability (flake root-cause) | n/a |
| 6 | `/vegastack-fix #59` | 1 | large | discover-perf (refactor) | n/a |

> **Reading this table**
> - **Parallel-OK ✅**: pass `--parallel` to `/vegastack-fix` for ~3-5× wall-clock speedup. The fix skill spawns one Opus subagent per issue, branches isolated, integration-verifies before any GitHub close. See `.claude/skills/vegastack-fix/references/batch-orchestration.md` for the orchestration spec.
> - **Parallel-OK ❌**: issues touch overlapping files; must run sequentially. The skill enforces this even if you pass `--parallel`.
> - **n/a**: solo sessions don't benefit from parallel.

## File-overlap map

<details>
<summary>(Click to expand — useful when re-batching by hand)</summary>

```
src/lib/registry.ts            → #72, #73, #74
src/lib/managed-tool-installer.ts → #75, #76
src/commands/scan.ts           → (closed: #70)
src/lib/discover/aliases.ts    → #68
src/lib/discover/knowledge.ts  → #69
src/lib/discover/recipes.ts    → #69
apps/mcp/src/index.ts          → #77
apps/dashboard/astro.config.mjs → #79
apps/dashboard/src/pages/reports/[date].astro → #80
.github/workflows/*.yml        → #64
scripts/update-managed-tools-manifest.ts → #81
src/lib/discover/tier1.ts      → #59
tests/integration/cli-help.test.ts → #60
src/commands/preview.ts        → #65
```
</details>

## Recommended-batches contract

The audit skill MUST emit batches that satisfy:

1. Every VERIFIED High issue with a GitHub issue appears in exactly one batch.
2. Every batch's issues, when concatenated as `gh issue` numbers, form a valid `/vegastack-fix` command.
3. Every batch row's "Parallel-OK" cell matches the result of `parallel_eligible()` for that batch.
4. The total session count ≤ ceil(total_issues / 1) — i.e. each issue counted exactly once across all sessions.
5. Mediums and Lows are NOT in batches — they live in their rollup issues. The batches table covers Critical + High individuals only.
6. The first row's command is the same one printed in the audit's "Quick start" user-summary so a maintainer running the very first session has a copy-paste line.
```

## Idempotence

Re-running the audit (e.g., after fixing some issues) regenerates the batches
based on the **currently open** GitHub issues. Closed issues are dropped.
The new batches table replaces the old one in the tracking issue body via
`gh issue edit` — no new comments are appended for batch updates.

## Examples

### Example 1 — first audit run

Input: 27 open High issues, no closed.

Output:
- 6 batches (8 + 3 + 2 + 1 + 1 + 1 issues)
- 3 parallel-OK
- Total estimated effort: ~5–6 hours of focused work

### Example 2 — partial-progress audit re-run

Input: 14 open High issues remaining (13 already closed).

Output:
- 3 batches (5 + 3 + 1 + 1 + 1 + 3 issues)
- Re-clustered based on remaining issues only
- Marks which clusters were *unblocked* by previous closures (e.g., "registry-security cluster shrunk from 5→2 after #72 #73 #74 closed")

### Example 3 — single-issue audit (run after one bug report)

Input: 1 open issue.

Output:
- 1 batch, solo
- Skip the table; emit a single-line `/vegastack-fix #N` recommendation
- Note any single-issue parallel-OK as `n/a (solo)`

## What NOT to do

- **Don't auto-batch Mediums or Lows.** They're rolled up. If a maintainer
  promotes a Medium to its own issue, it joins the next audit's batch table.
- **Don't suggest `--auto` for design-call issues.** Anything where the
  finding's suggested fix says "decide whether…" or "needs design review" or
  has multiple plausible approaches gets a `--dry-run` first batch.
- **Don't reorder issues within a batch by `gh issue` number.** Order them
  by effort tag (mechanical → small → medium) so the human sees small wins
  early in each session.
- **Don't promise wall-clock estimates per issue.** Use coarse session-level
  estimates only ("~45 min" not "8 min, 12 min, 6 min..."). Per-issue timing
  has too much variance to be useful.
