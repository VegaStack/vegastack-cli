# Catalog PR drafts — `@vegastack/cli`

Ready-to-copy PR descriptions and entry text for each external "awesome-skills"
catalog. Per-catalog format was sourced live from the upstream README on
2026-04-28 via `gh api repos/<owner>/<repo>/readme`.

These PRs are NOT auto-opened from this repo (we don't have push access to
external orgs) — a maintainer pastes the entry into a fork and opens the PR
locally. Re-validate the README format before submitting if more than ~30 days
have passed since this file was last updated.

---

## 1. `VoltAgent/awesome-agent-skills`

- **Repo:** https://github.com/VoltAgent/awesome-agent-skills
- **Entry shape:** Markdown bullet under a topical section, link to the
  Skills.sh canonical URL (`officialskills.sh/<owner>/skills/<name>`) plus a
  one-line description. Section to extend: `Skills by HashiCorp Team for
  Terraform` (sibling section under `Skills by ... Team`). Vegastack is *not*
  a HashiCorp-team skill, so the cleanest fit is the existing community-skills
  IaC region (extend the section, or add a sibling `### Skills by Vegastack
  Team for Terraform` block immediately below the HashiCorp one — they
  organize by team).
- **Source verified:** README format pulled 2026-04-28; HashiCorp section is
  at `Skills by HashiCorp Team for Terraform` and uses bold link + dash + one
  line.

### PR title

```
Add @vegastack/cli — per-resource Terraform docs harness for 31 providers
```

### PR body

```markdown
## What

Adds `@vegastack/cli` — an [Anthropic Agent Skills Standard](https://agentskills.io/specification)
skill for deterministic, offline Terraform documentation lookup across 31
providers. Complementary to the existing `hashicorp/agent-skills` entries:
HashiCorp covers *authoring* (write providers, run acceptance tests);
Vegastack covers *consuming* (look up `aws_db_instance`, get import-id
syntax, surface deprecations).

## Where

Adds one section under "Cloud & Infrastructure" sibling to `Skills by
HashiCorp Team for Terraform`:

### Skills by Vegastack Team for Terraform

- **[vegastack/terraform-docs](https://officialskills.sh/vegastack/skills/terraform-docs)** - Per-resource manifest, import syntax, deprecation flags, and multi-provider recipes for 31 Terraform providers (AWS, Azure, GCP, Cloudflare, Kubernetes, Vault, Datadog, Snowflake, …). Installs via `npm i -g @vegastack/cli` and `vega skills install --agent <claude-code|codex|cursor|gemini|continue|aider>`. MIT.

## Verification

- npm: https://www.npmjs.com/package/@vegastack/cli
- Repo: https://github.com/vegastack/vegastack-cli
- Skill body: https://github.com/vegastack/vegastack-cli/blob/main/skills/terraform-docs/SKILL.md
- License: MIT
- Spec: agentskills.io v1.0
```

---

## 2. `heilcheng/awesome-agent-skills`

- **Repo:** https://github.com/heilcheng/awesome-agent-skills
- **Entry shape:** Plain markdown bullet under a topical section, link to the
  `agent-skill.co` canonical URL plus a one-line description (no bold). Sits
  under `## Cloud & Infrastructure` → `### Skills by HashiCorp (Terraform)`.
  Their CONTRIBUTING.md covers the basic SKILL.md template requirement.
- **Source verified:** README format pulled 2026-04-28; entries follow the
  pattern `- [owner/skill](url) - description`.

### PR title

```
Add @vegastack/cli to Cloud & Infrastructure → Terraform
```

### PR body

```markdown
## What

Adds `@vegastack/cli` — a deterministic Terraform docs harness implementing
the Anthropic Agent Skills standard. 31 Terraform providers, per-resource
manifest with import syntax + deprecation flags + recommended companions.
Complements the existing HashiCorp authoring skills.

## Where

Add to the existing `### Skills by HashiCorp (Terraform)` section, or create
a new sibling block right below it:

### Skills by Vegastack (Terraform consumers)

- [vegastack/terraform-docs](https://agent-skill.co/vegastack/skills/terraform-docs) - Per-resource manifest, import syntax, deprecation flags for 31 Terraform providers (AWS, Azure, GCP, Cloudflare, Vault, Datadog, …)

## Why this fits

- Real engineering team using it daily (matches catalog's "real-world skills"
  bar).
- Compatible with Claude Code, Codex, Cursor, Gemini CLI, Continue, Aider.
- MIT licensed, public on npm and GitHub.
- Skill body follows agentskills.io v1.0 spec — single SKILL.md +
  references/.

## Verification

- npm: https://www.npmjs.com/package/@vegastack/cli
- Source: https://github.com/vegastack/vegastack-cli
- SKILL.md: https://github.com/vegastack/vegastack-cli/blob/main/skills/terraform-docs/SKILL.md
```

---

## 3. `quemsah/awesome-claude-plugins`

- **Repo:** https://github.com/quemsah/awesome-claude-plugins
- **Entry shape:** Auto-generated table of the top 100 GitHub repositories by
  star count that contain `.claude-plugin/` plus a description; refreshed
  programmatically (header reads "Last updated: 26.04.2026 with 14023 total
  repositories indexed"). There is **no contribution / PR workflow** —
  inclusion is gated on stars and on the crawler picking up
  `.claude-plugin/plugin.json`. Vegastack-cli already ships a
  `.claude-plugin/plugin.json`, so we are eligible automatically once we
  pass the star threshold (currently top 100 sits at ≈3,668 stars — well
  above any new repo).
- **Source verified:** Full README pulled 2026-04-28; no contributing
  section, no `Submit Your Plugin` link, no template.

### Recommended action

**No PR needed; nothing to submit.** Steps to maximize discovery instead:

1. Confirm `.claude-plugin/plugin.json` is at the repo root and parseable
   (already true — see `/Users/mk/projects/vegastack-cli/.claude-plugin/plugin.json`).
2. Add `agent-skill`, `claude-plugin`, `terraform`, `mcp` to the GitHub
   repo's "Topics" field (Settings → Topics) so the crawler indexes us
   under those facets.
3. Wait for the next crawl + star growth. The catalog re-runs roughly
   weekly from the README header pattern.

If a maintainer ever adds a submission template, the entry shape is:

```
| <rank> | [vegastack-cli](https://github.com/vegastack/vegastack-cli) | Deterministic offline Terraform docs harness for coding agents (Claude Code, Codex, Cursor, Gemini, Continue, Aider). 31 providers, per-resource manifest, knowledge cards, recipes. | <stars> | <subs> | 1 |
```

---

## 4. `mergisi/awesome-openclaw-agents` — needs verification

- **Repo:** https://github.com/mergisi/awesome-openclaw-agents
- **Status:** **Skipped — needs human verification.**
- **Why:** This catalog ships *agents stored inside the repo itself* — each
  entry is an `agents/<category>/<name>/SOUL.md` file with a `README.md`
  registered in `agents.json`, then deployed via CrewClaw. Vegastack-cli is
  an Anthropic Agent Skills `SKILL.md` — a different artifact from
  OpenClaw's `SOUL.md` (different frontmatter shape, different lifecycle:
  CrewClaw deploys a long-running gateway agent; we ship a CLI tool).
- **Source verified:** README format pulled 2026-04-28. Their submission
  flow (line 820-825) explicitly requires "your agent folder with SOUL.md +
  README.md (minimum)" plus an `agents.json` entry.

### Recommended action

**Defer.** Either:

1. Author a separate `SOUL.md` adapter for the OpenClaw gateway (≈2 hours,
   would live at `personas/openclaw-vegastack-tf/SOUL.md` in this repo) and
   submit that to the catalog as `🦞 Vegastack Terraform Consultant`, or
2. Submit `vegastack-cli` to a *skills*-oriented OpenClaw catalog instead.
   The R6 research turned up `VoltAgent/awesome-openclaw-skills` (5,400+
   skills) which accepts SKILL.md as-is via the `metadata.openclaw.*`
   namespace — that's a closer fit than `awesome-openclaw-agents`.

Marking this entry "needs verification" rather than fabricating a SOUL.md
that the upstream maintainers would reject on review.

---

## Provenance

| Catalog | README fetched | Format captured | Entry drafted | Status |
| ------- | -------------- | --------------- | ------------- | ------ |
| VoltAgent/awesome-agent-skills | 2026-04-28 | yes (bold-link + dash + line) | yes | ready |
| heilcheng/awesome-agent-skills | 2026-04-28 | yes (link + dash + line) | yes | ready |
| quemsah/awesome-claude-plugins | 2026-04-28 | auto-generated table | n/a — no submission flow | no PR needed |
| mergisi/awesome-openclaw-agents | 2026-04-28 | requires SOUL.md, not SKILL.md | n/a — wrong artifact type | needs verification |
