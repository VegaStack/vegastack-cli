# Team protocol — read this first

You are one of 8 Phase-3 execute teams shipping vegastack-cli v0.1. Other 7 teams are working in parallel right now in different folders. Your scope is bounded by your task brief; do NOT touch files outside it without writing a note to `/tmp/exec-status/<your-team-id>/cross-team-touch.md` explaining why.

## Hard rules

1. **Web-search before installing ANY npm/pip/cargo package.** Use WebSearch + WebFetch for the package's npm page or GitHub releases page. Pin the latest STABLE (not RC, not beta) version unless a beta is required for a documented feature.

2. **Read the synthesis plan and contracts before writing code:**
   - `/tmp/synthesis/v1-plan.md` — full plan (your team is one row in §3)
   - `/tmp/synthesis/contracts/v0.1-overrides.md` — v0.1 deltas that override plan §6 §7
   - `/tmp/synthesis/contracts/discover-types.ts` — the canonical envelope type
   - `/tmp/synthesis/contracts/manifest.schema.json` — the canonical per-provider manifest schema
   - `/tmp/synthesis/contracts/format-examples.md` — knowledge / recipe / alias / companion / eval-prompt formats
   - `/tmp/synthesis/inputs/R{1..5}.md` — research that backed the plan; dive into a specific R when you need detail

3. **Preserve the contract.** If you find the contract files have a real flaw, do NOT silently change them. Write `/tmp/exec-status/<your-team-id>/contract-issue.md` describing the flaw and the proposed change, and pick the closest workable interpretation in your code.

4. **Use the right repo:**
   - CLI: `/Users/mk/projects/vegastack-cli/`
   - Bundle: `/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers/`
   - References (READ-ONLY): `/Users/mk/projects/references/{qmd,pagefind,zoekt,gh-cli,anthropic-skills,ripgrep-all,google-workspace-cli}`
   - New apps: create them under `/Users/mk/projects/vegastack-cli/apps/{mcp,dashboard}/` (E7, E8 only)

5. **Do not run `git push`. Do not create commits.** Stop at "ready to commit" — the user reviews diffs and commits manually.

6. **Cross-OS:** macOS / Linux / WSL. Use `node:path` everywhere; never literal `/` or `\` in paths.

7. **Write a status note to `/tmp/exec-status/<your-team-id>/STATUS.md` when you finish:**
   - What you changed (file list with LOC delta)
   - What you web-searched and the version you pinned (one line per package)
   - What's BLOCKED on another team (with team-id and why)
   - What's left for the audit team to verify
   - Any contract issues raised

8. **Tests:** every team that ships code ships tests. No exceptions.

9. **No documentation files unless the user explicitly asked for one.** The plan, the SKILL.md rewrite (E5 only), and per-package README.md (E7, E8 only) are pre-authorized.

10. **Verify your build passes before declaring done.** If your repo has a build/typecheck/lint, run it. Report the exit code in your STATUS.md.

## Reporting back

When complete, your final message back to the orchestrator should include:
- A 200-word summary of what shipped
- The final list of files changed/added (one line each, with LOC delta)
- The list of `npm install` commands you ran (with versions)
- Any open questions for the user
- Your STATUS.md path

Time budget: 60–120 minutes wall-clock per team. If you hit a true blocker (contract gap, missing dep upstream, ambiguous spec), write the blocker to STATUS.md and exit gracefully — do NOT spend tokens spinning.
