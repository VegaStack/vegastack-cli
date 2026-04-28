// src/agents/aider.ts
//
// Aider renderer.
//
// Strategy: write a `CONVENTIONS.vegastack.md` file (so we never collide with
// the user's hand-curated CONVENTIONS.md), then patch `.aider.conf.yml` to
// reference it via `read: [...]`. Both writes are idempotent — the YAML
// patch deduplicates the read[] entry, and the conventions file is rewritten
// only when its content changes.
//
// Per aider.chat/docs/usage/conventions.html: aider treats files in `read[]`
// as read-only, marks them as cached if prompt caching is enabled, and
// auto-loads them at session start.

import * as fs from "node:fs";
import * as path from "node:path";

import { existsOrLink, removeIfExists } from "../lib/fs-utils.js";
import { aiderConfPath, aiderConventionsPath } from "../lib/paths.js";
import type { AgentRenderer, InstallContext, InstallResult, Scope } from "./types.js";

const CONVENTIONS_BODY = `# Vegastack Terraform conventions (managed by @vegastack/cli)

When the user asks about Terraform, HCL, or any of the providers covered by
the vegastack docs harness (AWS, Azure, GCP, Cloudflare, Kubernetes, Helm,
Vault, DigitalOcean, GitHub, GitLab, Vercel, Netlify, Datadog, Grafana,
Splunk, PagerDuty, Okta, Auth0, CrowdStrike, 1Password, MongoDB Atlas,
Snowflake, Redis Cloud, ClickHouse, Pinecone, Ansible, and the standard
utility providers), invoke the local CLI before writing HCL:

    vega tf "<the user's request, in natural language>"

The response is one JSON envelope with four channels:

  knowledge[]              — date-stamped recent-change cards; read FIRST
  recipes[]                — cross-provider topology scaffolds
  files[]                  — top-K resource docs, with manifest_entry +
                              example_usage inline (no follow-up jq/grep)
  concept_aliases_used[]   — NL phrase → resource mapping (transparency)

Hard rules:

- Never invent resource names or arguments. If it isn't in
  files[].manifest_entry (top-level or .blocks.*), it doesn't exist.
- Never fabricate import IDs. Use manifest_entry.import_syntax.command.
- Respect deprecated:true — tell the user before writing code.
- One provider per vega tf call; multi-provider work uses recipes[].
- Cite citations[] (file paths + knowledge-card / recipe IDs) in your reply.

If \`vega\` isn't on PATH, run \`npm i -g @vegastack/cli\` and \`vega install\`.
`;

interface ParsedConf {
  read: string[];
  /** Other lines, preserved verbatim. */
  otherLines: string[];
  hasReadKey: boolean;
}

function parseConf(text: string): ParsedConf {
  const lines = text.split(/\r?\n/);
  const out: ParsedConf = { read: [], otherLines: [], hasReadKey: false };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = /^read\s*:\s*(.*)$/.exec(line);
    if (!m) {
      out.otherLines.push(line);
      i++;
      continue;
    }
    out.hasReadKey = true;
    const tail = (m[1] ?? "").trim();

    if (tail.startsWith("[") && tail.endsWith("]")) {
      // Flow list: read: [a, b, c]
      const items = tail
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      out.read.push(...items);
      i++;
      continue;
    }
    if (tail !== "") {
      // Single-value scalar: read: foo.md
      out.read.push(tail.replace(/^["']|["']$/g, ""));
      i++;
      continue;
    }
    // Block list:
    //   read:
    //     - foo
    //     - bar
    i++;
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (!/^\s+-\s+/.test(cur)) break;
      const item = cur.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "");
      if (item) out.read.push(item);
      i++;
    }
  }
  return out;
}

function renderConf(parsed: ParsedConf): string {
  const lines = parsed.otherLines.slice();
  // Trim trailing blank lines (we'll re-add one).
  while (lines.length && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();

  if (parsed.read.length > 0) {
    lines.push("read:");
    for (const r of parsed.read) lines.push(`  - ${r}`);
  }
  lines.push("");
  return lines.join("\n");
}

class AiderRenderer implements AgentRenderer {
  readonly name = "aider";
  readonly displayName = "Aider";

  supportsScope(_scope: Scope): boolean {
    return true;
  }

  async status(ctx: InstallContext): Promise<InstallResult> {
    const conv = aiderConventionsPath(ctx.scope, ctx.cwd);
    const conf = aiderConfPath(ctx.scope, ctx.cwd);
    const convPresent = existsOrLink(conv);
    const confPresent = existsOrLink(conf);
    let referenced = false;
    if (confPresent) {
      try {
        const parsed = parseConf(fs.readFileSync(conf, "utf8"));
        referenced = parsed.read.includes(conv) || parsed.read.includes(path.basename(conv));
      } catch {
        /* ignore */
      }
    }
    return {
      agent: this.name,
      installed: convPresent && referenced,
      paths: [conv, conf],
      notes: convPresent
        ? referenced
          ? ["Conventions file present and referenced from .aider.conf.yml."]
          : [`Conventions file present but not referenced — re-run \`vega skills install --agent aider --force\`.`]
        : ["Not installed."],
      warnings: [],
    };
  }

  async install(ctx: InstallContext): Promise<InstallResult> {
    const conv = aiderConventionsPath(ctx.scope, ctx.cwd);
    const conf = aiderConfPath(ctx.scope, ctx.cwd);
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [conv, conf],
      notes: [],
      warnings: [],
    };

    if (ctx.dryRun) {
      result.notes.push(`would write ${conv}`);
      result.notes.push(`would patch ${conf} (read[] += "${conv}")`);
      return result;
    }

    // 1) Write conventions file (rewrite only when content differs).
    fs.mkdirSync(path.dirname(conv), { recursive: true });
    let convChanged = true;
    try {
      const onDisk = fs.readFileSync(conv, "utf8");
      if (onDisk === CONVENTIONS_BODY) convChanged = false;
    } catch {
      /* file absent → write fresh */
    }
    if (convChanged) {
      fs.writeFileSync(conv, CONVENTIONS_BODY, "utf8");
      result.notes.push(`wrote ${conv}`);
    } else {
      result.notes.push(`up to date: ${conv}`);
    }

    // 2) Patch .aider.conf.yml — add `conv` to read[] iff not already there.
    fs.mkdirSync(path.dirname(conf), { recursive: true });
    let raw = "";
    try {
      raw = fs.readFileSync(conf, "utf8");
    } catch {
      /* file absent — start empty */
    }
    const parsed = parseConf(raw);
    if (!parsed.read.includes(conv)) {
      parsed.read.push(conv);
      fs.writeFileSync(conf, renderConf(parsed), "utf8");
      result.notes.push(`patched ${conf} (added ${conv} to read[])`);
    } else {
      result.notes.push(`already referenced in ${conf}`);
    }

    result.installed = true;
    return result;
  }

  async uninstall(ctx: InstallContext): Promise<InstallResult> {
    const conv = aiderConventionsPath(ctx.scope, ctx.cwd);
    const conf = aiderConfPath(ctx.scope, ctx.cwd);
    const result: InstallResult = {
      agent: this.name,
      installed: false,
      paths: [conv, conf],
      notes: [],
      warnings: [],
    };

    if (ctx.dryRun) {
      if (existsOrLink(conv)) result.notes.push(`would remove ${conv}`);
      if (existsOrLink(conf)) result.notes.push(`would unpatch ${conf}`);
      if (result.notes.length === 0) result.notes.push("nothing to remove (not installed).");
      return result;
    }

    let removedSomething = false;
    if (existsOrLink(conv)) {
      removeIfExists(conv);
      result.notes.push(`removed ${conv}`);
      removedSomething = true;
    }

    if (existsOrLink(conf)) {
      try {
        const parsed = parseConf(fs.readFileSync(conf, "utf8"));
        const before = parsed.read.length;
        parsed.read = parsed.read.filter(
          (r) => r !== conv && r !== path.basename(conv),
        );
        if (parsed.read.length !== before) {
          fs.writeFileSync(conf, renderConf(parsed), "utf8");
          result.notes.push(`unpatched ${conf}`);
          removedSomething = true;
        }
      } catch (e) {
        result.warnings.push(`could not unpatch ${conf}: ${(e as Error).message}`);
      }
    }

    if (!removedSomething) result.notes.push("nothing to remove (not installed).");
    return result;
  }
}

export const aiderRenderer: AgentRenderer = new AiderRenderer();
