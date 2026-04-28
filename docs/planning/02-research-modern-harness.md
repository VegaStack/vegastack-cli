# R1 — Modern-Harness Research (web)

**Date:** 2026-04-28

## 1. Anthropic Agent Skills standard + agentskills.io
Schema: directory with SKILL.md. Required frontmatter: name, description. Optional: license, compatibility, metadata, allowed-tools (still experimental — syntax `Bash(git:*) Bash(jq:*) Read`). Description quality drives auto-invoke accuracy. Proven pattern: "WHEN + WHEN NOT" inside description string. **Our description has no WHEN-NOT clause; agents underfire it.**
Sources: github.com/anthropics/skills, platform.claude.com/docs/en/agents-and-tools/agent-skills/overview, agentskills.io/specification

## 2. Claude Code Plugins (.claude-plugin/plugin.json) — Apr 2026
Only `name` required. Useful keys: `version` (semver; if omitted CC falls back to git SHA = every commit is a new version), `homepage`, `repository`, `keywords`, `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `monitors`, `dependencies`. Layout: `.claude-plugin/plugin.json` + `skills/<name>/SKILL.md` + `commands/*.md` + `hooks/hooks.json`. `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` substituted. **Packaging as a CC plugin gets us native /plugin install discovery, version pinning, and a monitors/ slot for freshness watcher.** Requires CC v2.1.105+.
Source: code.claude.com/docs/en/plugins-reference

## 3. Claude Code skills/sub-agents/hooks unification (April 2026)
.claude/commands/ and .claude/skills/ unified — every skill exposes a /slash-command. Sub-agents do NOT inherit parent skills; must list them in frontmatter. New hooks: PostToolUse/PostToolUseFailure with duration_ms; new lifecycle InstructionsLoaded, FileChanged, CwdChanged, PostToolBatch, WorktreeCreate/Remove, PreCompact/PostCompact. Hook types: command, http, mcp_tool, prompt, agent. **We can install SessionStart hook running `vega doctor --json` once per session, and FileChanged hook on `*.tf` files to warm cache.**
Sources: code.claude.com/docs/en/skills, ofox.ai/blog/claude-code-hooks-subagents-skills-complete-guide-2026, releasebot.io/updates/anthropic/claude-code (April 2026)

## 4. Codex CLI skills (~/.codex/skills/) + AGENTS.md
Codex reads ONLY name, description, file path, optional agents/openai.yaml during metadata phase; full SKILL.md only when matched. ~/.codex/AGENTS.md (or AGENTS.override.md) defines working agreements. CODEX_HOME overrides. **Validates two-tier philosophy. Keep skill description ≤500 chars; offload long prose to references/*.md.**
Sources: developers.openai.com/codex/skills, agents.md (Linux Foundation 2026)

## 5. Cursor .cursor/rules/*.mdc
Frontmatter: description, globs, alwaysApply. Four activation modes: Always-Apply, Apply-Intelligently (description-only), File-Scoped (globs), Manual. **For Cursor scope=project we should drop a globs:["**/*.tf","**/*.hcl"] File-Scoped rule that calls vega tf when .tf in context.**
Sources: morphllm.com/cursor-rules-best-practices, github.com/sanjeed5/awesome-cursor-rules-mdc

## 6. Gemini extensions
Required: name (kebab), version. Useful: description, mcpServers{}, contextFileName (default GEMINI.md), excludeTools[], settings[] (env-var prompts), themes[]. Skills in skills/<name>/SKILL.md; commands TOML in commands/ (commands/gcs/sync.toml → /gcs:sync). **gemini-extension.json shipping commands/tf.toml gives Gemini users /tf "<query>" natively.**
Source: geminicli.com/docs/extensions/reference

## 7. Vercel bash-tool + just-bash + skills (Jan-Feb 2026)
APIs: bash, readFile, writeFile, plus `experimental_createSkillTool` auto-discovers skills/*/SKILL.md and injects as extraInstructions. Sandbox interface: executeCommand/readFile/writeFiles. Eval: bash 53% vs SQL 100% on structured corpus, but bash wins on exploration. **Validates two-tier model. Mirror createSkillTool: `tools: { ...createBashTool({ skills: '@vegastack/cli/skills' }) }` lets any AI-SDK app mount with one line.**
Sources: github.com/vercel-labs/bash-tool, vercel.com/blog/testing-if-bash-is-all-you-need, vercel.com/changelog/use-skills-in-your-ai-sdk-agents-via-bash-tool

## 8. QMD (Tobi Lutke)
Local search over markdown. CLI: query/search/vsearch/get/multi-get over SQLite FTS5 + sqlite-vec. `qmd context add` binds prose-y descriptions to paths so query expansion has anchors. CLAUDE.md hard rule: "Never run qmd collection add/embed/update automatically." Doc IDs are 6-char content hashes. **`context add` pattern is exactly our concept_aliases done right — explicit, file-backed, version-controllable. The "agents must never auto-modify the index" guardrail belongs in our SKILL.md.**
Source: github.com/tobi/qmd

## 9. Pagefind + ripgrep/ast-grep deterministic stack
Pagefind: lazily-chunked index alongside dist/; 10,000-page site searches under 300 KB total payload. Claude Code v2.1.117 (Apr 2026) swapped its Grep to embedded ugrep + bfs. **At 97 MB our bundle is too big to lazy-load over network, but Pagefind's chunked-index philosophy maps to per-provider sub-bundles ("install only AWS+CF = 12 MB instead of 97 MB"). Split MANIFEST.json into per-provider artifacts users can subscribe to.**
Sources: pagefind.app, starlight.astro.build/guides/site-search, codeant.ai/blogs/why-coding-agents-should-use-ripgrep

## 10. Continue.dev context providers + MCP shift
Continue's @Docs deprecated in favor of MCP servers + Context7. Config: context: [{provider, params}] and mcpServers: [{name, command, args}]. **Continue/Aider/Cline won't run vega skills install — but WILL add MCP entry. Optional `vega mcp serve` (stdio MCP wrapper around vega tf) opens those ecosystems with one binary. Additive distribution channel.**
Source: docs.continue.dev/customize/deep-dives/custom-providers

## 11. Sigstore bundles + npm provenance
@sigstore/bundle packages X.509 cert + Rekor transparency-log entry + RFC-3161 timestamp + signature. npm CLI ships --provenance. **For a doc bundle republished every 24h, provenance is the answer to "who built this and from which commit?" `vega doctor` should display provenance attestation alongside synced_at/upstream_sha.**
Sources: docs.sigstore.dev/about/bundle, blog.sigstore.dev/npm-public-beta, github.com/sigstore/sigstore-js

## Honourable mentions
- TOON format (Token-Oriented Object Notation) cuts JSON-overhead 50-60% on repeated-shape payloads — relevant if streaming files[] with N>20.
- Zoekt's trigram-on-disk index — gold standard for "deterministic, exhaustive, citable" search at scale.

## Top-3 actionable recommendations
1. **Ship as Claude Code plugin (.claude-plugin/plugin.json) in addition to npm.** Use monitors/ slot for freshness. ~30 lines JSON. Requires CC v2.1.105+.
2. **Tighten SKILL.md description with explicit WHEN-NOT clauses; split body into metadata-cheap front + lazy references/*.md.** Pattern: "Use when: <2 sentences>. Do NOT use for: <3 negatives>."
3. **Add MCP-stdio wrapper (`vega mcp serve`) and per-provider sub-bundles.** ~100 LOC for MCP wrapper unlocks Continue/Aider/Cline. Per-provider tarballs let `vega install --providers aws,cloudflare,kubernetes` fetch 12 MB vs 97 MB.
