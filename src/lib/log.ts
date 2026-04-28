// Logging helpers. Color via kleur but degrade silently if NO_COLOR or non-TTY.
// Honors a process-wide quiet mode (set via setQuiet(true) from `vegastack ... -q`).

import kleur from "kleur";
import { VegastackError, asVegastackError } from "./errors.js";

const isTTY = process.stderr.isTTY && !process.env.NO_COLOR;
if (!isTTY) kleur.enabled = false;

let QUIET = false;
let JSON_MODE = false;

/** Enable quiet mode: only error-level lines are written to stderr. */
export function setQuiet(v: boolean): void {
  QUIET = v;
}
/** Indicate that JSON is the canonical output channel for this run. */
export function setJsonMode(v: boolean): void {
  JSON_MODE = v;
}

function write(line: string, force = false): void {
  if (QUIET && !force) return;
  process.stderr.write(line);
}

export const log = {
  info(msg: string): void {
    write(`${kleur.dim("vegastack")} ${msg}\n`);
  },
  ok(msg: string): void {
    write(`${kleur.green("✓")} ${msg}\n`);
  },
  warn(msg: string): void {
    write(`${kleur.yellow("⚠")} ${msg}\n`);
  },
  err(msg: string): void {
    // Errors always print, even in --quiet mode.
    write(`${kleur.red("✗")} ${msg}\n`, true);
  },
  step(msg: string): void {
    write(`${kleur.cyan("→")} ${msg}\n`);
  },
  /** Machine-readable output: always to stdout, never colored. */
  json(obj: unknown): void {
    process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
  },
};

/**
 * Render a thrown error to the user. In --json mode, emits the VegastackError's
 * `toJSON()` shape on stdout. Otherwise prints a 3-line block on stderr:
 * problem → cause (if any) → hint.
 *
 * Returns the VegastackError's exitCode, which the caller passes to process.exit.
 */
export function printError(e: unknown): number {
  const ve = e instanceof VegastackError ? e : asVegastackError(e);

  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify(ve.toJSON(), null, 2)}\n`);
    return ve.exitCode;
  }

  log.err(`${ve.kind}: ${ve.message}`);
  const cause = (ve as unknown as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== ve.message) {
    write(`  ${kleur.dim("cause:")} ${cause.message}\n`, true);
  }
  write(`  ${kleur.dim("hint:")}  ${ve.hint()}\n`, true);
  return ve.exitCode;
}
