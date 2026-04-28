// MCP tool: tf_discover — primary discovery surface.
//
// Mirrors the CLI's `vegastack tf <query> [--provider <p>] [--max <n>]`. Returns
// the canonical DiscoverResult envelope (status: ok | ambiguous | error) as a
// JSON-encoded text content block — MCP clients that respect structuredContent
// also receive the parsed object.

import { z } from "zod";
import { discover } from "../lib/discover.js";
import { jsonContent } from "./_shared.js";

export const tfDiscoverSchema = {
  query: z
    .string()
    .min(1, "query must not be empty")
    .describe(
      "Natural-language description of the Terraform resource, data source, or recipe you need (e.g. 'S3 bucket with versioning and KMS encryption').",
    ),
  provider: z
    .string()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional()
    .describe(
      "Optional canonical provider name (e.g. 'aws', 'cloudflare', 'mongodb-atlas'). When omitted the server attempts to detect from the query and may return status='ambiguous'.",
    ),
  max: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of files to return. Default 20."),
};

export const tfDiscoverDescription =
  "Primary Vegastack discovery tool. Searches the bundled Terraform-provider docs and " +
  "returns the canonical envelope: matching files (with manifest_entry + example_usage), " +
  "knowledge cards, recipes, and concept aliases. Use this whenever the user asks 'how do I " +
  "configure X in Terraform' or 'which resource handles Y'.";

export type TfDiscoverArgs = {
  query: string;
  provider?: string;
  max?: number;
};

export async function handleTfDiscover(env: Env, args: TfDiscoverArgs) {
  const result = await discover(env, args);
  return jsonContent(result);
}
