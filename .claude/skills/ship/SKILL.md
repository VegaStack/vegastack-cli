---
name: ship
description: "Ship workflow for the @vegastack/cli npm package — INTERNAL v0.1 GitHub Packages release path, ONLY for the vegastack-cli repo. Handles the full release cycle: pre-flight tests across CLI + apps/mcp + apps/dashboard, diff analysis, exhaustive doc audit, version bump synced across 3 package.json files, changelog entry in Keep a Changelog format, conventional commit, push, tag, GH Packages publish via publish-internal.yml, post-ship verification. TRIGGER: when the user runs /ship, says 'cut a release', 'ship the cli', 'publish to internal registry', 'release v0.1.1', or anything that means ship a new version of @vegastack/cli from inside this repo. Make sure to use this skill whenever the user wants to ship a release of @vegastack/cli, even if they don't explicitly say 'ship' — phrases like 'let's release this', 'tag v0.1.x', 'publish a new version', or 'cut a build' should all trigger it. Do NOT trigger for other projects (mac-dev-env-setup has its own /ship), for the bundle repo (engg-vegastack-agent-tf-providers has its own daily build-and-publish.yml cron), or for app deploys (apps/mcp + apps/dashboard auto-deploy via Cloudflare Workers Builds on push to main — no separate /ship needed)."
user-invokable: true
---

# Ship Workflow — @vegastack/cli internal release

Full release cycle for v0.1 internal GitHub Packages publishing: pre-flight tests across all 3 codebases, diff + doc audit, version bump synced across `package.json` × 3, changelog entry, commit + tag push, post-ship verification.

The actual `npm publish` is performed by `.github/workflows/publish-internal.yml` when it sees the `v*` tag — this skill prepares the release locally and then triggers the workflow by pushing the tag. **Do not invoke `gh workflow run publish-internal.yml`** — the tag push is the only correct trigger. Calling the workflow manually risks publishing without a corresponding git tag, which breaks the version-tag-matches-package-version check.

## Project context this skill encodes

- **3 codebases** under one repo, all version-synced: `package.json` (CLI, 398 tests), `apps/mcp/package.json` (Cloudflare Workers MCP server, 19 tests), `apps/dashboard/package.json` (Astro Cloudflare Workers eval dashboard, 9 tests). All three carry the same version even though only the CLI publishes via this skill — keeping them aligned makes "what version is this code?" answerable from any package.json.
- **Bundle is a separate repo** (`engg-vegastack-agent-tf-providers`). It ships on its own daily cron via `build-and-publish.yml`. This skill never touches it.
- **App deploys are automatic.** Cloudflare Workers Builds watches the repo and redeploys `apps/mcp` + `apps/dashboard` on every push to main. This skill never invokes `wrangler deploy`.
- **The dormant `release.yml`** is the future public-npm path with cosign + SLSA. It auto-trigger on `v*` is commented out. This skill never modifies or invokes it.
- **`prepublishOnly` guard** at `scripts/check-bundle-pin.js` refuses to publish if `expectedBundleSha` is the placeholder. The CI workflow sets `VEGASTACK_ALLOW_PENDING_BUNDLE_SHA=1` to bypass for v0.1 internal builds. **Never bypass the guard locally** — locally the guard's role is to remind you that the bundle SHA is still stub-pinned, which matters when v1.0 ships publicly.

## Steps

### Step 1: Pre-flight — run all 3 codebases green

Run in parallel:

```bash
cd /Users/mk/projects/vegastack-cli
npm run build && npm run typecheck && npm test && npm run lint
( cd apps/mcp && npm run build && npm test )
( cd apps/dashboard && npm run build && npm test )
npm pack --dry-run --json | jq '.[0].entryCount, .[0].size'
```

Expected (anything else means investigate before shipping):

| Codebase | Build | Typecheck | Tests | Lint |
|---|---|---|---|---|
| CLI root | exit 0 | exit 0 | 398 passed | exit 0 |
| `apps/mcp` | exit 0 | (in build) | 19 passed | (no separate lint) |
| `apps/dashboard` | exit 0 | (in build) | 9 passed | (no separate lint) |

Expected `npm pack --dry-run`: ~104 files, ~466 kB unpacked / ~123 kB packed. If the file count or size jumped meaningfully, check `package.json#files` for accidental additions before continuing.

If ANY check fails, stop and surface the failure to the user. Do not "patch then ship" without their explicit OK — a flaky test before release is the moment to investigate, not the moment to skip.

### Step 2: Analyze the diff

Run in parallel (use the Bash tool's parallel-call ability):

- `git diff --stat` and `git diff` (full diff of staged + unstaged)
- `git status` (never use `-uall` — large repos overflow)
- `git log --oneline -10` (recent commits for style + chronology reference)
- `gh api /orgs/VegaStack/packages/npm/cli/versions --jq '.[0].name' 2>/dev/null` (latest published version from GitHub Packages — this is the source of truth, NOT `package.json#version` which can be stale if someone bumped without publishing). If the package isn't published yet, this returns empty — note that the next ship will be the first.
- Read the first 30 lines of `CHANGELOG.md` for format reference.
- `cat package.json | jq '.version'` to know the current local version.

### Step 3: Audit ALL docs for outdated information

This step is critical and must be exhaustive. Do not skip or skim. The cost of a stale doc is real — every contributor reading it gets a wrong mental model.

**First:** build a *change manifest* from the diff. List every command flag, env var, file path, npm script, config key, exported function, knowledge card id, recipe id, alias name, or workflow step that was added, removed, renamed, or changed.

**Then:** glob `**/*.md` and read every markdown file in the repo, EXCLUDING these historical/spec directories which get rewritten only intentionally and not as part of a normal ship:

- `docs/planning/**` — phase-1 research outputs, frozen at audit time
- `docs/status/**` — phase-3+ team status reports, frozen at audit time
- `docs/contracts/**` — binding specs; only edit when intentionally evolving the contract
- `docs/evals/**` — raw eval JSON, not prose

For each remaining file, grep for every item in the change manifest. Also grep broadly for related terms — if a flag was renamed `--max` → `--top`, also grep for "max" alone in case there's prose like "the maximum results returned".

**Additionally** check non-markdown files that contain user-facing text:

- `apps/mcp/README.md`, `apps/dashboard/README.md` — separate README per app
- `skills/vegastack/SKILL.md` and `skills/vegastack/references/*.md` — the public-facing skill body and supporting references
- `cursor-rule.mdc`, `gemini-extension.json` — per-agent surface files
- `.claude-plugin/plugin.json` — Claude Code plugin manifest
- `package.json#description` and `package.json#keywords` — npm-surface text

This covers three classes of issue:

- **Stale references** — existing docs that are now factually wrong (renamed flags, removed env vars, deprecated paths, command examples that no longer parse, tables of supported providers that exclude new ones, supported-agent lists missing a renderer that was added).
- **Missing docs** — new behaviors that aren't documented (a new flag with no help text in README, a new knowledge card id not listed in `references/recent-changes.md`, a new recipe id not in `references/recipes.md`).
- **Inconsistent docs** — places where two files contradict each other (one says `BUNDLE_PUBLIC_BASE_URL` includes `/cli`, another says it's the bare domain).

For each issue found, update the relevant doc(s) in place. Report to the user: which files were updated, what was changed, and why. If no docs need updates, explicitly confirm you checked every file and found nothing stale — the user should know the audit ran, not just assume.

### Step 4: Draft version, changelog, commit message, release notes

Analyze ALL changes in the diff. Produce:

1. **Suggested version** based on diff scope:
   - **Patch (x.y.Z)**: bug fixes, dependency bumps, doc-only changes, internal refactors with no API change, perf improvements that don't change behavior.
   - **Minor (x.Y.0)**: new features, new CLI flags, new MCP tools, new knowledge cards / recipes / aliases shipped in the bundle pin, new agent renderer, new dashboard pages.
   - **Major (X.0.0)**: NEVER suggest. Default to minor for breaking changes during the v0.1.x line and call out the breaking change loudly in the changelog. Only suggest major if the user explicitly requests it.

2. **Changelog entry** in Keep a Changelog format, prepended to `CHANGELOG.md`:
   ```
   ## [X.Y.Z] - YYYY-MM-DD

   One-line summary of the release.

   ### Added / Changed / Fixed / Security / Removed
   - Bullet point per change, written for a developer reading later
   ```

3. **Commit message** in conventional-commit format with HEREDOC body:
   ```
   <type>(<scope>): <concise summary>

   ## What changed
   - Bullet points (human-readable, not file-by-file)

   ## Why
   The reason this change was made (link issues if relevant).

   ## Technical details
   - <file>: <what changed at the line/function level>

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

   Type taxonomy: `feat` (minor bump), `fix` (patch), `chore` (patch, build/deps/internal), `docs` (patch, doc-only), `refactor` (patch), `perf` (patch), `test` (patch), `build` (patch), `ci` (patch), `revert` (patch).

4. **GitHub release title:** `vX.Y.Z — Short description (≤60 chars)`.

5. **GitHub release body:** human-readable summary. Open with the one-line release summary from the changelog. List the most user-visible changes as bullets. Close with an "Install (internal)" snippet pointing at the README's PAT setup. Match the prose style of recent releases — check via `gh release view <latest> --json body --jq .body 2>/dev/null` (returns empty for the very first release, which is fine).

Present everything to the user. Ask to confirm the version, changelog wording, commit message, and release notes. Do NOT proceed until confirmed.

**Version chronology validation** — when the user provides or confirms a version, validate it against the version history before proceeding:

1. Use the latest GitHub Packages version (from Step 2) as the authoritative current version. The local `package.json#version` may be stale if someone bumped without publishing.
2. Verify the new version is strictly greater than the latest published version (semver ordering — `0.1.2 > 0.1.1 > 0.1.0`).
3. Verify it follows semver logic — a patch from `0.1.0` is `0.1.1`, not `0.1.2` (unless `0.1.1` already exists in tags but wasn't published, which is its own problem to surface).
4. If the user's override would create a gap (e.g., `0.1.0` → `0.1.5`) or go backwards (`0.1.2` when current is `0.1.3`), **push back**. Explain the conflict and ask them to confirm or correct. Do not silently accept an out-of-sequence version.
5. If `package.json#version` already disagrees with the latest published version, note the discrepancy. The local version will be updated to the new version during Step 5 regardless.

### Step 5: Apply version bump (3 package.json files synced)

After user confirms the version, update in this order:

1. `package.json` — set `version`
2. `apps/mcp/package.json` — set `version` to the same value
3. `apps/dashboard/package.json` — set `version` to the same value
4. `CHANGELOG.md` — prepend the new entry just below the `# Changelog` header

The three `package.json` files stay in sync because the repo is conceptually one product even though the CLI and the two apps publish via different paths. A future contributor reading `apps/mcp/package.json` should be able to tell at a glance "what shipped together with this version of the MCP server" without cross-referencing.

Use `node -p "..."` or `jq` for the bumps so the file's existing key ordering and indentation stay stable. Show the user the diff before continuing.

If the optional `tag-release.js` flow is appropriate (the bundle has a real SHA pinned in `expectedBundleSha`, not the placeholder), `npm run tag-release` can do the bump as well. For v0.1 internal where the SHA is still the placeholder, do the manual update — the `prepublishOnly` guard would block `tag-release.js` anyway.

### Step 6: Wait for explicit "push" confirmation

Display:

```
Ready to ship v<X.Y.Z>

Files to commit: <count>
  package.json
  apps/mcp/package.json
  apps/dashboard/package.json
  CHANGELOG.md
  <plus other modified files from Step 2>

Commit message (first line): <type>(<scope>): <summary>
GitHub release: vX.Y.Z — <title>

Say "push" to commit, push, tag, and trigger the publish workflow.
```

Do NOT commit, push, tag, or release until the user explicitly says "push" (or an equivalent — "ship it", "go", "yes push" all count; ambiguous responses do not — ask again if unsure).

### Step 7: Execute ship

After user confirms with "push":

1. **Stage specific files** by name. Never `git add -A` or `git add .` — staging-by-name is the discipline that prevents accidentally publishing a `.env`, an editor swap file, or an `apps/mcp/.dev.vars` with a token in it. The list comes from Steps 2 + 5.

   ```bash
   git add package.json apps/mcp/package.json apps/dashboard/package.json CHANGELOG.md <other-modified-files>
   ```

2. **Commit with the approved message via HEREDOC** (so multi-line + special characters survive):

   ```bash
   git commit -m "$(cat <<'EOF'
   <type>(<scope>): <summary>

   ## What changed
   - ...

   ## Why
   ...

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

3. **`git pull --rebase`** before pushing. If anyone else has pushed to `main` while this skill was running, rebase cleanly on top. If the rebase fails (real conflict), abort the rebase, surface the conflict to the user, and let them resolve before continuing — never force-push to recover.

4. **`git push`** — push the commit to `main`.

5. **`git tag v<X.Y.Z>`** then **`git push --tags`** — the tag push triggers `publish-internal.yml`. **Do NOT also run `gh workflow run publish-internal.yml`** — the workflow's tag-trigger and the manual trigger would race, double-publishing or causing the version-vs-tag check in the workflow to fail unpredictably.

6. **Print the Actions URL** so the user can watch the publish in real time:
   ```
   https://github.com/VegaStack/vegastack-cli/actions/workflows/publish-internal.yml
   ```

### Step 8: Post-ship verification

Watch the workflow run, then verify the package landed:

1. Watch the run live (blocking; ~3-5 min):
   ```bash
   gh run watch --exit-status
   ```
   Exit code 0 means the publish succeeded. Non-zero means investigate before declaring victory.

2. Confirm the new version is in GitHub Packages:
   ```bash
   gh api /orgs/VegaStack/packages/npm/cli/versions --jq '.[0].name'
   ```
   Should return the version you just shipped.

3. Print an install snippet for testers (paste this in Slack / wherever you announce internal releases):
   ```
   v<X.Y.Z> is live in GitHub Packages.

   Install on a fresh machine:
     # ~/.npmrc one-time setup
     @vegastack:registry=https://npm.pkg.github.com
     //npm.pkg.github.com/:_authToken=ghp_<your_PAT_with_read:packages>

     # then
     VEGASTACK_SKIP_POSTINSTALL=1 npm i -g @vegastack/cli@<X.Y.Z>
     export VEGASTACK_BUNDLE_DIR=/path/to/local/bundle/dev/tree
     vegastack doctor
     vegastack tf "S3 bucket with versioning"
   ```

If anything in this verification fails (workflow non-zero, package missing, install crash on a fresh machine), do not move on. Surface the exact failure mode to the user — silent breakage is the worst outcome of a release.

## Rules

- **Never commit or push without explicit user confirmation of "push"** (or equivalent unambiguous go-ahead).
- **Never use `git add -A` or `git add .`** — always stage by name.
- **Always `git pull --rebase` before push.** Never force-push.
- **`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`** trailer is mandatory on every commit.
- **Never trigger `publish-internal.yml` manually** — the `git push --tags` is the only correct trigger.
- **Never bypass the `prepublishOnly` guard locally** — only CI bypasses, via the `VEGASTACK_ALLOW_PENDING_BUNDLE_SHA=1` env var that the workflow already sets.
- **Never modify `release.yml`** (the dormant public-npm workflow) as part of a v0.1 ship.
- **Never touch the bundle repo (`engg-vegastack-agent-tf-providers`)** as part of a CLI ship — the bundle has its own daily release cron.
- **Never invoke `wrangler deploy` for `apps/mcp` or `apps/dashboard`** — Cloudflare Workers Builds handles those automatically on push to main.
- **If push fails, diagnose** — never `--force` or `--force-with-lease` to recover.
- **If the doc audit (Step 3) finds nothing to update, say so explicitly** — silence is ambiguous; the user should know the audit ran, not assume.
