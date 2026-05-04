#!/usr/bin/env node
// vegastack — CLI entry point.

import { Command, InvalidArgumentError } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_RENDERER_NAMES } from "./agents/index.js";
import { runAsk } from "./commands/ask.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runPreview } from "./commands/preview.js";
import { runRegistryList, runRegistryStatus, runRegistryUpdate } from "./commands/registry.js";
import { runSearch } from "./commands/search.js";
import { runSecretsDoctor, runSecretsEnable, runSecretsScan } from "./commands/secrets.js";
import { runSkills } from "./commands/skills.js";
import { runUpdate } from "./commands/update.js";
import { VegaStackError } from "./lib/errors.js";
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
    "Local-first knowledge harness for coding agents (Claude Code, Codex, Cursor, Gemini, Continue, Aider).",
  )
  .version(readVersion(), "-V, --version", "print the CLI version and exit")
  .option("-q, --quiet", "suppress non-error output", false)
  .showHelpAfterError("(run `vegastack --help` for usage)")
  .addHelpText(
    "after",
    `
Examples:
  vegastack init                                   initialize this repo's local agent harness
  vegastack ask "how should this repo deploy safely?" build grounded evidence from selected entries
  vegastack ask --all "github actions oidc to aws" search every locally installed Registry pack
  vegastack search --entry jenkins "withCredentials" exact source lookup in a Registry pack
  vegastack doctor                                 verify environment + registry + agent registration
  vegastack registry list                             show local Registry cache state
  vegastack registry update                           update project-selected Registry entries
  vegastack update                                    update CLI + registry + managed tools
  vegastack preview --tunnel                       start a local preview and temporary Cloudflare URL
  vegastack secrets enable                         enable Gitleaks secret scanning for this project
  vegastack secrets scan --history                 scan git history for secrets
  vegastack ask --entry terraform --tf-provider aws "create an S3 bucket with versioning"
                                              Terraform-specific registry query
  vegastack skills install --agent all             register the skill with every detected agent
  vegastack skills install --agent cursor --scope project
                                              drop a Cursor rule into the current project
  vegastack skills uninstall --agent all           clean up everywhere

Environment variables:
  VEGASTACK_CONFIG_DIR    Override the VegaStack config root (default: ~/.config/vegastack).
  VEGASTACK_REGISTRY_DIR  Override the registry cache directory (default: ~/.config/vegastack/registry).
  VEGASTACK_TOOLS_DIR     Override the external tools cache directory (default: ~/.config/vegastack/tools).
  VEGASTACK_GITLEAKS_BIN  Use an existing Gitleaks binary instead of the VegaStack-managed one.
  VEGASTACK_CLOUDFLARED_BIN Use an existing cloudflared binary instead of the VegaStack-managed one.
  VEGASTACK_SKIP_POSTINSTALL=1   Silence postinstall guidance. Registry data is never downloaded during postinstall.
  NO_COLOR           Disable colored output.

Exit codes:
  0   ok
  1   unknown error
  2   discovery returned an error envelope
  3   query was ambiguous
  4   Registry pack missing
  5   Registry pack corrupt
  6   registry / CLI schema mismatch
  7   network error
  8   checksum mismatch
  9   agent install error
  10  validation error
  11  managed tool missing
  12  unsupported environment

Report bugs at https://github.com/VegaStack/vegastack-cli/issues.
`,
  );

// vegastack ask <query>
program
  .command("ask <query...>")
  .description("build grounded evidence from project-selected registry entries")
  .option(
    "--all",
    "search every locally installed Registry pack instead of the project lock",
    false,
  )
  .option("--entry <names>", "comma-separated Registry pack override, e.g. terraform,supabase")
  .option("--tf-provider <name>", "when --entry includes terraform, force a Terraform provider")
  .option("-m, --max <n>", "max results", parsePositiveInt, 10)
  .option("--raw", "skip pack-specific enrichment when supported", false)
  .option("--brief", "request a smaller pack-specific envelope when supported", false)
  .option("--full-examples", "request full examples when supported", false)
  .option("--no-install-tools", "do not auto-install managed search tools such as ripgrep")
  .option("--no-pretty", "emit minified JSON")
  .option("--debug", "include per-stage timings when supported", false)
  .option("--json", "alias for default JSON output (kept for consistency)", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      queryWords: string[],
      opts: {
        all: boolean;
        entry?: string;
        max?: number;
        raw: boolean;
        brief: boolean;
        fullExamples: boolean;
        installTools: boolean;
        pretty: boolean;
        debug: boolean;
        tfProvider?: string;
      },
    ) => {
      const qOpts: {
        all: boolean;
        entries?: string;
        tfProvider?: string;
        max?: number;
        raw: boolean;
        brief: boolean;
        fullExamples: boolean;
        installTools: boolean;
        pretty: boolean;
        debug: boolean;
      } = {
        all: opts.all,
        raw: opts.raw,
        brief: opts.brief,
        fullExamples: opts.fullExamples,
        installTools: opts.installTools,
        pretty: opts.pretty,
        debug: opts.debug,
      };
      if (opts.entry !== undefined) qOpts.entries = opts.entry;
      if (opts.tfProvider !== undefined) qOpts.tfProvider = opts.tfProvider;
      if (opts.max !== undefined) qOpts.max = opts.max;
      process.exit(await runAsk(queryWords.join(" "), qOpts));
    },
  );

// vegastack search <query>
program
  .command("search <query...>")
  .description("exact source lookup across local VegaStack Registry entries")
  .option(
    "--all",
    "search every locally installed Registry pack instead of the project lock",
    false,
  )
  .option("--entry <names>", "comma-separated Registry pack override, e.g. jenkins,docker")
  .option("-m, --max <n>", "max matches", parsePositiveInt, 20)
  .option("--regex", "treat the query as a regular expression", false)
  .option("-i, --ignore-case", "case-insensitive search", false)
  .option("--no-install-tools", "do not auto-install managed search tools such as ripgrep")
  .option("--no-pretty", "emit minified JSON")
  .option("--json", "alias for default JSON output (kept for consistency)", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      queryWords: string[],
      opts: {
        all: boolean;
        entry?: string;
        max?: number;
        regex: boolean;
        ignoreCase: boolean;
        installTools: boolean;
        pretty: boolean;
      },
    ) => {
      const searchOpts: {
        all: boolean;
        entries?: string;
        max?: number;
        regex: boolean;
        ignoreCase: boolean;
        installTools: boolean;
        pretty: boolean;
      } = {
        all: opts.all,
        regex: opts.regex,
        ignoreCase: opts.ignoreCase,
        installTools: opts.installTools,
        pretty: opts.pretty,
      };
      if (opts.entry !== undefined) searchOpts.entries = opts.entry;
      if (opts.max !== undefined) searchOpts.max = opts.max;
      process.exit(await runSearch(queryWords.join(" "), searchOpts));
    },
  );

// vegastack init
program
  .command("init")
  .description("initialize a project-local VegaStack harness in .vegastack/")
  .option("-y, --yes", "accept prompts and write detected defaults", false)
  .option("--dry-run", "show the init plan without writing files", false)
  .option("--no-download", "do not download missing registry entries during init", false)
  .option("--no-tunnels", "skip managed cloudflared install during init")
  .option("--secrets", "enable Gitleaks secret scanning without prompting")
  .option("--no-secrets", "skip Gitleaks secret scanning")
  .option("--secrets-hook", "also install a local git pre-commit secret scanning hook", false)
  .option("--no-skills", "skip automatic skill installation for detected agent hosts")
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (opts: {
      yes: boolean;
      dryRun: boolean;
      json: boolean;
      download: boolean;
      secrets?: boolean;
      secretsHook: boolean;
      tunnels: boolean;
      skills: boolean;
    }) => {
      process.exit(
        await runInit({
          yes: opts.yes,
          dryRun: opts.dryRun,
          json: opts.json,
          noDownload: !opts.download,
          secrets: opts.secrets,
          secretsHook: opts.secretsHook,
          tunnels: opts.tunnels,
          skills: opts.skills,
        }),
      );
    },
  );

// vegastack preview
program
  .command("preview")
  .description("start a local app preview, optionally through Cloudflare Tunnel")
  .option("--command <cmd>", "command to start the local dev server")
  .option("--url <url>", "existing local URL to preview, e.g. http://localhost:3000")
  .option("--port <n>", "local port to wait for when no URL is provided", parsePositiveInt)
  .option("--tunnel", "create a temporary Cloudflare Quick Tunnel", false)
  .option("--hostname <hostname>", "route a custom Cloudflare hostname to the preview")
  .option("--tunnel-name <name>", "named Cloudflare Tunnel to create/reuse", "vegastack-preview")
  .option("--timeout <seconds>", "seconds to wait for local/tunnel readiness", parsePositiveInt, 60)
  .option("-y, --yes", "accept notices in non-interactive contexts", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .addHelpText(
    "after",
    `
Cloudflare notice:
  --tunnel uses Cloudflare Quick Tunnels for temporary development previews.
  Quick Tunnels are not production hosting and do not provide an SLA.
  VegaStack uses the open-source cloudflared binary: https://github.com/cloudflare/cloudflared
  --hostname requires Cloudflare login and a domain/zone you control.
`,
  )
  .action(
    async (opts: {
      command?: string;
      url?: string;
      port?: number;
      tunnel: boolean;
      hostname?: string;
      tunnelName: string;
      timeout: number;
      yes: boolean;
      json: boolean;
    }) => {
      process.exit(
        await runPreview({
          command: opts.command,
          url: opts.url,
          port: opts.port,
          tunnel: opts.tunnel,
          hostname: opts.hostname,
          tunnelName: opts.tunnelName,
          timeout: opts.timeout,
          yes: opts.yes,
          json: opts.json,
        }),
      );
    },
  );

// vegastack doctor
program
  .command("doctor")
  .description("verify environment, registry, and agent registration")
  .option("--json", "emit machine-readable JSON", false)
  .option("--verify-registry", "validate installed registry manifests", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { json: boolean; verifyRegistry?: boolean }) => {
    process.exit(
      await runDoctor({
        json: opts.json,
        verifyRegistry: Boolean(opts.verifyRegistry),
      }),
    );
  });

// vegastack registry list|update|status
const registryCmd = program.command("registry").description("manage the local VegaStack Registry");

registryCmd
  .command("list")
  .description("list published Registry packs and local cache state")
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { json: boolean }) => {
    process.exit(await runRegistryList({ json: opts.json }));
  });

registryCmd
  .command("update [entry]")
  .description("update installed registry entries from the published Registry")
  .option("--all", "update every installed Registry pack instead of the project lock", false)
  .option("--force", "re-download even if the published manifest hash matches", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (entry: string | undefined, opts: { all: boolean; force: boolean; json: boolean }) => {
      const updateOpts: {
        entry?: string;
        all: boolean;
        force: boolean;
        json: boolean;
      } = {
        all: opts.all,
        force: opts.force,
        json: opts.json,
      };
      if (entry !== undefined) updateOpts.entry = entry;
      process.exit(await runRegistryUpdate(updateOpts));
    },
  );

registryCmd
  .command("status")
  .description("show local Registry cache state")
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { json: boolean }) => {
    process.exit(await runRegistryStatus({ json: opts.json }));
  });

// vegastack secrets enable|scan|doctor
const secretsCmd = program
  .command("secrets")
  .description("manage secret scanning with Gitleaks (https://github.com/gitleaks/gitleaks)")
  .addHelpText(
    "after",
    `
Disclosure:
  VegaStack wraps Gitleaks for secret detection. Gitleaks is an open-source
  scanner maintained at https://github.com/gitleaks/gitleaks.
`,
  );

secretsCmd
  .command("enable")
  .description("enable Gitleaks secret scanning for this project and install the pinned binary")
  .option("--no-install", "write project files without installing Gitleaks")
  .option("--no-ci", "do not write the GitHub Actions workflow")
  .option("--hook", "install a local git pre-commit hook", false)
  .option("--force", "overwrite existing generated files and reinstall Gitleaks", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (opts: {
      install: boolean;
      ci: boolean;
      hook: boolean;
      force: boolean;
      json: boolean;
    }) => {
      process.exit(
        await runSecretsEnable({
          install: opts.install,
          force: opts.force,
          noCi: !opts.ci,
          hook: opts.hook,
          json: opts.json,
        }),
      );
    },
  );

secretsCmd
  .command("scan")
  .description("run Gitleaks locally, installing it first if needed")
  .option("--history", "scan full git history instead of the working tree", false)
  .option("--staged", "scan the staged git diff for pre-commit usage", false)
  .option("--json", "emit Gitleaks JSON report to stdout when supported", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { history: boolean; staged: boolean; json: boolean }) => {
    process.exit(
      await runSecretsScan({ history: opts.history, staged: opts.staged, json: opts.json }),
    );
  });

secretsCmd
  .command("doctor")
  .description("show secret scanning setup status")
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { json: boolean }) => {
    process.exit(await runSecretsDoctor({ json: opts.json }));
  });

// vegastack update
program
  .command("update")
  .description("update the CLI, project registry entries, and managed tool dependencies")
  .option("--check", "only check for a newer version; do not install", false)
  .option("--no-cli", "skip @vegastack/cli self-update")
  .option("--no-registry", "skip Registry pack update")
  .option("--no-tools", "skip managed tool update")
  .option(
    "--all-registry",
    "update every installed Registry pack instead of project-selected entries",
    false,
  )
  .option("--force", "force registry/tool reinstall where supported", false)
  .option("--json", "emit machine-readable JSON", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (opts: {
      check: boolean;
      cli: boolean;
      registry: boolean;
      tools: boolean;
      allRegistry: boolean;
      force: boolean;
      json: boolean;
    }) => {
      process.exit(
        await runUpdate({
          check: opts.check,
          current: readVersion(),
          cli: opts.cli,
          registry: opts.registry,
          tools: opts.tools,
          allRegistry: opts.allRegistry,
          force: opts.force,
          json: opts.json,
        }),
      );
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

// Top-level error handler: any uncaught throw in a command becomes a VegaStackError → printError.
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
  process.exit(printError(e instanceof VegaStackError ? e : asUnknown(e)));
}

function asUnknown(e: unknown): unknown {
  return e;
}
