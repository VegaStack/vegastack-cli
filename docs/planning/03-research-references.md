# R2 — Reference Project Digest

All clones in /Users/mk/projects/references/, read-only, --depth 1.

## 1. tobi/qmd (MIT)
**Path:** /Users/mk/projects/references/qmd · **SHA:** e8de7cab... (2026-04-21)
- TS + Bun/Node CLI on top of SQLite (FTS5 + sqlite-vec); ~/.cache/qmd/index.sqlite holds documents, documents_fts, content_vectors, vectors_vec, path_contexts, llm_cache. Schema/scoring in src/store.ts (~4.7k lines).
- Three-mode search: search (BM25), vsearch (vector), query (hybrid). Hybrid = RRF fusion across original + 2 LLM-expanded queries → Qwen3 reranker → position-aware blend.
- Layered surfaces: CLI (src/cli/qmd.ts), MCP server (src/mcp/server.ts, stdio + HTTP + daemon/PID-file), SDK re-export (src/index.ts). createStore() accepts inline config, YAML path, or DB-only.
- "Collections" = named indexed dirs with glob; "context" = descriptive metadata attached to qmd://collection/path returned alongside hits.
- Smart chunking: scored break-points (H1=100 down to line-break=1) + tree-sitter AST. Chunks ~900 tokens / 15% overlap. Output: TTY w/ OSC-8 hyperlinks + QMD_EDITOR_URI, plus --json/--csv/--md/--xml/--files.

**Steal:** agent-first output matrix (--json/--files/--md/--explain); single-file SQLite; "context" prose attached to paths.
**Don't copy:** node-llama-cpp + 2GB GGUF (out of scope).

## 2. CloudCannon/pagefind (MIT)
**Path:** /Users/mk/projects/references/pagefind · **SHA:** 26f37805... (2026-04-22)
- Rust workspace. src/main.rs is 16 lines: tokio::main → pagefind::runner::run_indexer().
- "Fossick" pipeline: walk → DOM parse → normalize whitespace → stem (~30 algorithms) → split words → FossickedData per page.
- Index build parallelized via rayon: per-page PageProcessingResult → MetaIndex, sharded WordIndex chunks, FilterIndex, MetaPage.
- Sharding by content: words split across many small .pf_index chunks; browser fetches only chunks for query trigrams.
- Multi-language stemming + filter facets + sortable fields first-class.

**Steal:** sharded index keyed by content; two-stage pipeline (fossick → encode); fragments model (searchable text vs displayable snippet stored separately).
**Don't copy:** browser WASM/JS UI.

## 3. sourcegraph/zoekt (Apache-2.0)
**Path:** /Users/mk/projects/references/zoekt · **SHA:** 1f9ef56b... (2026-04-24)
- Go codebase as many cmd/zoekt-* binaries (zoekt-index, zoekt-git-index, zoekt-mirror-github, zoekt-webserver, zoekt-indexserver, zoekt-merge-index). Library in index/, query/, search/, gitindex/.
- Index = positional trigrams: for each ngram, store every offset in every file. Search picks two rarest trigrams from query, intersects posting lists, verifies distance. ~3× corpus size.
- Regex queries reduced to AND/OR trees of substrings, intersected with trigram posting lists, verified by full regex on candidate set. Boolean AST: Atom | AND | OR | NOT.
- Ranking signals (doc/design.md 164-188): atoms-matched, closeness, word-boundary match, file mtime, filename length, comment-vs-string tokenizer, **symbol match via ctags (heavily boosted)**. Optional BM25 mode via UseBM25Scoring.
- gRPC + JSON HTTP API, streaming results (FlushWallTime), context lines per match (NumContextLines); shardable + mergeable indexes (zoekt-merge-index).

**Steal:** "many small binaries, one library" command shape; **symbol-aware ranking via ctags** — for Terraform: treat resource/data-source/variable names as symbols and boost matches above prose; query AST + JSON API contract (Atom/AND/OR/NOT vocabulary).
**Don't copy:** full positional-trigram on-disk format (overkill at hundreds of MB; SQLite FTS5 cheaper).

## 4. phiresky/ripgrep-all (rga) — **AGPL-3.0 — HARD INCOMPATIBILITY**
**Path:** /Users/mk/projects/references/ripgrep-all · **SHA:** 0f10fb92... (2026-03-25)
- Rust binary wrapping ripgrep, pre-processing every container/binary type into searchable text on the fly.
- Adapter pattern (src/adapters/*): each format (PDF, docx, sqlite, mkv subtitles, zip, tar.gz, epub, jpg via OCR) implements FileAdapter with FileMatcher for mimetype/filename. choose_adapter (src/preproc.rs) sniffs mime via tree_magic.
- Preprocessor cache (src/preproc_cache.rs) keys converted text by content hash so repeated searches over same archive are cheap.
- Async streaming end-to-end (tokio, async-stream); converted text never fully materializes.

**Steal:** FileAdapter trait + mimetype-driven dispatch (re-implement under MIT/Apache); preprocessor cache keyed by source hash; "delegate hard search problem to battle-tested tool."
**Don't copy:** **the AGPL code itself** — even copy-pasted helper would viral-license vegastack-cli.

## 5. cli/cli (gh CLI) (MIT)
**Path:** /Users/mk/projects/references/gh-cli · **SHA:** 3c7c88c0... (2026-04-27)
- Cobra-rooted command tree in pkg/cmd/<group>/...; one folder per top-level verb. Static composition, no plugin reflection.
- **gh skill subcommand tree (added 2026):** install / preview / publish / search / update, telemetry annotation `core` group, --dry-run validator on publish. Aliased as skill/skills. **Canonical 2026 GitHub-blessed shape for managing agent skills from a CLI.**
- Update notifier (internal/update/update.go): per-command state.yml stores CheckedForUpdateAt + LatestRelease; checks once per 24h, only if interactive TTY + not CI + not opted-out (GH_NO_UPDATE_NOTIFIER, GH_NO_EXTENSION_UPDATE_NOTIFIER, CODESPACES). Version compare via hashicorp/go-version. ~180 lines.
- Factory pattern (pkg/cmdutil/Factory): IOStreams, Config, HTTPClient, Browser, Prompter all injected.
- Extension model: native + git-based extensions, internal/update.CheckForExtensionUpdate reuses 24h state-file pattern.

**Steal:** 24h-throttled state-file update notifier — port verbatim with VEGASTACK_NO_UPDATE_NOTIFIER; gh skill subcommand layout — match exactly (vegastack skill install/preview/publish/search/update); Factory + IOStreams pattern.
**Don't copy:** breadth of pkg/cmd/* (~30 verb groups). Keep vegastack-cli verb tree small.

## 6. anthropics/skills (Mixed: Apache-2.0 / source-available)
**Path:** /Users/mk/projects/references/anthropic-skills · **SHA:** 5128e186... (2026-04-23)
- Three top-level dirs: skills/ (17 reference skills), spec/ (points to agentskills.io/specification), template/ (one-line SKILL.md starter).
- Every skill self-contained with YAML frontmatter (name, description, optional metadata, allowed-tools, license, compatibility) + markdown body.
- Frontmatter contract minimal — only name and description required. allowed-tools (e.g. `Bash(qmd:*), mcp__qmd__*`) is harness's permission boundary.
- Categories: Creative & Design, Document, Development, Enterprise. Distribution: Claude Code plugin marketplace — `/plugin marketplace add anthropics/skills` then `/plugin install <skill>@anthropic-agent-skills`.
- Skills load lazily — harness reads only SKILL.md until invoked.

**Steal:** canonical SKILL.md frontmatter exactly; folder-per-skill layout under skills/ with terraform-docs/SKILL.md as entry; use `` !`shell-cmd` `` blocks for live status (qmd does `` !`qmd status` `` inside SKILL.md).
**Don't copy:** source-available docx/pdf/pptx/xlsx skills as templates.

## Bonus: google-workspace-cli (already cloned, Apache-2.0)
**Path:** /Users/mk/projects/references/google-workspace-cli · **SHA:** a3768d0e... (2026-04-01)
- Workspace of two crates: google-workspace-cli (binary) + google-workspace (library). Top-level: rust+cargo, npm wrapper, plus skills/ (~80 entries: gws-* per service, recipe-*, persona-*), docs/, art/, scripts/.
- **generate_skills.rs:** emits SKILL.md files from CLI's own clap metadata + two TOML registries (personas.toml, recipes.toml). Single source of truth — every Discovery API method becomes a skill, every persona/recipe is declarative. **Mirror this: regenerate skills/terraform-docs/* from a registry, never hand-write.**
- **NPM install flow (npm/install.js, ~170 lines):** postinstall downloads GitHub release artifact for platform via Node 18 fetch, **verifies SHA256 from .sha256 file**, extracts to npm/bin/, writes .version for upgrade detection. **Steal verbatim.**
- Top-level docs: AGENTS.md, CLAUDE.md, CONTEXT.md, gemini-extension.json — multi-agent harness alignment first-class.
- Command surface: gws <service> <resource> [sub-resource] <method> [flags] — strict 4-segment shape, dynamically derived from Discovery docs at runtime.

## Applicability Matrix
| vegastack-cli concern | Best reference | Pattern to adopt |
|---|---|---|
| Doc index storage | qmd | Single SQLite file w/ FTS5 (defer sqlite-vec) |
| Search ranking | qmd + zoekt | BM25 baseline (FTS5); boost on Terraform symbols (resource/data-source/variable names) à la zoekt ctags |
| Hybrid / semantic search | qmd | RRF fusion + --explain trace shape — defer LLM rerank to caller |
| Source-format adapters | rga | FileAdapter trait + mimetype dispatch + content-hash cache (re-implement, do not vendor — AGPL) |
| Index sharding | pagefind | One shard per provider/resource group; agent fetches only needed shard |
| CLI command tree | gh-cli | Cobra-style static composition; small verb set: search/get/list/index/mcp/skill/update |
| Subcommand for skills | gh-cli `gh skill` | Mirror install/preview/publish/search/update exactly |
| Update notifier | gh-cli | 24h state-file at ~/.cache/vegastack/update.yml, env-var opt-outs, TTY+CI gates |
| Skill folder layout | anthropics/skills | One skills/<name>/SKILL.md per skill, canonical frontmatter |
| Skill generation | gws-cli generate_skills.rs | Generate SKILL.md from clap metadata + TOML registries — never hand-author |
| NPM distribution wrapper | gws-cli npm/install.js | Verbatim port: GitHub release + SHA256 verify + version pin |
| MCP server surface | qmd src/mcp/server.ts | stdio + HTTP transport, query/get/multi_get/status tool set |
| Agent-friendly output | qmd | --json/--files/--md/--explain matrix; OSC-8 hyperlinks on TTY |
| "Context" enrichment | qmd | Path-attached prose returned with every hit (per-provider blurb) |
| Multi-agent harness alignment | gws-cli | Ship AGENTS.md, CLAUDE.md, gemini-extension.json from day one |
| License posture | qmd / gh-cli (MIT) or gws-cli (Apache-2.0) | Pick MIT or Apache-2.0; **never copy from rga (AGPL)** |

**Headlines:** (1) gh CLI shipped `gh skill install/preview/publish/search/update` in 2026 — GitHub-blessed shape we mirror exactly. (2) ripgrep-all is AGPL — pattern only, no code. (3) gws-cli's generate_skills.rs + npm/install.js are near-perfect templates (Apache-2.0). (4) qmd is closest analog architecturally — start there; strip the GGUF model dependency.
