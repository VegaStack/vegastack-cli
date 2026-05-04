// MCP tool: terraform_list_providers — list every provider shipped in the Registry pack.
// Reads from the root MANIFEST.json published to R2. Cached per-isolate by
// r2-registry.ts.

import { z } from "zod";
import { listProviders, readRootManifest } from "../lib/r2-registry.js";
import { jsonContent } from "./_shared.js";

export const terraformListProvidersSchema = {
  // No arguments — kept as an empty Zod object so the SDK accepts it.
  _ack: z
    .literal(true)
    .optional()
    .describe("Reserved (no-op). MCP requires at least one input field on some clients."),
};

export const terraformListProvidersDescription =
  "List the canonical names of every Terraform provider shipped in the current Registry pack. " +
  "Returns { registry_version, count, providers }. Use this before terraform_discover when you want " +
  "to confirm a provider is supported.";

export async function handleTerraformListProviders(env: Env) {
  const root = await readRootManifest(env);
  const providers = await listProviders(env);
  return jsonContent({
    registry_version: root.registry_version ?? "unknown",
    count: providers.length,
    providers,
  });
}
