// MCP tool: tf_list_providers — list every provider shipped in the bundle.
// Reads from the root MANIFEST.json (E1 owns producing it; E4 owns publishing
// it to R2). Cached per-isolate by r2-bundle.ts.

import { z } from "zod";
import { listProviders, readRootManifest } from "../lib/r2-bundle.js";
import { jsonContent } from "./_shared.js";

export const tfListProvidersSchema = {
  // No arguments — kept as an empty Zod object so the SDK accepts it.
  _ack: z
    .literal(true)
    .optional()
    .describe("Reserved (no-op). MCP requires at least one input field on some clients."),
};

export const tfListProvidersDescription =
  "List the canonical names of every Terraform provider shipped in the current bundle. " +
  "Returns { bundle_version, count, providers }. Use this before tf_discover when you want " +
  "to confirm a provider is supported.";

export async function handleTfListProviders(env: Env) {
  const root = await readRootManifest(env);
  const providers = await listProviders(env);
  return jsonContent({
    bundle_version: root.bundle_version ?? "unknown",
    count: providers.length,
    providers,
  });
}
