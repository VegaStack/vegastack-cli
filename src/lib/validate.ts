// Path-safety validators. Use these on any path that came from user input
// (CLI args, env vars, config files) before passing it to fs.* or
// child_process.spawn. Returns a canonicalized absolute path on success;
// throws VegastackError(ValidationError) on rejection.
//
// The threat model: an LLM-driven agent invokes `vegastack …`; an adversarial query
// could try to escape the intended write/read scope via `../` or null bytes,
// or hide path text in terminals via bidi-override / zero-width characters
// (the "Trojan Source" attack family).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VegastackError } from "./errors.js";

/**
 * Codepoint ranges that have no legitimate use in a CLI path argument:
 *   U+0000–U+001F  C0 control
 *   U+007F         DEL
 *   U+0080–U+009F  C1 control
 *   U+200B–U+200F  zero-width + LRM/RLM
 *   U+202A–U+202E  embedding / override (bidi attack vector)
 *   U+2066–U+2069  isolates
 *
 * Built from a string literal (ASCII source, hex escapes only) so the source
 * file is editor-portable and lints clean.
 */
// We deliberately match control characters here — that's the rule's purpose.
/* eslint-disable no-control-regex */
const DANGEROUS_CHARS = new RegExp(
  "[\\u0000-\\u001F\\u007F\\u0080-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "u",
);
/* eslint-enable no-control-regex */

/** Throw VegastackError if the input contains dangerous chars. */
export function rejectDangerousChars(input: string, fieldName = "path"): void {
  if (DANGEROUS_CHARS.test(input)) {
    throw new VegastackError(
      "ValidationError",
      `${fieldName} contains control or bidi-override characters; refusing to use it.`,
      { context: { field: fieldName } },
    );
  }
}

/**
 * Realpath a directory if it exists, otherwise return the normalized path
 * unchanged. We need this for TOCTOU-safe containment checks on macOS, where
 * `/var/folders/...` realpaths to `/private/var/folders/...` and a naïve
 * containment check will reject otherwise-legitimate paths.
 */
function realpathIfExists(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.normalize(p);
  }
}

/**
 * Validate that an output dir is safe to write to. Resolves it relative to
 * `cwd`, ensures it doesn't escape via `..`, and refuses anything that resolves
 * outside the user's home or the supplied `allowedRoots`.
 *
 * Returns the canonical absolute path. Creates the directory if it doesn't
 * exist.
 *
 * Containment is checked against **realpath'd allowed roots**. This closes the
 * TOCTOU window where a symlink in the path could swap between the existence
 * check and the read.
 */
export function validateSafeOutputDir(
  input: string,
  options?: { allowedRoots?: string[]; cwd?: string },
): string {
  rejectDangerousChars(input, "output dir");

  const cwd = options?.cwd ?? process.cwd();
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input);
  const normalized = path.normalize(absolute);

  // Realpath both sides so macOS /var/folders/... matches /private/var/folders/...
  const realInput = realpathIfExists(normalized);
  const allowed = (options?.allowedRoots ?? [os.homedir(), cwd, os.tmpdir()]).map((r) =>
    realpathIfExists(path.normalize(path.resolve(r))),
  );

  if (!allowed.some((root) => isWithin(realInput, root))) {
    throw new VegastackError(
      "ValidationError",
      `output dir is outside the allowed roots: ${realInput}`,
      { context: { input, normalized, real: realInput, allowed } },
    );
  }

  // Create if missing. Use the original path so the user-visible output
  // matches what they passed.
  fs.mkdirSync(normalized, { recursive: true });

  return normalized;
}

/**
 * Validate that an existing file path is safe to read. Resolves symlinks,
 * checks containment in **realpath'd allowed roots**, and rejects path
 * traversal.
 */
export function validateSafeFilePath(
  input: string,
  options?: { allowedRoots?: string[]; cwd?: string; mustExist?: boolean },
): string {
  rejectDangerousChars(input, "file path");

  const cwd = options?.cwd ?? process.cwd();
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input);
  const normalized = path.normalize(absolute);

  // Realpath the allowed roots once, up-front. We compare against this list
  // both before and (if the file exists) after resolving symlinks.
  const allowedReal = (options?.allowedRoots ?? [os.homedir(), cwd, os.tmpdir()]).map((r) =>
    realpathIfExists(path.normalize(path.resolve(r))),
  );

  if (options?.mustExist === true) {
    if (!fs.existsSync(normalized)) {
      throw new VegastackError("ValidationError", `file does not exist: ${normalized}`, {
        context: { input },
      });
    }
    // Realpath-resolve the input. This is the single canonical path we'll
    // both authorize and return; there's no second read after this so no
    // TOCTOU window remains.
    const real = fs.realpathSync(normalized);
    if (!allowedReal.some((root) => isWithin(real, root))) {
      throw new VegastackError(
        "ValidationError",
        `file resolves through a symlink to a path outside the allowed roots: ${real}`,
        { context: { input, real, allowed: allowedReal } },
      );
    }
    return real;
  }

  // File doesn't need to exist (e.g., we're going to create it). Containment
  // is on the input itself, against realpath'd roots.
  const realInput = realpathIfExists(normalized);
  if (!allowedReal.some((root) => isWithin(realInput, root))) {
    throw new VegastackError("ValidationError", `file path is outside the allowed roots: ${realInput}`, {
      context: { input, normalized, real: realInput, allowed: allowedReal },
    });
  }
  return normalized;
}

/** True iff `child` is the same as or a subdirectory of `parent`. */
export function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  // Empty string = exact match; absolute or `..`-leading rel = escape.
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
