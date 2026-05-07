// Contract test: every exit code advertised in the `--help` block must be
// reachable from a real `VegaStackErrorKind` (or an explicitly documented
// commander/usage code). This guards against documentation drift between
// `src/cli.ts` and `src/lib/errors.ts`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../../src/lib/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliSource = readFileSync(resolve(here, "../../src/cli.ts"), "utf8");

/** Codes that are intentionally not produced by a `VegaStackErrorKind` —
 *  they come from elsewhere (commander usage errors, raw `process.exit`). */
const KNOWN_NON_KIND_CODES = new Set<number>([0, 1]);

function parseHelpExitCodes(src: string): Map<number, string> {
  const start = src.indexOf("Exit codes:");
  expect(start, "cli.ts must advertise an `Exit codes:` block").toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("Report bugs", start));
  const out = new Map<number, string>();
  for (const line of block.split("\n")) {
    const m = /^\s{2,}(\d+)\s{2,}(.+)$/.exec(line);
    const code = m?.[1];
    const desc = m?.[2];
    if (code !== undefined && desc !== undefined) out.set(Number(code), desc.trim());
  }
  return out;
}

describe("exit-code contract", () => {
  const advertised = parseHelpExitCodes(cliSource);
  const mappedValues = new Set(Object.values(EXIT_CODES));

  it("advertises a non-empty exit-code rubric in --help", () => {
    expect(advertised.size).toBeGreaterThan(5);
  });

  it("every advertised exit code is reachable from EXIT_CODES (or is a documented non-kind code)", () => {
    const orphans: number[] = [];
    for (const code of advertised.keys()) {
      if (KNOWN_NON_KIND_CODES.has(code)) continue;
      if (!mappedValues.has(code)) orphans.push(code);
    }
    expect(orphans, `advertised codes with no VegaStackErrorKind: ${orphans.join(", ")}`).toEqual(
      [],
    );
  });

  it("every EXIT_CODES value (except 1=Unknown) is advertised in --help", () => {
    const missing: [string, number][] = [];
    for (const [kind, code] of Object.entries(EXIT_CODES)) {
      if (code === 1) continue; // Unknown is implicit
      if (!advertised.has(code)) missing.push([kind, code]);
    }
    expect(missing, `EXIT_CODES not in help: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("Ambiguous kind exists and maps to 3 (matches help text)", () => {
    expect((EXIT_CODES as Record<string, number>).Ambiguous).toBe(3);
  });
});
