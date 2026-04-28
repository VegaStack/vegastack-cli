---
"@vegastack/cli": minor
---

Initial release: `vega` CLI with `doctor`, `install`, `refresh`, `tf`, and `skills install|uninstall|status` commands. Active per-agent installers for Claude Code, Codex, Cursor, and Gemini. gws-pattern postinstall downloads the docs bundle from GitHub Releases (≈12 MB compressed → 97 MB on disk, covering 31 Terraform providers). v0.1 shells out to a bundled Python harness; v0.2 will replace it with a native TypeScript port that adds enrichment optimizations (full manifest entries + example_usage inline in `vega tf` output).
