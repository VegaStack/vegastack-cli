// `vegastack ask <query>` — generic registry evidence builder.

import { runTerraformDiscover } from "./terraform-discover.js";
import { assertRegistryEntriesInstalled } from "../lib/registry.js";
import { discoverGenericPacks } from "../lib/generic-pack-discover.js";
import { VegaStackError } from "../lib/errors.js";
import { printError } from "../lib/log.js";
import { resolveRegistryEntriesFromOptions } from "./_shared.js";

export interface AskOptions {
  all: boolean;
  entries?: string | string[];
  max?: number;
  raw: boolean;
  brief: boolean;
  fullExamples: boolean;
  pretty: boolean;
  debug: boolean;
  tfProvider?: string;
  installTools?: boolean;
}

export async function runAsk(query: string, opts: AskOptions): Promise<number> {
  if (!query || query.trim() === "") {
    return printError(new VegaStackError("ValidationError", 'usage: vegastack ask "<query>"'));
  }

  try {
    const registryEntries = resolveAskRegistryEntries(opts);
    if (registryEntries.length === 0) {
      throw new VegaStackError(
        "ValidationError",
        opts.all
          ? "no registry entries are installed in the local VegaStack Registry cache"
          : "no registry entries are selected in .vegastack/vegastack.yml",
      );
    }
    assertRegistryEntriesInstalled(registryEntries);

    const terraformOnly = registryEntries.length === 1 && registryEntries[0] === "terraform";
    const terraformLikely =
      /\b(terraform|hcl|tfvars?|provider|resource|data source|import)\b/i.test(query) ||
      opts.tfProvider !== undefined;
    if (terraformOnly || (registryEntries.includes("terraform") && terraformLikely)) {
      const tfOpts: {
        provider?: string;
        max?: number;
        raw: boolean;
        brief: boolean;
        fullExamples: boolean;
        pretty: boolean;
        debug: boolean;
      } = {
        raw: opts.raw,
        brief: opts.brief,
        fullExamples: opts.fullExamples,
        pretty: opts.pretty,
        debug: opts.debug,
      };
      if (opts.tfProvider !== undefined) tfOpts.provider = opts.tfProvider;
      if (opts.max !== undefined) tfOpts.max = opts.max;
      return await runTerraformDiscover(query, tfOpts);
    }

    const searchable = registryEntries.filter((p) => p !== "terraform");
    const discoverOpts: { installTools?: boolean } = {};
    if (opts.installTools !== undefined) discoverOpts.installTools = opts.installTools;
    const result = await discoverGenericPacks(query, searchable, opts.max, discoverOpts);
    const json = opts.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
    process.stdout.write(json + "\n");
    return result.status === "error" ? 2 : 0;
  } catch (e) {
    return printError(e);
  }
}

function resolveAskRegistryEntries(opts: AskOptions): string[] {
  return resolveRegistryEntriesFromOptions(opts);
}
