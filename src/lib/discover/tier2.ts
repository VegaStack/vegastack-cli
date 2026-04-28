// Tier 2: grep fallback. Lights up only when Tier 1's quality gate wasn't
// met. Four passes:
//   A. exact resource-name fixed-string grep (skip generic/short tokens)
//   B. filename-glob find
//   C. multi-token alternation regex (extended)
//   D. phrase grep (only if scores still <5 and ≥2 tokens)
//
// We prefer ripgrep (`rg`) when on PATH — 5–10× faster, structured output.
// Falls back to POSIX `grep`/`find` otherwise.
//
// New in v0.1: the ripgrep-availability cache is keyed by hashed PATH. A
// long-running process whose PATH changes (devcontainer rebind, dev shell)
// recomputes detection. `clearCaches()` is exported for tests. Closes F18.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { Scorer } from "./scoring.js";
import { TIER2_GREP_SKIP } from "./constants.js";
import type { ScoredFile } from "./types.js";

const GREP_TIMEOUT_MS = 10_000;
const FIND_TIMEOUT_MS = 5_000;
const MIN_TOKEN_LEN_FOR_GREP = 4;

const SUBPROCESS_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "PATHEXT",
];

interface RgCacheEntry {
  pathHash: string;
  available: boolean;
}

let RIPGREP_AVAILABLE_CACHE: RgCacheEntry | null = null;

function hashPath(): string {
  return createHash("sha256")
    .update(process.env.PATH ?? "")
    .digest("hex");
}

function isRipgrepAvailable(): boolean {
  const ph = hashPath();
  if (RIPGREP_AVAILABLE_CACHE && RIPGREP_AVAILABLE_CACHE.pathHash === ph) {
    return RIPGREP_AVAILABLE_CACHE.available;
  }
  const r = spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 2000 });
  const available = r.status === 0;
  RIPGREP_AVAILABLE_CACHE = { pathHash: ph, available };
  return available;
}

/** Reset all module-level caches. Used in tests; safe to call any time. */
export function clearCaches(): void {
  RIPGREP_AVAILABLE_CACHE = null;
}

function minimalEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of SUBPROCESS_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function runSafe(cmd: string, args: string[], timeoutMs: number): string[] {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    env: minimalEnv(),
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.error !== undefined || r.status !== 0) return [];
  return r.stdout.split("\n").filter((s) => s.length > 0);
}

function grepFixed(fixed: string, providerDir: string): string[] {
  if (!fs.existsSync(providerDir)) return [];
  if (isRipgrepAvailable()) {
    return runSafe(
      "rg",
      ["--no-config", "-l", "-F", "-i", "-g", "*.markdown", "-g", "*.md", "--", fixed, providerDir],
      GREP_TIMEOUT_MS,
    );
  }
  return runSafe(
    "grep",
    ["-rlFi", "--include=*.markdown", "--include=*.md", "--", fixed, providerDir],
    GREP_TIMEOUT_MS,
  );
}

function grepRegex(pattern: string, providerDir: string): string[] {
  if (!fs.existsSync(providerDir)) return [];
  if (isRipgrepAvailable()) {
    return runSafe(
      "rg",
      ["--no-config", "-l", "-i", "-g", "*.markdown", "-g", "*.md", "--", pattern, providerDir],
      GREP_TIMEOUT_MS,
    );
  }
  return runSafe(
    "grep",
    ["-rlEi", "--include=*.markdown", "--include=*.md", "--", pattern, providerDir],
    GREP_TIMEOUT_MS,
  );
}

function findByName(patterns: string[], providerDir: string): string[] {
  if (!fs.existsSync(providerDir) || patterns.length === 0) return [];
  const args: string[] = [providerDir, "-type", "f", "("];
  patterns.forEach((p, i) => {
    if (i > 0) args.push("-o");
    args.push("-name", `*${p}*`);
  });
  args.push(")");
  return runSafe("find", args, FIND_TIMEOUT_MS);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface Tier2Args {
  tokens: string[];
  provider: string;
  providerDir: string;
}

export function tier2(args: Tier2Args): ReadonlyMap<string, ScoredFile> {
  const { tokens, provider, providerDir } = args;
  const scorer = new Scorer();

  const addGrep = (
    filepath: string,
    score: number,
    kind: "grep_resource" | "filename_glob" | "content_grep" | "phrase_grep",
    detail: string,
  ) => {
    const before = scorer.toMap().get(filepath);
    scorer.add(filepath, score, kind, detail);
    const after = scorer.toMap().get(filepath);
    if (after && before === undefined) (after as { tier: ScoredFile["tier"] }).tier = "grep";
  };

  // A. Exact resource-name grep ("provider_token").
  for (const t of tokens) {
    if (TIER2_GREP_SKIP.has(t) || t.length < MIN_TOKEN_LEN_FOR_GREP) continue;
    const fixed = `${provider}_${t}`;
    for (const f of grepFixed(fixed, providerDir)) {
      addGrep(f, 80, "grep_resource", fixed);
    }
  }

  // B. Filename glob.
  const longTokens = tokens.filter((t) => t.length >= 3);
  if (longTokens.length > 0) {
    for (const f of findByName(longTokens, providerDir)) {
      addGrep(f, 70, "filename_glob", "");
    }
  }

  // C. Multi-token alternation.
  if (tokens.length > 0) {
    const altPat = tokens.slice(0, 5).map(escapeRegExp).join("|");
    for (const f of grepRegex(altPat, providerDir)) {
      addGrep(f, 40, "content_grep", altPat);
    }
  }

  // D. Phrase grep (last-resort, only when results are still thin).
  if (scorer.size() < 5 && tokens.length >= 2) {
    const phrase = tokens.slice(0, 3).join(" ");
    for (const f of grepFixed(phrase, providerDir)) {
      addGrep(f, 30, "phrase_grep", phrase);
    }
  }

  return scorer.toMap();
}

/** For tests: sneak-peek at the cache state. */
export function _ripgrepCacheForTesting(): RgCacheEntry | null {
  return RIPGREP_AVAILABLE_CACHE;
}
