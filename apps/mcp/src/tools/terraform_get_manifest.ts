// MCP tool: terraform_get_manifest — return the full per-provider MANIFEST.json or
// a single resource entry. Useful when an agent already knows the resource
// name and wants the schema directly without running a search.

import { z } from "zod";
import { ArtifactCorrupt, RegistryKeyNotFound, readProviderManifest } from "../lib/r2-registry.js";
import type { ManifestResourceEntry, ProviderManifest } from "../lib/types.js";
import { jsonContent } from "./_shared.js";

export const terraformGetManifestSchema = {
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

export const terraformGetManifestDescription =
  "Return either the full per-provider MANIFEST.json or a single resource/data_source entry. " +
  "Use this when you already know the resource name and want its arguments, blocks, and import syntax directly.";

export type TerraformGetManifestArgs = { provider: string; resource?: string };

export async function handleTerraformGetManifest(env: Env, args: TerraformGetManifestArgs) {
  let manifest: ProviderManifest;
  try {
    manifest = await readProviderManifest(env, args.provider);
  } catch (e) {
    // Branch on the typed errors so an ArtifactCorrupt (JSON parse failure)
    // is not misreported as RegistryEntryMissing, and an unexpected error
    // does not leak raw `e.message` (which can include CF internal request
    // IDs from R2 binding failures) to the client.
    if (e instanceof RegistryKeyNotFound) {
      return jsonContent({
        status: "error",
        error: `provider manifest not found: ${args.provider}`,
        code: "RegistryEntryMissing",
      });
    }
    if (e instanceof ArtifactCorrupt) {
      return jsonContent({
        status: "error",
        error: `provider manifest is corrupt: ${args.provider}`,
        code: "ArtifactCorrupt",
      });
    }
    console.error("terraform_get_manifest unexpected error", e);
    return jsonContent({
      status: "error",
      error: "internal error reading provider manifest",
      code: "InternalError",
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
