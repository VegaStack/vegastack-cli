#!/usr/bin/env node
// vegastack — CLI entry point.

import { Command, InvalidArgumentError } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_RENDERER_NAMES } from "./agents/index.js";
import { runDoctor } from "./commands/doctor.js";
import { runInstall } from "./commands/install.js";
import { runRefresh } from "./commands/refresh.js";
import { runSkills } from "./commands/skills.js";
import { runTf } from "./commands/tf.js";
import { runUpdate } from "./commands/update.js";
import { VegastackError } from "./lib/errors.js";
import { log, printError, setJsonMode, setQuiet } from "./lib/log.js";
import { printUpdateNagIfStale } from "./lib/update-check.js";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js → ../package.json
    const pj = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pj.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VALID_AGENTS = `${ALL_RENDERER_NAMES.join(", ")}, all`;

/** Hook called by every command's preAction to apply --quiet / --json. */
function applyGlobalFlags(cmd: Command): void {
  const opts = cmd.optsWithGlobals<{ quiet?: boolean; json?: boolean }>();
  if (opts.quiet) setQuiet(true);
  if (opts.json) setJsonMode(true);
  // Cached, network-free nag — silent unless a newer version was discovered
  // by the last `vegastack doctor` / `vegastack update --check` (24h cache).
  printUpdateNagIfStale(readVersion(), { quiet: Boolean(opts.quiet ?? opts.json) });
}

function parseScope(value: string): "global" | "project" {
  if (value !== "global" && value !== "project") {
    throw new InvalidArgumentError(`expected 'global' or 'project', got '${value}'`);
  }
  return value;
}

function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new InvalidArgumentError(`expected a positive integer, got '${value}'`);
  }
  return n;
}

const program = new Command();
program
  .name("vegastack")
  .description(
    "Deterministic Terraform docs harness for coding agents (Claude Code, Codex, Cursor, Gemini).",
  )
  .version(readVersion(), "-V, --version", "print the CLI version and exit")
  .option("-q, --quiet", "suppress non-error output", false)
  .showHelpAfterError("(run `vegastack --help` for usage)")
  .addHelpText(
    "after",
    `
Examples:
  vegastack doctor                                 verify environment + bundle + agent registration
  vegastack install                                download / extract the docs bundle
  vegastack refresh                                pull a newer bundle, ignoring the recorded version
  vegastack tf "create an S3 bucket with versioning"
                                              ranked discovery against 31 Terraform providers
  vegastack skills install --agent all             register the skill with every detected agent
  vegastack skills install --agent cursor --scope project
                                              drop a Cursor rule into the current project
  vegastack skills uninstall --agent all           clean up everywhere

Environment variables:
  VEGASTACK_BUNDLE_DIR    Override the bundle directory (default: ~/.config/vegastack/bundle).
  VEGASTACK_BUNDLE_URL    Override the download URL (e.g. file:///path/to/bundle.tar.gz).
  VEGASTACK_SKIP_POSTINSTALL=1   Skip the npm postinstall download.
  HTTPS_PROXY        Routes the bundle download through a proxy.
  NO_COLOR           Disable colored output.

Exit codes:
  0   ok
  1   unknown error
  2   discover.py returned an error envelope
  3   query was ambiguous
  4   bundle missing
  5   bundle corrupt
  6   bundle / CLI schema mismatch
  7   network error
  8   checksum mismatch
  9   agent install error
  10  validation error
  11  python3 missing (legacy harness fallback)
  12  unsupported environment

Report bugs at https://github.com/vegastack/vegastack-cli/issues.
`,
  );

// vegastack doctor
program
  .command("doctor")
  .description("verify environment, bundle, and agent registration")
  .option("--json", "emit machine-readable JSON", false)
  .option(
    "--verify-bundle",
    "validate every per-provider MANIFEST.json against the JSON Schema",
    false,
  )
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { json: boolean; verifyBundle: boolean }) => {
    process.exit(await runDoctor({ json: opts.json, verifyBundle: opts.verifyBundle }));
  });

// vegastack install
program
  .command("install")
  .description("download and install the docs bundle (also runs as npm postinstall)")
  .option("--force", "re-download even if version matches", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { force: boolean }) => {
    process.exit(await runInstall({ force: opts.force }));
  });

// vegastack refresh
program
  .command("refresh")
  .description("force re-download of the latest bundle, ignoring the recorded version")
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async () => {
    process.exit(await runRefresh());
  });

// vegastack update
program
  .command("update")
  .description("upgrade @vegastack/cli to the latest published version (wraps `npm i -g`)")
  .option("--check", "only check for a newer version; do not install", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { check: boolean }) => {
    process.exit(await runUpdate({ check: opts.check, current: readVersion() }));
  });

// vegastack tf <query>
program
  .command("tf <query...>")
  .description("ranked discovery for a natural-language Terraform query")
  .option("-p, --provider <name>", "force a specific provider")
  .option("-m, --max <n>", "max results", parsePositiveInt, 10)
  .option("--raw", "skip enrichment (manifest_entry + example_usage); smaller envelope", false)
  .option(
    "--brief",
    'strip manifest_entry + example_usage; add name field; ~80% smaller envelope (E1). Sets mode: "brief" in the response. Best for survey / multi-call dispatch where you only need to know which resources exist. Backward-compatible: default behavior is unchanged.',
    false,
  )
  .option(
    "--full-examples",
    "restore full example_usage content (pre-E2 behavior). Default (no flag) truncates to the first HCL fenced block + a truncation marker. Use when you need the complete ## Example Usage section.",
    false,
  )
  .option("--no-pretty", "emit minified JSON")
  .option("--debug", "include per-stage timings in the response", false)
  .option("--json", "alias for default JSON output (kept for consistency)", false)
  .option("--json-schema", "print the JSON Schema for the discover envelope and exit", false)
  .hook("preAction", applyGlobalFlags)
  .addHelpText(
    "after",
    `
Examples:
  vegastack tf "create an S3 bucket with versioning enabled"
  vegastack tf "import an existing Cloudflare DNS record" --max 5
  vegastack tf "zero-trust internal app" --max 20
  vegastack tf "EC2 instance" --debug          # show per-stage timings
  vegastack tf "S3 bucket" --brief             # ~80% smaller envelope for surveys (E1)
  vegastack tf "EC2 instance" --full-examples  # restore full example_usage (E2)
`,
  )
  .action(
    async (
      queryWords: string[],
      opts: {
        provider?: string;
        max?: number;
        raw: boolean;
        brief: boolean;
        fullExamples: boolean;
        pretty: boolean;
        debug: boolean;
        jsonSchema?: boolean;
      },
    ) => {
      const tfOpts: {
        provider?: string;
        max?: number;
        raw: boolean;
        brief: boolean;
        fullExamples: boolean;
        pretty: boolean;
        debug: boolean;
        jsonSchema?: boolean;
      } = {
        raw: opts.raw,
        brief: opts.brief,
        fullExamples: opts.fullExamples,
        pretty: opts.pretty,
        debug: opts.debug,
      };
      if (opts.provider !== undefined) tfOpts.provider = opts.provider;
      if (opts.max !== undefined) tfOpts.max = opts.max;
      if (opts.jsonSchema) tfOpts.jsonSchema = true;
      process.exit(await runTf(queryWords.join(" "), tfOpts));
    },
  );

// vegastack skills install|uninstall|status
const skillsCmd = program
  .command("skills")
  .description("manage per-agent skill registration")
  .addHelpText(
    "after",
    `
Agents (--agent): ${VALID_AGENTS}
Scopes (--scope): global (~/.claude, ~/.agents, ~/.codex), project (cwd)

Examples:
  vegastack skills install --agent all
  vegastack skills install --agent claude-code,codex
  vegastack skills install --agent cursor --scope project
  vegastack skills status --agent all --json
  vegastack skills uninstall --agent gemini --scope project
`,
  );

skillsCmd
  .command("install")
  .description(`install skill for one or more agents (valid: ${VALID_AGENTS})`)
  .option("-a, --agent <list>", "agent(s) to install (default: all)", collect, [])
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--force", "overwrite existing files / symlinks", false)
  .option("--dry-run", "print what would be done without writing", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (opts: {
      agent: string[];
      scope: "global" | "project";
      force: boolean;
      dryRun: boolean;
      json: boolean;
    }) => {
      process.exit(
        await runSkills("install", {
          agents: opts.agent,
          scope: opts.scope,
          force: opts.force,
          dryRun: opts.dryRun,
          json: opts.json,
        }),
      );
    },
  );

skillsCmd
  .command("uninstall")
  .description(`uninstall skill from one or more agents (valid: ${VALID_AGENTS})`)
  .option("-a, --agent <list>", "agent(s) to uninstall (default: all)", collect, [])
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--dry-run", "print what would be done without writing", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (opts: {
      agent: string[];
      scope: "global" | "project";
      dryRun: boolean;
      json: boolean;
    }) => {
      process.exit(
        await runSkills("uninstall", {
          agents: opts.agent,
          scope: opts.scope,
          force: false,
          dryRun: opts.dryRun,
          json: opts.json,
        }),
      );
    },
  );

skillsCmd
  .command("status")
  .description(`show skill registration status across agents (valid: ${VALID_AGENTS})`)
  .option("-a, --agent <list>", "agent(s) to check (default: all)", collect, [])
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { agent: string[]; scope: "global" | "project"; json: boolean }) => {
    process.exit(
      await runSkills("status", {
        agents: opts.agent,
        scope: opts.scope,
        force: false,
        dryRun: false,
        json: opts.json,
      }),
    );
  });

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

// Top-level error handler: any uncaught throw in a command becomes a VegastackError → printError.
try {
  await program.parseAsync(process.argv);
} catch (e) {
  // Commander throws CommanderError on usage errors with its own exitCode.
  const err = e as { code?: string; exitCode?: number; message?: string };
  if (
    typeof err.exitCode === "number" &&
    typeof err.code === "string" &&
    err.code.startsWith("commander.")
  ) {
    if (err.code !== "commander.helpDisplayed" && err.code !== "commander.version") {
      log.err(err.message ?? "command failed");
    }
    process.exit(err.exitCode);
  }
  process.exit(printError(e instanceof VegastackError ? e : asUnknown(e)));
}

function asUnknown(e: unknown): unknown {
  return e;
}
