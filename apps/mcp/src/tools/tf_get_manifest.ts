// MCP tool: tf_get_manifest — return the full per-provider MANIFEST.json or
// a single resource entry. Useful when an agent already knows the resource
// name and wants the schema directly without running a search.

import { z } from "zod";
import { readProviderManifest } from "../lib/r2-bundle.js";
import type { ManifestResourceEntry, ProviderManifest } from "../lib/types.js";
import { jsonContent } from "./_shared.js";

export const tfGetManifestSchema = {
  provider: z
    .string()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9-]*$/)
    .describe("Canonical provider name (e.g. 'aws', 'cloudflare')."),
  resource: z
    .string()
    .optional()
    .describe(
      "Optional resource or data-source name (e.g. 'aws_s3_bucket'). When omitted, returns the entire per-provider manifest.",
    ),
};

export const tfGetManifestDescription =
  "Return either the full per-provider MANIFEST.json or a single resource/data_source entry. " +
  "Use this when you already know the resource name and want its arguments, blocks, and import syntax directly.";

export type TfGetManifestArgs = { provider: string; resource?: string };

export async function handleTfGetManifest(env: Env, args: TfGetManifestArgs) {
  let manifest: ProviderManifest;
  try {
    manifest = await readProviderManifest(env, args.provider);
  } catch (e) {
    return jsonContent({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      code: "BundleMissing",
    });
  }

  if (!args.resource) {
    return jsonContent(manifest);
  }

  const entry: ManifestResourceEntry | undefined =
    manifest.resources?.[args.resource] ?? manifest.data_sources?.[args.resource];
  if (!entry) {
    return jsonContent({
      status: "error",
      error: `resource "${args.resource}" not found in provider "${args.provider}"`,
      code: "ResourceUnknown",
    });
  }
  return jsonContent({
    provider: args.provider,
    resource: args.resource,
    entry,
  });
}
