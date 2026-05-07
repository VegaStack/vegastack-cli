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

const CONVENTIONS_BODY = `# VegaStack conventions (managed by @vegastack/cli)

When the user asks about infrastructure, cloud operations, CI/CD, Terraform,
or any installed VegaStack Registry pack, invoke the local CLI before answering:

    vegastack ask "<the user's request, in natural language>"

For Terraform work, specify both the Registry pack and provider:

    vegastack ask --entry terraform --tf-provider <provider> "<query>"

The response is one JSON envelope with four channels:

  knowledge[]              - date-stamped recent-change cards; read first
  recipes[]                - cross-provider topology scaffolds
  files[] or results[]     - ranked docs with citations and metadata
  concept_aliases_used[]   - NL phrase to source mapping

Hard rules:

- Never invent resource names, arguments, workflow keys, CLI flags, or fields.
- For Terraform, if it isn't in files[].manifest_entry, it doesn't exist.
- Never fabricate import IDs. Use manifest_entry.import_syntax.command.
- Respect deprecated:true - tell the user before writing code.
- Cite citations[] (file paths + knowledge-card / recipe IDs) in your reply.

If \`vegastack\` isn't on PATH, run \`npm i -g @vegastack/cli\` and \`vegastack init\`.
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
      const item = cur
        .replace(/^\s+-\s+/, "")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (item) out.read.push(item);
      i++;
    }
  }
  return out;
}

/**
 * Audit F-004: minimal in-place insertion of `entry` into `read[]`.
 *
 * Reparsing+reserializing the YAML drops user comments, reorders keys, and
 * collapses flow lists into block lists. Aider treats `.aider.conf.yml` as
 * user-owned config — we should never reformat it. Strategy:
 *
 *   1. If the file has no `read:` key, append a fresh block at the end.
 *   2. If `read:` is a flow list (`read: [a, b]`), append `, entry` inside.
 *   3. If `read:` is a single-value scalar (`read: foo.md`), convert to
 *      a 2-element flow list (the smallest possible diff).
 *   4. If `read:` is a block list, splice `  - entry` after the last
 *      continuation line.
 *
 * In every branch we touch only the lines that need to change. The user's
 * comments, blank lines, ordering, and inline `# notes` are preserved
 * verbatim.
 *
 * Returns the new file contents or `null` if `entry` is already present.
 */
function appendReadEntry(text: string, entry: string): string | null {
  const lines = text.split(/\r?\n/);
  // Track whether the file ended with a trailing newline so we can preserve it.
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = /^read\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const tail = m[1] ?? "";

    if (tail.startsWith("[") && tail.endsWith("]")) {
      // Flow list. Check membership first.
      const items = tail
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      if (items.includes(entry)) return null;
      // Append before closing bracket — preserves any inline comment after.
      const insertion = items.length === 0 ? entry : `, ${entry}`;
      // Replace last `]` of this segment.
      const closeIdx = line.lastIndexOf("]");
      lines[i] = `${line.slice(0, closeIdx)}${insertion}${line.slice(closeIdx)}`;
      return lines.join("\n") + (trailingNewline ? "\n" : "");
    }

    if (tail !== "" && !tail.startsWith("#")) {
      // Single-value scalar. Convert to flow list with original + entry.
      const orig = tail.replace(/^["']|["']$/g, "");
      if (orig === entry) return null;
      lines[i] = `read: [${orig}, ${entry}]`;
      return lines.join("\n") + (trailingNewline ? "\n" : "");
    }

    // Block list — find the last continuation line and splice after it.
    let j = i + 1;
    let lastBlockIdx = i;
    while (j < lines.length) {
      const cur = lines[j] ?? "";
      const itemMatch = /^\s+-\s+(.*?)\s*$/.exec(cur);
      if (itemMatch) {
        const item = (itemMatch[1] ?? "").replace(/^["']|["']$/g, "").trim();
        if (item === entry) return null;
        lastBlockIdx = j;
        j++;
        continue;
      }
      // Indented blank/comment lines belong to the block too.
      if (cur.trim() === "" || /^\s+#/.test(cur)) {
        j++;
        continue;
      }
      break;
    }
    lines.splice(lastBlockIdx + 1, 0, `  - ${entry}`);
    return lines.join("\n") + (trailingNewline ? "\n" : "");
  }

  // No `read:` key found — append a fresh block at end of file.
  while (lines.length && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  lines.push("read:");
  lines.push(`  - ${entry}`);
  return lines.join("\n") + "\n";
}

/**
 * Audit F-004 (uninstall side): remove a previously-inserted entry from
 * read[] without touching surrounding lines, comments, or formatting.
 * Returns null if the entry was not present.
 *
 * `entryAliases` is the set of strings any of which match (e.g. the
 * absolute path we wrote and the relative form we now prefer).
 */
function removeReadEntry(text: string, entryAliases: readonly string[]): string | null {
  const lines = text.split(/\r?\n/);
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();

  const matches = (s: string): boolean => entryAliases.includes(s);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^read\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const tail = m[1] ?? "";

    if (tail.startsWith("[") && tail.endsWith("]")) {
      const items = tail
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      const kept = items.filter((it) => !matches(it));
      if (kept.length === items.length) continue;
      lines[i] = `read: [${kept.join(", ")}]`;
      changed = true;
      continue;
    }

    if (tail !== "" && !tail.startsWith("#")) {
      const orig = tail.replace(/^["']|["']$/g, "");
      if (matches(orig)) {
        lines.splice(i, 1);
        i--;
        changed = true;
      }
      continue;
    }

    // Block list — drop matching `  - <entry>` continuation lines.
    let j = i + 1;
    while (j < lines.length) {
      const cur = lines[j] ?? "";
      const itemMatch = /^\s+-\s+(.*?)\s*$/.exec(cur);
      if (itemMatch) {
        const item = (itemMatch[1] ?? "").replace(/^["']|["']$/g, "").trim();
        if (matches(item)) {
          lines.splice(j, 1);
          changed = true;
          continue;
        }
        j++;
        continue;
      }
      if (cur.trim() === "" || /^\s+#/.test(cur)) {
        j++;
        continue;
      }
      break;
    }
  }

  if (!changed) return null;
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

/**
 * Audit F-005: for project scope we must write a *relative* path into
 * `.aider.conf.yml` so the file remains portable when committed. Global
 * scope keeps the absolute form (the home-level conf is per-machine).
 */
function relativeToConfDir(scope: Scope, conf: string, conv: string): string {
  if (scope !== "project") return conv;
  const rel = path.relative(path.dirname(conf), conv);
  // path.relative on posix returns "" when same dir; guard against that.
  return rel === "" ? path.basename(conv) : rel;
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
        const rel = relativeToConfDir(ctx.scope, conf, conv);
        referenced =
          parsed.read.includes(conv) ||
          parsed.read.includes(rel) ||
          parsed.read.includes(path.basename(conv));
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
          : [
              `Conventions file present but not referenced — re-run \`vegastack skills install --agent aider --force\`.`,
            ]
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

    // 2) Patch .aider.conf.yml — add `entry` to read[] iff not already there.
    //    Audit F-004: minimal in-place edit (preserves user comments / order).
    //    Audit F-005: write a relative path for project scope so the conf
    //                 file stays portable across machines/CI.
    fs.mkdirSync(path.dirname(conf), { recursive: true });
    const entry = relativeToConfDir(ctx.scope, conf, conv);
    let raw = "";
    try {
      raw = fs.readFileSync(conf, "utf8");
    } catch {
      /* file absent — start empty */
    }
    // `appendReadEntry` returns null when the entry is already present
    // (under any form: relative, absolute, or basename).
    const parsedExisting = parseConf(raw);
    const aliases = new Set([entry, conv, path.basename(conv)]);
    const alreadyPresent = parsedExisting.read.some((r) => aliases.has(r));
    if (alreadyPresent) {
      result.notes.push(`already referenced in ${conf}`);
    } else {
      const next = appendReadEntry(raw, entry);
      if (next === null) {
        result.notes.push(`already referenced in ${conf}`);
      } else {
        fs.writeFileSync(conf, next, "utf8");
        result.notes.push(`patched ${conf} (added ${entry} to read[])`);
      }
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
        // Audit F-006 (companion): only remove the exact path(s) we wrote —
        // both the relative form (current install) and the absolute form
        // (legacy installs from before F-005). We deliberately do *not*
        // match `path.basename(conv)` alone, since a user's separate
        // `vendor/CONVENTIONS.vegastack.md` would share that basename.
        // The `removeReadEntry` text-edit approach (vs parse+rewrite) is
        // chosen so user comments and formatting in `.aider.conf.yml` are
        // preserved — see audit issue resolution for code-review/agents F-004.
        const raw = fs.readFileSync(conf, "utf8");
        const rel = relativeToConfDir(ctx.scope, conf, conv);
        const next = removeReadEntry(raw, [rel, conv]);
        if (next !== null) {
          fs.writeFileSync(conf, next, "utf8");
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
