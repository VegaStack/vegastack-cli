// `vega tf <query>` — runtime discovery command. Returns the v0.1 JSON envelope.
//
// Flags:
//   --provider <p>     force a provider (validated against bundle's providers list)
//   --max <N>          cap the files[] length (default 20)
//   --raw              skip enrichment (smaller envelope)
//   --brief            strip manifest_entry + example_usage; add name field; ~80% smaller
//   --full-examples    restore full example_usage (default: truncated to first HCL block)
//   --pretty           pretty-print JSON (default: TTY auto-detect)
//   --debug            include per-stage timings
//   --json-schema      print the JSON Schema for the envelope and exit
//
// Token-efficiency flags (E1–E2):
//   --brief         Strips manifest_entry and example_usage from each files[] entry,
//                   adds a `name` field (resource name, e.g. "aws_s3_bucket"), and
//                   sets mode: "brief" in the envelope. Use for survey / multi-call
//                   dispatch where you only need to know which resources exist.
//                   Envelope is typically ~80% smaller than the default.
//   --full-examples Restores the full ## Example Usage section (pre-E2 behavior).
//                   Default (no flag) truncates to the first HCL fenced block plus a
//                   "... (truncated; pass --full-examples for the rest)" marker.
//                   NOTE: the new default (E2) is a soft-breaking change for callers
//                   that relied on the full example body without --full-examples.
//
// Side effect: sets $VEGA_BUNDLE in the environment so callers (e.g. SKILL.md
// shell snippets) can run additional `jq` queries against the bundle root.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discover } from "../lib/discover.js";
import { bundleDir } from "../lib/paths.js";
import { log, printError } from "../lib/log.js";
import { VegaError } from "../lib/errors.js";

export interface TfOptions {
  provider?: string;
  max?: number;
  /** Skip enrichment (manifest_entry + example_usage). Smaller envelope. */
  raw: boolean;
  /**
   * E1: Brief mode — strips manifest_entry and example_usage, adds name field.
   * Produces ~80% smaller envelopes. Sets mode: "brief" in the envelope.
   * Use for survey / multi-call dispatch. Default false.
   */
  brief: boolean;
  /**
   * E2: Restore full example_usage content (pre-truncation behavior).
   * Default (no flag): truncates to first HCL fenced block + marker.
   * NOTE: the default truncation (E2) is a soft-breaking change.
   */
  fullExamples: boolean;
  /** Pretty-print JSON. Default true if stdout is a TTY. */
  pretty: boolean;
  /** Include per-stage timings under `timings`. */
  debug: boolean;
  /** Print the JSON Schema for the envelope and exit (no discovery run). */
  jsonSchema?: boolean;
}

export async function runTf(query: string, opts: TfOptions): Promise<number> {
  if (opts.jsonSchema) {
    return printSchema();
  }

  if (!query || query.trim() === "") {
    return printError(
      new VegaError(
        "ValidationError",
        'usage: vega tf "<natural-language query>" [--provider <p>] [--max <N>]',
      ),
    );
  }

  // Set $VEGA_BUNDLE so any downstream `jq` / `rg` shell call from a SKILL.md
  // snippet can target the bundle directly. Closes a SKILL.md drift.
  process.env.VEGA_BUNDLE = bundleDir();

  try {
    const args: {
      query: string;
      provider?: string;
      max?: number;
      raw?: boolean;
      debug?: boolean;
      brief?: boolean;
      fullExamples?: boolean;
    } = {
      query,
      raw: opts.raw,
      debug: opts.debug,
      brief: opts.brief,
      fullExamples: opts.fullExamples,
    };
    if (opts.provider !== undefined) args.provider = opts.provider;
    if (opts.max !== undefined) args.max = opts.max;
    const result = await discover(args);
    const json = opts.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
    process.stdout.write(json + "\n");
    if (result.status === "error") return 2;
    if (result.status === "ambiguous") {
      log.warn("query is ambiguous; consider --provider to disambiguate");
      return 3;
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function printSchema(): number {
  // The schema is shipped beside the manifest schema in the bundle, but
  // for v0.1 we ship a derived envelope schema next to the CLI source so
  // `vega tf --json-schema` works even before any bundle is installed.
  // We bundle it as a const string at build time via tsc.
  const schema = envelopeSchema();
  process.stdout.write(JSON.stringify(schema, null, 2) + "\n");
  return 0;
}

/** Returns the JSON Schema for the v0.1 DiscoverResult envelope. */
function envelopeSchema(): unknown {
  // Try to load from the installed bundle (canonical location). Fall back to
  // the package-local copy that ships beside the CLI for offline / air-gap.
  const bundleSchema = join(bundleDir(), "schema", "envelope.schema.json");
  for (const candidate of [bundleSchema, packageSchemaPath()]) {
    try {
      const raw = readFileSync(candidate, "utf8");
      return JSON.parse(raw);
    } catch {
      /* try next */
    }
  }
  // Last resort: emit a minimal inline placeholder so `--json-schema` always
  // produces something valid. v0.1 ships the real one via E1.
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://vegastack.com/schemas/discover-envelope-v1.json",
    title: "Vegastack discover envelope (v0.1)",
    type: "object",
    required: ["status", "query"],
    properties: {
      status: { enum: ["ok", "ambiguous", "error"] },
      query: { type: "string" },
    },
  };
}

function packageSchemaPath(): string {
  // dist/commands/tf.js → ../../schema/envelope.schema.json (when shipped)
  // src/commands/tf.ts (dev)  → ../../schema/envelope.schema.json
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "schema", "envelope.schema.json");
}
