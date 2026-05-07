// Internal Terraform Registry pack discovery used by `vegastack ask --entry terraform`.
// This is not a public `vegastack terraform` command.
//
// Flags:
//   --provider <p>     internal force-provider option used by public --tf-provider
//   --max <N>          cap the files[] length (default 20)
//   --raw              skip enrichment (smaller envelope)
//   --brief            strip manifest_entry + example_usage; add name field; ~80% smaller
//   --full-examples    restore full example_usage (default: truncated to first HCL block)
//   --pretty           pretty-print JSON (default: TTY auto-detect)
//   --debug            include per-stage timings
//   --json-schema      print the JSON Schema for the envelope and exit
//
// Token-efficiency flags:
//   --brief         Strips manifest_entry and example_usage from each files[] entry,
//                   adds a `name` field (resource name, e.g. "aws_s3_bucket"), and
//                   sets mode: "brief" in the envelope. Use for survey / multi-call
//                   dispatch where you only need to know which resources exist.
//                   Envelope is typically ~80% smaller than the default.
//   --full-examples Restores the full ## Example Usage section (pre-E2 behavior).
//                   Default (no flag) truncates to the first HCL fenced block.
//
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discover } from "../lib/discover.js";
import { terraformEntryDocsDir } from "../lib/paths.js";
import { log, printError } from "../lib/log.js";
import { EXIT_CODES, VegaStackError } from "../lib/errors.js";

export interface TerraformDiscoverOptions {
  provider?: string;
  max?: number;
  /** Skip enrichment (manifest_entry + example_usage). Smaller envelope. */
  raw: boolean;
  /**
   * Brief mode strips manifest_entry and example_usage, then adds name.
   * Produces ~80% smaller envelopes. Sets mode: "brief" in the envelope.
   * Use for survey / multi-call dispatch. Default false.
   */
  brief: boolean;
  /**
   * Restore full example_usage content. Default truncates to first HCL block.
   */
  fullExamples: boolean;
  /** Pretty-print JSON. Default true if stdout is a TTY. */
  pretty: boolean;
  /** Include per-stage timings under `timings`. */
  debug: boolean;
  /** Print the JSON Schema for the envelope and exit (no discovery run). */
  jsonSchema?: boolean;
}

export async function runTerraformDiscover(
  query: string,
  opts: TerraformDiscoverOptions,
): Promise<number> {
  if (opts.jsonSchema) {
    return printSchema();
  }

  if (!query || query.trim() === "") {
    return printError(
      new VegaStackError(
        "ValidationError",
        'usage: vegastack ask --entry terraform --tf-provider <provider> "<natural-language query>"',
      ),
    );
  }

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
    if (result.status === "error") return EXIT_CODES.DiscoverError;
    if (result.status === "ambiguous") {
      log.warn("query is ambiguous; consider --tf-provider to disambiguate");
      return EXIT_CODES.Ambiguous;
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function printSchema(): number {
  // The schema is shipped beside the manifest schema in the Terraform entry, but
  // we ship a derived envelope schema next to the CLI source so
  // Terraform Registry discovery can print a schema even before the entry is installed.
  // TypeScript includes it as package data at build time.
  const schema = envelopeSchema();
  process.stdout.write(JSON.stringify(schema, null, 2) + "\n");
  return 0;
}

/** Returns the JSON Schema for the v0.1 DiscoverResult envelope. */
function envelopeSchema(): unknown {
  // Try to load from the installed Terraform entry. Fall back to
  // the package-local copy that ships beside the CLI for offline / air-gap.
  const registrySchema = join(terraformEntryDocsDir(), "schema", "envelope.schema.json");
  for (const candidate of [registrySchema, packageSchemaPath()]) {
    try {
      const raw = readFileSync(candidate, "utf8");
      return JSON.parse(raw);
    } catch {
      /* try next */
    }
  }
  // Last resort: emit a minimal inline placeholder so schema output remains valid.
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://vegastack.com/schemas/discover-envelope-v1.json",
    title: "VegaStack discover envelope (v0.1)",
    type: "object",
    required: ["status", "query"],
    properties: {
      status: { enum: ["ok", "ambiguous", "error"] },
      query: { type: "string" },
    },
  };
}

function packageSchemaPath(): string {
  // dist/commands/terraform-discover.js -> ../../schema/envelope.schema.json
  // src/commands/terraform-discover.ts  -> ../../schema/envelope.schema.json
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "schema", "envelope.schema.json");
}
