# R6 — Broaden-Harness Web Research

**Date:** 2026-04-28 · **Author:** R6 (Phase-5 web-research, retry pass)
**Tool status:** Confirmed working (Read + WebSearch + WebFetch). Proceeded normally.
**Word count:** ~2,450.
**Hard rule:** Nothing repeats R1 (`02-research-modern-harness.md`) or R2 (`03-research-references.md`).

---

## 1. Headline findings (≤250 words)

1. **Two parallel "package-manager-for-skills" registries are now real** and didn't exist when R1 was written. **Skills.sh** (Vercel-launched, Feb 2026, `npx skills add/find/check/update`) and **Tessl Registry** (`tessl i github:org/repo --skill <name>`) both consume the *exact same* SKILL.md format vegastack-cli already ships. We get into both for free with zero code changes — but only if our README documents the install one-liners and our `package.json` carries `keywords: ["agent-skill","skill","terraform"]` so the registries index us. ([skills.sh post](https://johnoct.com/blog/2026/02/12/skills-sh-open-agent-skills-ecosystem/), [Tessl docs](https://docs.tessl.io/reference/cli-commands))

2. **HashiCorp shipped its own competing Terraform agent-skills bundle on 2026-02-02** under MPL-2.0, distributed as a *Claude Code plugin marketplace* (`/plugin marketplace add hashicorp/agent-skills`). Coverage is *narrow* (Terraform + Packer, ~11 sub-skills, all "how to write providers / modules / tests" — **not a doc-discovery harness**). Vegastack-cli's deterministic per-resource manifest + multi-provider bundle has **no competing equivalent in the official HashiCorp set** — a real moat we should name in our README. ([HashiCorp blog](https://www.hashicorp.com/en/blog/introducing-hashicorp-agent-skills), [repo tree](https://github.com/hashicorp/agent-skills/tree/main/terraform))

3. **The "agent-skills standard" went cross-vendor in Q1 2026.** Microsoft Agent Framework (Apr 2026) ships `AgentSkillsProvider` / `SkillsProvider` (C# + Python) that loads the *identical* SKILL.md frontmatter spec — including `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. Same is true of OpenCode, Goose, OpenClaw, Hermes, Atmos, Roo Code (via adapter), Antigravity. **Our SKILL.md ships natively to ≥10 harnesses without per-agent variants** — the renderer abstraction we built may be over-engineered for everything except Cursor/Roo (whose `.mdc` / `.roomodes` shapes are genuinely different). ([Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/skills), [agentskills.io](https://agentskills.io/specification))

---

## 2. Per-project digest table

| # | Name | URL | Launch | Determ.? | Update model | Multi-domain? | Format | License | What to steal |
|---|---|---|---|---|---|---|---|---|---|
| 1 | OpenClaw | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) · [docs](https://docs.openclaw.ai/tools/skills) | 2026-Q1 | hybrid | Plugin/skill versioned via `openclaw.plugin.json` | yes (5,400+ skills) | SKILL.md + `metadata.openclaw.{requires,install,primaryEnv}` extension | open-source (MIT in core) | `requires.bins`/`requires.env` gating + `install.{brew,node,go,uv}` declarative installer block in frontmatter |
| 2 | Hermes Agent (Nous) | [github.com/nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent) | 2026-02 | hybrid (self-improves) | `~/.hermes/skills/` filesystem, periodic auto-curation | yes (662 skills, 16 categories) | SKILL.md + `tags[]`, `codex[]`, `version`, `author` | MIT | `tags[]` array for harness-side categorization; gateway architecture (one daemon serves Telegram/Discord/Slack/CLI from same skill set) |
| 3 | HashiCorp Agent Skills | [github.com/hashicorp/agent-skills](https://github.com/hashicorp/agent-skills) | 2026-02-02 | deterministic (curated) | npm/Tessl/CC-marketplace install; no daily cron documented | no (TF + Packer only, 11 skills) | `SKILL.md` per skill, grouped under `<product>/<plugin>/.claude-plugin/plugin.json` | MPL-2.0 | "product → plugin → skill" 3-tier folder layout — much cleaner than flat `skills/` for multi-provider scaling |
| 4 | TerraShark | [github.com/LukasNiessen/terrashark](https://github.com/LukasNiessen/terrashark) | 2026 (v2.3.0 current) | deterministic | semver-bumped manual refinement | yes (AWS/Azure/GCP/Oracle/IBM) | SKILL.md (79 lines) + 18 `references/*.md` + `.claude-plugin/marketplace.json` | MIT | **Diagnostic-first workflow**: SKILL.md forces "identify failure mode → load only matching reference doc" — cuts activation tokens 7× |
| 5 | antonbabenko/terraform-skill | [github.com/antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill) | 2026 | deterministic | git-tag releases | yes (TF + OpenTofu, all clouds) | SKILL.md + references | (404'd on raw fetch — likely MIT, unverified) | Coverage of testing/modules/CI-CD/state — domains we don't touch but agents *do* search for |
| 6 | atmos | [atmos.tools/ai/agent-skills](https://atmos.tools/ai/agent-skills) | 2026 | deterministic | Tied to Atmos releases | yes (21 skills) | SKILL.md + `references/`; **single Claude Code plugin wrapping all skills** | Apache-2.0 | "lightweight router AGENTS.md → skill" pattern — `AGENTS.md` is the cheap top-level dispatcher, skills are the lazy bodies |
| 7 | Microsoft Agent Framework (Skills) | [learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/agents/skills) | 2026-04-10 | deterministic | `DisableCaching=true` flag for dev; cached otherwise | yes | Same SKILL.md spec + C#/Python `AgentSkillsProvider` + class-based skills + DI | MIT | **4-stage progressive disclosure tools** (`load_skill`, `read_skill_resource`, `run_skill_script`) — explicit tool names other agents can adopt |
| 8 | Skills.sh (Vercel) | [johnoct.com post](https://johnoct.com/blog/2026/02/12/skills-sh-open-agent-skills-ecosystem/) | 2026-02 | deterministic | `npx skills check` 24h notifier, `npx skills update` | yes (registry indexed) | Standard SKILL.md from any GH/GL repo | OSS (Apache-2.0 expected) | **Registry-as-discovery layer** — popularity metrics, telemetry-light. Vegastack auto-discoverable via `keywords: ["agent-skill"]` |
| 9 | Tessl Registry | [tessl.io/registry](https://tessl.io/registry), [docs](https://docs.tessl.io/reference/cli-commands) | 2026-Q1 | deterministic | `tessl up` updates | yes (1000+) | SKILL.md (Anthropic spec) | OSS | `--skill <name>` selection flag for multi-skill repos — relevant once we ship multiple bundles |
| 10 | VoltAgent awesome-agent-skills | [github.com/VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 2026 | (catalog) | community-curated | yes (1,100+ indexed) | links to upstream SKILL.md | MIT | Submission-PR template; getting listed = free distribution |
| 11 | Block/AAIF Goose (recipes) | [block.github.io/goose/docs/guides/recipes](https://block.github.io/goose/docs/guides/recipes/) | Moved to AAIF (Linux Foundation) Q1 2026 | deterministic | YAML-versioned | yes | YAML recipe with `instructions`, `extensions`, `parameters`, `subrecipes` | Apache-2.0 (AAIF) | Recipes = portable YAML "scripts of intent" — orthogonal to skills; we could ship `vega tf` recipes as Goose recipes too |
| 12 | langchain-ai/deepagents | [github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents) | 2026 | (filesystem-tool deterministic; planning LLM) | git releases | yes | Custom tools via `tools=[...]`, MCP adapter | MIT | Auto-saves large outputs to FS; relevant pattern for our `vega tf --json` outputs >50KB |
| 13 | revfactory/harness | [github.com/revfactory/harness](https://github.com/revfactory/harness) | 2026 | (meta-skill that designs other agent teams) | manual | yes | research paper + meta-skill | open-source | Meta-skill pattern — could ship a `vega-skill-author` meta-skill that designs new vegastack bundles |
| 14 | shimo4228/agent-knowledge-cycle | [github.com/shimo4228/agent-knowledge-cycle](https://github.com/shimo4228/agent-knowledge-cycle) | 2026 | yes | 6-phase Research→Extract→Curate→Promote→Measure→Maintain | yes | Markdown + 2 JSON schemas (`episode-log`, `knowledge`) | MIT | "Code owns determinism, LLMs own meaning" — quotable design guardrail; immutable episode log idea is gold for our knowledge-card freshness audit |
| 15 | agentopology | [github.com/agentopology/agentopology](https://github.com/agentopology/agentopology) | 2026 | yes (single source `.at`) | git | yes (7 targets) | `.at` declarative file → per-target binding outputs (`.claude/agents/`, `.openclaw/soul.md`, `.cursor/rules/*.mdc`, `.openai/agents.md`, gemini-extension.json, copilot, Kiro) | Apache-2.0 | Validates our renderer abstraction — but they ship 7 target bindings; we ship 6. Watch list: their `Kiro` target (Amazon's new harness) — we don't cover Kiro yet |
| 16 | everything-claude-code | [github.com/affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 2026 | hybrid | manifest-driven `install-plan.js` + `install-apply.js` | yes (5 harnesses) | 183 skills + 48 agents + 79 commands + DRY hooks | MIT | "install-plan / install-apply" two-step (dry-run → apply) for skill installation idempotency — better than our current writeIfChanged pattern |

---

## 3. Comparative matrix vs vegastack-cli — top 5 most-relevant

### 3a. HashiCorp Agent Skills (`hashicorp/agent-skills`) — direct competitor, narrow scope
Launched 2026-02-02 under MPL-2.0. Layout is `<product>/<plugin>/.claude-plugin/plugin.json` plus per-skill SKILL.md — a 3-tier hierarchy that scales cleanly to 50+ products. Coverage today: Terraform (11 skills) + Packer. *None* of those skills are "look up resource X in provider Y's docs"; they are "how to write a Terraform provider", "how to run acceptance tests", "azure-verified-modules". This means **vegastack-cli's per-resource deterministic manifest is non-overlapping with the official HashiCorp library** — we are complementary, not competing. Action: in README, position as "what `hashicorp/agent-skills` is missing — the actual provider docs", install both side-by-side. Steal: their `<product>/<plugin>/skills/` 3-tier layout once we add Pulumi or OpenTofu coverage.

### 3b. TerraShark — closest peer in shape, very different in philosophy
MIT, ~80-line SKILL.md plus 18 reference files plus marketplace.json. *Diagnostic-first*: forces the agent to identify which failure mode it's facing before loading any reference. Activation cost ~600 tokens for the diagnostic vs ~4,400 if everything loaded eagerly. Our SKILL.md (per A1's audit) currently has WHEN-NOT but no "diagnose first, load second" router. **High-impact lift, low effort: rewrite SKILL.md body to start with a 6-line decision tree (`If user query mentions X → load references/X.md`) instead of always invoking `vega tf` immediately.** The CLI itself becomes the "load references" tool.

### 3c. atmos — single-plugin wrapping many skills + AGENTS.md as router
Apache-2.0. Atmos's killer move is bundling all 21 skills inside *one* Claude Code plugin and using `AGENTS.md` as a token-cheap router that dispatches to the right skill. Vegastack-cli currently ships *one* skill (`terraform-docs`) — but we will eventually want recipes/knowledge/aliases as discoverable skills. **Pattern: split `terraform-docs` into `tf-discover`, `tf-recipes`, `tf-knowledge` and let `AGENTS.md` route.** Lazier loading per turn.

### 3d. Skills.sh + Tessl — registries we get for free
Vercel's skills.sh (`npx skills add @vegastack/cli` ≈ should work) and Tessl (`tessl i github:vegastack/vegastack-cli`) are *already* indexing arbitrary GH repos containing SKILL.md files. Today our SKILL.md lives at `skills/terraform-docs/SKILL.md`. Both registries discover that automatically. Action items: (1) verify our `package.json#keywords` includes `agent-skill`, `skill`, `terraform`, `claude-code`; (2) add `npx skills add vegastack/vegastack-cli` and `tessl i github:vegastack/vegastack-cli` to README install matrix alongside `npm i`; (3) submit a PR to `VoltAgent/awesome-agent-skills` and `heilcheng/awesome-agent-skills`. Zero code, ~3 distribution channels gained.

### 3e. Microsoft Agent Framework Skills — validates the spec in C#/Python
Apr 2026, MIT. Implements *exactly* the agentskills.io spec server-side, with `SkillsProvider` for both C# and Python loading SKILL.md from a directory. Includes a `compatibility` frontmatter field (max 500 chars) we currently leave empty — Microsoft explicitly recommends populating it with required tooling (`Requires python3`, `Requires terraform >=1.5`). **Action: set `compatibility: "Requires Node >=18 and the @vegastack/cli package on PATH"` in our SKILL.md frontmatter.** Also: their `progressive disclosure` is documented as 4 explicit tools (`load_skill`, `read_skill_resource`, `run_skill_script`) — this is the *contract name* harnesses are converging on. Our `vega tf` is effectively a fused `load_skill+read_skill_resource+run_skill_script`. Worth a one-line note in SKILL.md: "this skill bundles all 3 progressive-disclosure phases into one CLI."

---

## 4. OpenClaw + Hermes deep-dive — they exist, both real

### OpenClaw (very real, very large)
OpenClaw is a *2026 phenomenon*: the [VoltAgent awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills) catalog claims **5,400+ skills** filtered from the official OpenClaw Skills Registry. Architecture is unique: it doesn't try to *be* a coding agent — it's a *meta-harness* that orchestrates Claude Code, Codex, Gemini CLI, OpenCode, Pi via the **Agent Client Protocol (ACP)**. SKILL.md spec is the standard agentskills.io shape *plus* a `metadata.openclaw.*` namespace with proprietary fields: `requires.bins`, `requires.env`, `requires.config`, `install.{brew,node,go,uv,download}`, `primaryEnv` (links a skill to an API-key field in central config), `os` (platform restriction), `emoji`, `homepage`. Plugins live in `openclaw.plugin.json`. Two relevant repos for vegastack: `Enderfga/openclaw-claude-code` (the CC bridge plugin) and `noncelogic/openclaw-skill-claude-code` (resilient async job manager). **Recommendation:** add an OpenClaw section to AGENTS.md noting our SKILL.md works as-is in OpenClaw because we don't conflict with `metadata.openclaw.*`; optionally add `metadata.openclaw.requires.bins: ["node","npm"]` for explicit gating.

### Hermes Agent (very real, by Nous Research, NOT the LLM)
Disambiguated: this is the [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/) framework launched **Feb 2026** by the same lab that ships the Hermes/Nomos/Psyche LLMs — but the *agent* is a separate MIT-licensed project. **662 skills across 4 registries (83 built-in, 58 optional, 521 community), 16 categories**. Killer features: (1) gateway daemon serves the same skills to Telegram/Discord/Slack/WhatsApp/Signal/Email/CLI — vegastack could plug `vega mcp serve` into it; (2) "skills self-improve" — Hermes auto-curates user-created skills into `~/.hermes/skills/openclaw-imports/` (yes, it ingests OpenClaw skills); (3) frontmatter extends Anthropic spec with `tags[]` (multi-cat), `codex[]` (ecosystem assoc), `version`, `author`, `license`. Their `claude-code` skill (which delegates code tasks to Claude CLI) carries `version: 2.2.0`, `tags: [Coding-Agent, Claude, Anthropic, Code-Review, Refactoring, PTY, Automation]`, `codex: [hermes-agent, opencode]`. **Recommendation:** add `tags: [Terraform, IaC, Documentation, Multi-Provider, Deterministic]` and `codex: [vegastack-cli]` to our SKILL.md — costs nothing, surfaces us in Hermes search.

---

## 5. 2026 patterns converging across multiple projects

1. **Single SKILL.md format wins everywhere.** agentskills.io is now the de-facto cross-vendor spec — implemented identically by Anthropic, Microsoft Agent Framework, Goose, OpenCode, OpenClaw (with `metadata.*` extension), Hermes (with `tags[]`/`codex[]` extensions), atmos, HashiCorp, Skills.sh, Tessl. Per-agent forks (`.cursorrules` → `.mdc` → `.roomodes`) are now *adapters* on top of one canonical SKILL.md, not competing formats. Our renderer pattern is correct; the canonical source is the SKILL.md.

2. **Two-stage discovery (advertise ≤100 tokens → load on demand) is universal.** Microsoft's "4-stage progressive disclosure" is the most explicit: `load_skill`/`read_skill_resource`/`run_skill_script` are now named tools. Skills.sh, atmos, TerraShark, Hermes, OpenClaw all do the same shape. Implication: keep our `description` field crisp (≤500 chars), keep SKILL.md body ≤500 lines, push everything else to `references/*.md`.

3. **Plugin-marketplace + npm-style registry have stabilized as parallel channels.** `/plugin marketplace add <gh-org/repo>` for Claude Code; `npx skills add` for Skills.sh; `tessl i github:...` for Tessl; `gh skill install` for the GitHub-blessed shape. Most projects ship to ≥3 of these. We currently ship to 1 (npm). The 2026 expectation is ≥3.

4. **Diagnostic-first / router-first SKILL.md bodies** (TerraShark, atmos AGENTS.md, harness/Archon meta-skills) — the body opens with a 5-10 line decision tree before invoking the heavy CLI. We don't do this yet.

5. **"Code owns determinism, LLMs own meaning"** is the explicit design principle of agent-knowledge-cycle, atmos, TerraShark, deepagents, and Microsoft's `workflows vs skills` guidance. Vegastack aligns with this naturally — our envelope, manifest, and per-resource doc are deterministic, agents only do interpretation. We should *quote this principle* in our README + AGENTS.md as positioning.

---

## 6. Concrete next-iter recommendations (ranked impact ÷ effort)

| # | Action | Effort | Impact | Why |
|---|---|---|---|---|
| 1 | Add `keywords: ["agent-skill","skill","terraform","claude-code","codex","cursor","gemini-cli","mcp","iac","hashicorp"]` to `package.json`; document `npx skills add vegastack/vegastack-cli` and `tessl i github:vegastack/vegastack-cli` in README install matrix | 10 min | unlocks Skills.sh + Tessl auto-discovery | Free distribution channels — registries already crawl |
| 2 | Submit PRs to `VoltAgent/awesome-agent-skills`, `heilcheng/awesome-agent-skills`, `quemsah/awesome-claude-plugins`, `mergisi/awesome-openclaw-agents` listing vegastack-cli under IaC | 30 min | catalog inclusion = free SEO | All four are crawled by the registries above |
| 3 | Rewrite SKILL.md body to open with a TerraShark-style 6-line *diagnostic decision tree* before invoking `vega tf` ("If query mentions a resource type → run X. If query is about state/locking → load `references/state.md` first."). Add `compatibility: "Requires Node >=18; @vegastack/cli on PATH"`, `tags: [Terraform, IaC, Documentation, Multi-Provider, Deterministic]`, `codex: [vegastack-cli]` | 2 hours | activation tokens drop, Hermes/OpenClaw discovery improves | Closes A1 SHOULD-FIX #8 token-stem mismatch *and* matches 2026 best practice |
| 4 | Restructure for a future *3-tier* layout (`terraform/<plugin>/.claude-plugin/plugin.json` + `skills/<skill>/SKILL.md`) à la HashiCorp — even if we keep the flat structure for v0.1, add a `MIGRATION.md` so the move is documented for v0.2 when we add knowledge/recipes as separate skills | 1 hour | clean scaling path | atmos + HashiCorp are the proven shapes |
| 5 | Add an `AGENTS.md` *router* at repo root (atmos pattern) that says "for Terraform docs: invoke skill `terraform-docs`. For knowledge cards: invoke `vega knowledge`. For recipes: invoke `vega recipe`." → token-cheap dispatcher across our future skill family | 30 min | preps the v0.2 multi-skill split | Mirrors the convergent pattern across atmos/HashiCorp/Hermes |
| 6 | Position vs HashiCorp explicitly in README: a "what's in `hashicorp/agent-skills` and what's in `@vegastack/cli`" table — they cover *authoring* (write providers, run tests), we cover *consuming* (look up resources, knowledge cards, recipes). Recommend installing both | 30 min | turns competition into complementarity | The repos really don't overlap — say so |
| 7 | Add an Amazon Kiro renderer (agentopology already supports it; we don't). Spec lives at the same SKILL.md — mostly a passthrough writer | 2 hours | +1 distribution channel | Kiro is the gap in our 6-renderer matrix |
| 8 | Adopt `install-plan.js` + `install-apply.js` two-step from `everything-claude-code` for `vega skills install` — dry-run plan, then apply. Closes A3 idempotency caveat (SHOULD-FIX #6, Cursor renderer) more cleanly than `writeIfChanged` | 1 hour | better idempotency story | Pattern is mature, MIT-licensed reference exists |

---

## 7. Sources (date-stamped 2026-04-28)

- [HashiCorp blog — Introducing HashiCorp Agent Skills (2026-02-02)](https://www.hashicorp.com/en/blog/introducing-hashicorp-agent-skills)
- [github.com/hashicorp/agent-skills/tree/main/terraform](https://github.com/hashicorp/agent-skills/tree/main/terraform)
- [github.com/LukasNiessen/terrashark — TerraShark v2.3.0](https://github.com/LukasNiessen/terrashark)
- [github.com/antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill)
- [atmos.tools/ai/agent-skills — atmos 21-skill bundle](https://atmos.tools/ai/agent-skills)
- [agentskills.io/specification — open standard](https://agentskills.io/specification)
- [learn.microsoft.com — Microsoft Agent Framework Skills (2026-04-10, updated 2026-04-22)](https://learn.microsoft.com/en-us/agent-framework/agents/skills)
- [johnoct.com — Skills.sh: The Missing Package Manager (2026-02-12)](https://johnoct.com/blog/2026/02/12/skills-sh-open-agent-skills-ecosystem/)
- [tessl.io/registry — Tessl Skills Registry](https://tessl.io/registry) · [docs.tessl.io/reference/cli-commands](https://docs.tessl.io/reference/cli-commands)
- [github.com/anthropics/claude-plugins-official — official CC marketplace, 100+ plugins as of Apr 2026](https://github.com/anthropics/claude-plugins-official)
- [docs.openclaw.ai/tools/skills — OpenClaw SKILL.md spec](https://docs.openclaw.ai/tools/skills)
- [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) · [github.com/Enderfga/openclaw-claude-code](https://github.com/Enderfga/openclaw-claude-code)
- [github.com/VoltAgent/awesome-openclaw-skills — 5,400+ skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/) · [hermes-agent.nousresearch.com/docs/skills](https://hermes-agent.nousresearch.com/docs/skills/)
- [github.com/nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- [github.com/nousresearch/hermes-agent/blob/main/skills/autonomous-ai-agents/claude-code/SKILL.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/autonomous-ai-agents/claude-code/SKILL.md)
- [block.github.io/goose/docs/guides/recipes — Goose recipes (now AAIF/Linux Foundation)](https://block.github.io/goose/docs/guides/recipes/)
- [github.com/aaif-goose/goose — Goose under Agentic AI Foundation](https://github.com/aaif-goose/goose)
- [github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)
- [github.com/revfactory/harness — meta-skill that designs agent teams (2026)](https://github.com/revfactory/harness)
- [github.com/shimo4228/agent-knowledge-cycle — 6-phase knowledge cycle, MIT](https://github.com/shimo4228/agent-knowledge-cycle)
- [github.com/agentopology/agentopology — declarative `.at` → 7 harnesses](https://github.com/agentopology/agentopology)
- [github.com/affaan-m/everything-claude-code — 183-skill harness](https://github.com/affaan-m/everything-claude-code)
- [github.com/ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering)
- [github.com/HKUDS/OpenHarness](https://github.com/HKUDS/OpenHarness)
- [github.com/VoltAgent/awesome-agent-skills — 1,100+ catalog](https://github.com/VoltAgent/awesome-agent-skills)
- [docs.roocode.com — Roo Code custom modes spec](https://docs.roocode.com/features/custom-modes)
- [docs.continue.dev — Continue.dev MCP shift](https://docs.continue.dev/customize/deep-dives/custom-providers)
- [geminicli.com/extensions — 926-extension catalog](https://geminicli.com/extensions/)
- [Google Cloud blog — Choosing Antigravity or Gemini CLI (2026)](https://cloud.google.com/blog/topics/developers-practitioners/choosing-antigravity-or-gemini-cli)
- [code.visualstudio.com — Use Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [opencode.ai/docs/skills — OpenCode Agent Skills](https://opencode.ai/docs/skills/)

---

*End R6.* Stayed within 45-min wall-clock budget. No code touched, pure research. Honest disambiguation: **OpenClaw and Hermes both exist as named, well-known 2026 frameworks** — the user was correct to flag them. Hermes is by Nous Research but is a separate framework from their Hermes LLM family.
