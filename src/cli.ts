#!/usr/bin/env node
// vegastack — CLI entry point.

import { Command, InvalidArgumentError } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_RENDERER_NAMES } from "./agents/index.js";
// Command modules are loaded lazily inside each `.action()` handler so that
// `vegastack --help` (and any other path that doesn't actually invoke a
// command) never pays the parse/link cost of `commands/init.ts`,
// `commands/scan.ts` (~1100 LOC + spawnSync + scan-tools/scan-config),
// `commands/preview.ts` (cloudflared), `commands/update.ts` (npm view), etc.
// The `dynamicImport*` helpers below are the single point where the lazy
// loading happens and exist to keep type signatures explicit.
// Audit performance/F-002 in audit-1778150875.
const dynamicImportAsk = () => import("./commands/ask.js");
const dynamicImportDetect = () => import("./commands/detect.js");
const dynamicImportDoctor = () => import("./commands/doctor.js");
const dynamicImportGenerate = () => import("./commands/generate.js");
const dynamicImportInit = () => import("./commands/init.js");
const dynamicImportPreview = () => import("./commands/preview.js");
const dynamicImportRefresh = () => import("./commands/refresh.js");
const dynamicImportRegistry = () => import("./commands/registry.js");
const dynamicImportScan = () => import("./commands/scan.js");
const dynamicImportSearch = () => import("./commands/search.js");
const dynamicImportSkills = () => import("./commands/skills.js");
const dynamicImportSetup = () => import("./commands/setup.js");
const dynamicImportUpdate = () => import("./commands/update.js");
import { VegaStackError } from "./lib/errors.js";
import { printError, setJsonMode, setQuiet } from "./lib/log.js";
import { autoRefreshProjectState } from "./lib/project-state.js";
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

const VALID_AGENT_HOSTS = `${ALL_RENDERER_NAMES.join(", ")}, all`;

/** Hook called by every command's preAction to apply --quiet / --agent. */
function applyGlobalFlags(cmd: Command): void {
  const opts = cmd.optsWithGlobals<{ quiet?: boolean; agent?: boolean }>();
  if (opts.quiet) setQuiet(true);
  if (opts.agent) setJsonMode(true);
  // Cached, network-free nag — silent unless a newer version was discovered
  // by the last `vegastack doctor` / `vegastack update --check` (24h cache).
  printUpdateNagIfStale(readVersion(), { quiet: Boolean(opts.quiet ?? opts.agent) });
}

function applyProjectCommandPrelude(cmd: Command): void {
  applyGlobalFlags(cmd);
  const opts = cmd.optsWithGlobals<{ quiet?: boolean; agent?: boolean }>();
  autoRefreshProjectState(process.cwd(), { quiet: Boolean(opts.quiet ?? opts.agent) });
}

function isAgentMode(cmd: Command, opts?: { agent?: boolean }): boolean {
  if (opts?.agent === true) return true;
  return Boolean(cmd.optsWithGlobals<{ agent?: boolean }>().agent);
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
// `exitOverride` makes commander throw `CommanderError` instead of calling
// `process.exit` directly. We need this so the top-level try/catch below can
// translate `commander.invalidArgument` into a typed `ValidationError`
// (exit 10) per the documented exit-code rubric. Without it, commander short-
// circuits with exit 1 before our handler runs.
program.exitOverride();
program
  .name("vegastack")
  .description(
    "Local-first knowledge harness for coding agents (Claude Code, Codex, Cursor, Gemini, Continue, Aider).",
  )
  .version(readVersion(), "-V, --version", "print the CLI version and exit")
  .option("-q, --quiet", "suppress non-error output", false)
  .option("--agent", "agent/script mode: structured output and no human prompts", false)
  .showHelpAfterError("(run `vegastack --help` for usage)")
  .addHelpText(
    "after",
    `
Examples:
  vegastack                                        first-run setup or local VegaStack status
  vegastack setup                                  re-run global ~/.vegastack tools and skills setup
  vegastack init                                   initialize this repo's local agent harness
  vegastack --agent                                first-run/status as structured output
  vegastack --agent detect                         detect current repo stack without writing
  vegastack --agent refresh --dry-run              show shared config refresh changes
  vegastack --agent generate github-action vercel  return an agent workflow contract
  vegastack ask "how should this repo deploy safely?" build grounded evidence from selected packs
  vegastack ask --all "github actions oidc to aws" search every locally installed Registry pack
  vegastack ask --pack cloudflare "wrangler deploy" scoped lookup without project init
  vegastack search --pack jenkins "withCredentials" exact source lookup in a Registry pack
  vegastack doctor                                 verify environment + registry + agent registration
  vegastack registry list                             show local Registry cache state
  vegastack registry update                           update project-selected Registry packs
  vegastack registry install --all                     download every published Registry pack
  vegastack update                                    update CLI + Registry + managed tools
  vegastack preview --tunnel                       start a local preview and temporary Cloudflare URL
  vegastack scan                                   run enabled security scans for this project
  vegastack scan secrets actions                   run selected scan categories
  vegastack scan --staged                          run the fast staged pre-commit scan
  vegastack ask --pack terraform --tf-provider aws "create an S3 bucket with versioning"
                                              Terraform-specific registry query
  vegastack skills install --host all              register the skill with every detected agent host
  vegastack skills reconcile                       install missing global skills for detected agent hosts
  vegastack skills install --host cursor --scope project
                                              drop a Cursor rule into the current project
  vegastack skills uninstall --host all            clean up everywhere

Project-mode commands automatically cache current repo detection when .vegastack/vegastack.yml is present.
Project-mode ask/search also include already-installed supplemental Registry packs when the repo changed.

Environment variables:
  VEGASTACK_CONFIG_DIR    Override the VegaStack config root (default: ~/.vegastack).
  VEGASTACK_REGISTRY_DIR  Override the registry cache directory (default: ~/.vegastack/registry).
  VEGASTACK_TOOLS_DIR     Override the external tools cache directory (default: ~/.vegastack/tools).
  VEGASTACK_GITLEAKS_BIN  Use an existing Gitleaks binary instead of the VegaStack-managed one.
  VEGASTACK_TRIVY_BIN     Use an existing Trivy binary instead of the VegaStack-managed one.
  VEGASTACK_OSV_SCANNER_BIN Use an existing OSV-Scanner binary instead of the VegaStack-managed one.
  VEGASTACK_ACTIONLINT_BIN Use an existing actionlint binary instead of the VegaStack-managed one.
  VEGASTACK_ZIZMOR_BIN    Use an existing zizmor binary instead of the VegaStack-managed one.
  VEGASTACK_CLOUDFLARED_BIN Use an existing cloudflared binary instead of the VegaStack-managed one.
  VEGASTACK_SKIP_POSTINSTALL=1   Silence postinstall guidance. Registry data is never downloaded during postinstall.
  VEGASTACK_SKIP_SKILL_INSTALL=1 Skip best-effort agent skill registration during postinstall.
  VEGASTACK_POSTINSTALL_TIMEOUT_MS Milliseconds before postinstall skill registration is skipped (default: 15000).
  NO_COLOR           Disable colored output.

Exit codes:
  0   ok
  1   unknown error (also: commander unknown-command / unknown-option usage errors)
  2   discovery returned an error envelope
  3   query was ambiguous
  4   Registry pack missing
  5   Registry pack corrupt
  6   registry / CLI schema mismatch
  7   network error
  8   checksum mismatch
  9   agent install error
  10  validation error (CLI input validation, including invalid option arguments)
  11  managed tool missing
  12  unsupported environment

Note: this CLI uses 2 for typed discovery errors (not POSIX-style "usage").
Commander-level usage errors (unknown command, unknown option) exit 1; bad
option-argument values (e.g. --format invalid) exit 10 via the typed map.

Report bugs at https://github.com/vegastack/vegastack-cli/issues.
`,
  );

// vegastack setup
program
  .command("setup")
  .description("configure global VegaStack tools, cache, and detected agent skills")
  .option("-y, --yes", "accept recommended defaults", false)
  .option("--dry-run", "show setup plan without writing", false)
  .option("--download-all-registry", "download every published Registry pack during setup", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      opts: {
        yes: boolean;
        dryRun: boolean;
        downloadAllRegistry: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const { runSetup } = await dynamicImportSetup();
      process.exit(
        await runSetup({
          yes: opts.yes,
          dryRun: opts.dryRun,
          downloadAllRegistry: opts.downloadAllRegistry,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

// vegastack detect
program
  .command("detect")
  .description("detect current project stack and recommended Registry packs without writing")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { agent: boolean }, cmd: Command) => {
    const { runDetect } = await dynamicImportDetect();
    process.exit(await runDetect({ json: isAgentMode(cmd, opts) }));
  });

// vegastack refresh
program
  .command("refresh")
  .description("refresh .vegastack/vegastack.yml with current project detection")
  .option("-y, --yes", "write detected defaults without prompting", false)
  .option("--dry-run", "show refresh plan without writing", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { yes: boolean; dryRun: boolean; agent: boolean }, cmd: Command) => {
    const { runRefresh } = await dynamicImportRefresh();
    process.exit(
      await runRefresh({ yes: opts.yes, dryRun: opts.dryRun, json: isAgentMode(cmd, opts) }),
    );
  });

// vegastack generate
program
  .command("generate <intent...>")
  .description("return an agent workflow contract for creating ops files")
  .option("--dry-run", "alias for default read-only behavior", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(async (intent: string[], opts: { dryRun: boolean; agent: boolean }, cmd: Command) => {
    const { runGenerate } = await dynamicImportGenerate();
    process.exit(await runGenerate(intent, { dryRun: opts.dryRun, json: isAgentMode(cmd, opts) }));
  });

// vegastack ask <query>
program
  .command("ask <query...>")
  .description("build grounded evidence from project-selected Registry packs")
  .option(
    "--all",
    "search every locally installed Registry pack instead of project-selected packs",
    false,
  )
  .option(
    "--pack <names>",
    "Registry pack override; repeat or comma-separate, e.g. terraform,supabase",
    collect,
    [],
  )
  .option("--tf-provider <name>", "when --pack includes terraform, force a Terraform provider")
  .option("-m, --max <n>", "max results", parsePositiveInt, 10)
  .option("--raw", "skip pack-specific enrichment when supported", false)
  .option("--brief", "request a smaller pack-specific envelope when supported", false)
  .option("--full-examples", "request full examples when supported", false)
  .option("--no-install-tools", "do not auto-install managed search tools such as ripgrep")
  .option("--no-pretty", "emit minified JSON")
  .option("--debug", "include per-stage timings when supported", false)
  .option("--agent", "emit agent-readable structured output", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      queryWords: string[],
      opts: {
        all: boolean;
        pack?: string[];
        max?: number;
        raw: boolean;
        brief: boolean;
        fullExamples: boolean;
        installTools: boolean;
        pretty: boolean;
        debug: boolean;
        tfProvider?: string;
        agent: boolean;
      },
    ) => {
      const qOpts: {
        all: boolean;
        entries?: string[];
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
      if (opts.pack !== undefined) qOpts.entries = opts.pack;
      if (opts.tfProvider !== undefined) qOpts.tfProvider = opts.tfProvider;
      if (opts.max !== undefined) qOpts.max = opts.max;
      const { runAsk } = await dynamicImportAsk();
      process.exit(await runAsk(queryWords.join(" "), qOpts));
    },
  );

// vegastack search <query>
program
  .command("search <query...>")
  .description("exact source lookup across local VegaStack Registry packs")
  .option(
    "--all",
    "search every locally installed Registry pack instead of project-selected packs",
    false,
  )
  .option(
    "--pack <names>",
    "Registry pack override; repeat or comma-separate, e.g. jenkins,docker",
    collect,
    [],
  )
  .option("-m, --max <n>", "max matches", parsePositiveInt, 20)
  .option("--regex", "treat the query as a regular expression", false)
  .option("-i, --ignore-case", "case-insensitive search", false)
  .option("--no-install-tools", "do not auto-install managed search tools such as ripgrep")
  .option("--no-pretty", "emit minified JSON")
  .option("--agent", "emit agent-readable structured output", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      queryWords: string[],
      opts: {
        all: boolean;
        pack?: string[];
        max?: number;
        regex: boolean;
        ignoreCase: boolean;
        installTools: boolean;
        pretty: boolean;
        agent: boolean;
      },
    ) => {
      const searchOpts: {
        all: boolean;
        entries?: string[];
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
      if (opts.pack !== undefined) searchOpts.entries = opts.pack;
      if (opts.max !== undefined) searchOpts.max = opts.max;
      const { runSearch } = await dynamicImportSearch();
      process.exit(await runSearch(queryWords.join(" "), searchOpts));
    },
  );

// vegastack init
program
  .command("init")
  .description("initialize a project-local VegaStack harness in .vegastack/")
  .option("-y, --yes", "accept prompts and write detected defaults", false)
  .option("--dry-run", "show the init plan without writing files", false)
  .option("--no-download", "do not download missing Registry packs during init")
  .option("--no-tunnels", "skip managed cloudflared install during init")
  .option("--scan", "enable VegaStack scan without prompting")
  .option("--no-scan", "skip VegaStack scan")
  .option("--scan-hook", "also install a local git pre-commit scan hook", false)
  .option("--no-skills", "skip automatic skill installation for detected agent hosts")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      opts: {
        yes: boolean;
        dryRun: boolean;
        download: boolean;
        scan?: boolean;
        scanHook: boolean;
        tunnels: boolean;
        skills: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const { runInit } = await dynamicImportInit();
      process.exit(
        await runInit({
          yes: opts.yes,
          dryRun: opts.dryRun,
          json: isAgentMode(cmd, opts),
          noDownload: !opts.download,
          scan: opts.scan,
          scanHook: opts.scanHook,
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
  .option(
    "--shell",
    "evaluate --command via the system shell (DANGEROUS: enables shell metacharacters; only use with trusted input)",
    false,
  )
  .option("--url <url>", "existing local URL to preview, e.g. http://localhost:3000")
  .option(
    "--allow-private-host",
    "allow --url to point at a non-loopback host (defeats SSRF guard; use with care)",
    false,
  )
  .option("--port <n>", "local port to wait for when no URL is provided", parsePositiveInt)
  .option("--tunnel", "create a temporary Cloudflare Quick Tunnel", false)
  .option("--hostname <hostname>", "route a custom Cloudflare hostname to the preview")
  .option("--tunnel-name <name>", "named Cloudflare Tunnel to create/reuse", "vegastack-preview")
  .option("--timeout <seconds>", "seconds to wait for local/tunnel readiness", parsePositiveInt, 60)
  .option("-y, --yes", "accept notices in non-interactive contexts", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
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
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      opts: {
        command?: string;
        url?: string;
        port?: number;
        tunnel: boolean;
        hostname?: string;
        tunnelName: string;
        timeout: number;
        yes: boolean;
        agent: boolean;
        shell: boolean;
        allowPrivateHost: boolean;
      },
      cmd: Command,
    ) => {
      const { runPreview } = await dynamicImportPreview();
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
          json: isAgentMode(cmd, opts),
          shell: opts.shell,
          allowPrivateHost: opts.allowPrivateHost,
        }),
      );
    },
  );

// vegastack doctor
program
  .command("doctor")
  .description("verify environment, registry, and agent registration")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .option("--verify-registry", "validate installed registry manifests", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { agent: boolean; verifyRegistry?: boolean }, cmd: Command) => {
    const { runDoctor } = await dynamicImportDoctor();
    process.exit(
      await runDoctor({
        json: isAgentMode(cmd, opts),
        verifyRegistry: Boolean(opts.verifyRegistry),
      }),
    );
  });

// vegastack registry list|update|status
const registryCmd = program.command("registry").description("manage the local VegaStack Registry");

registryCmd
  .command("list")
  .description("list published Registry packs and local cache state")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { agent: boolean }, cmd: Command) => {
    const { runRegistryList } = await dynamicImportRegistry();
    process.exit(await runRegistryList({ json: isAgentMode(cmd, opts) }));
  });

registryCmd
  .command("install [pack]")
  .description("download Registry pack docs into the local cache")
  .option("--all", "download every published Registry pack", false)
  .option("--force", "re-download even if the published manifest hash matches", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      pack: string | undefined,
      opts: { all: boolean; force: boolean; agent: boolean },
      cmd: Command,
    ) => {
      const installOpts: {
        entry?: string;
        all: boolean;
        force: boolean;
        json: boolean;
      } = {
        all: opts.all,
        force: opts.force,
        json: isAgentMode(cmd, opts),
      };
      if (pack !== undefined) installOpts.entry = pack;
      const { runRegistryInstall } = await dynamicImportRegistry();
      process.exit(await runRegistryInstall(installOpts));
    },
  );

registryCmd
  .command("update [pack]")
  .description("update installed Registry packs from the published Registry")
  .option("--all", "update every installed Registry pack instead of project-selected packs", false)
  .option("--force", "re-download even if the published manifest hash matches", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      pack: string | undefined,
      opts: { all: boolean; force: boolean; agent: boolean },
      cmd: Command,
    ) => {
      const updateOpts: {
        entry?: string;
        all: boolean;
        force: boolean;
        json: boolean;
      } = {
        all: opts.all,
        force: opts.force,
        json: isAgentMode(cmd, opts),
      };
      if (pack !== undefined) updateOpts.entry = pack;
      const { runRegistryUpdate } = await dynamicImportRegistry();
      process.exit(await runRegistryUpdate(updateOpts));
    },
  );

registryCmd
  .command("status")
  .description("show local Registry cache state")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { agent: boolean }, cmd: Command) => {
    const { runRegistryStatus } = await dynamicImportRegistry();
    process.exit(await runRegistryStatus({ json: isAgentMode(cmd, opts) }));
  });

// vegastack scan [categories...]
const scanCmd = program
  .command("scan [categories...]")
  .description("run local-first security scans with OSS tools")
  .option("--staged", "scan staged changes for pre-commit usage", false)
  .option("--history", "include full git history for secret scanning", false)
  .option("--image <ref>", "container image reference to scan", collect, [])
  .option("--severity <list>", "comma-separated severity filter where supported")
  .option("--format <format>", "text | json | sarif", "text")
  .option("--output <path>", "write JSON scan report to a file")
  .option("--offline", "use cached scanner databases and avoid online vulnerability lookups", false)
  .option("--no-install-tools", "fail instead of installing missing scanner tools")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .addHelpText(
    "after",
    `
Disclosure:
  VegaStack scan wraps open-source scanners and discloses upstream engines:
  Gitleaks https://github.com/gitleaks/gitleaks
  Trivy https://github.com/aquasecurity/trivy
  OSV-Scanner https://github.com/google/osv-scanner
  actionlint https://github.com/rhysd/actionlint
  zizmor https://github.com/zizmorcore/zizmor
`,
  )
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      categories: string[] | undefined,
      opts: {
        staged: boolean;
        history: boolean;
        image: string[];
        severity?: string;
        format: string;
        output?: string;
        offline: boolean;
        installTools: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const format = isAgentMode(cmd, opts) ? "json" : opts.format;
      if (format !== "text" && format !== "json" && format !== "sarif") {
        throw new InvalidArgumentError(`expected text, json, or sarif, got '${format}'`);
      }
      const scanOpts: {
        categories: string[];
        staged: boolean;
        history: boolean;
        image: string[];
        severity?: string;
        format: "text" | "json" | "sarif";
        output?: string;
        offline: boolean;
        installTools: boolean;
      } = {
        categories: categories ?? [],
        staged: opts.staged,
        history: opts.history,
        image: opts.image,
        format,
        offline: opts.offline,
        installTools: opts.installTools,
      };
      if (opts.severity !== undefined) scanOpts.severity = opts.severity;
      if (opts.output !== undefined) scanOpts.output = opts.output;
      const { runScan } = await dynamicImportScan();
      process.exit(await runScan(scanOpts));
    },
  );

scanCmd
  .command("enable")
  .description("enable VegaStack scan for this project and install pinned scanner tools")
  .option("--no-install", "write project config without installing scanner tools")
  .option("--hook", "install a local git pre-commit hook", false)
  .option("--force", "overwrite existing generated hooks and reinstall scanner tools", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      opts: { install: boolean; hook: boolean; force: boolean; agent: boolean },
      cmd: Command,
    ) => {
      const json = isAgentMode(cmd, opts);
      const { runScanEnable } = await dynamicImportScan();
      process.exit(
        await runScanEnable({
          install: opts.install,
          force: opts.force,
          hook: opts.hook,
          json,
        }),
      );
    },
  );

scanCmd
  .command("doctor")
  .description("show scan setup status")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(async (opts: { agent: boolean }, cmd: Command) => {
    const { runScanDoctor } = await dynamicImportScan();
    process.exit(
      await runScanDoctor({
        json: isAgentMode(cmd, opts),
      }),
    );
  });

scanCmd
  .command("update-db")
  .description("refresh scanner vulnerability databases")
  .option("--offline", "reserved for consistency; update-db needs network for fresh data", false)
  .option("--no-install-tools", "fail instead of installing missing scanner tools")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (opts: { offline: boolean; installTools: boolean; agent: boolean }, cmd: Command) => {
      const { runScanUpdateDb } = await dynamicImportScan();
      process.exit(
        await runScanUpdateDb({
          offline: opts.offline,
          installTools: opts.installTools,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

const scanHookCmd = scanCmd.command("hook").description("manage the VegaStack scan git hook");

scanHookCmd
  .command("install")
  .description("install the local pre-commit hook")
  .option("--force", "append/replace VegaStack hook block in an existing hook", false)
  .hook("preAction", applyGlobalFlags)
  .action(async (opts: { force: boolean }) => {
    const { installScanPreCommitHook } = await dynamicImportScan();
    process.exit(installScanPreCommitHook(process.cwd(), opts.force) ? 0 : 1);
  });

scanHookCmd
  .command("remove")
  .description("remove the VegaStack-managed pre-commit hook block")
  .hook("preAction", applyGlobalFlags)
  .action(async () => {
    const { removeScanPreCommitHook } = await dynamicImportScan();
    process.exit(removeScanPreCommitHook(process.cwd()) ? 0 : 1);
  });

// vegastack update
program
  .command("update")
  .description("update the CLI, project Registry packs, and managed tool dependencies")
  .option("--check", "only check for a newer version; do not install", false)
  .option("--no-cli", "skip @vegastack/cli self-update")
  .option("--no-registry", "skip Registry pack update")
  .option("--no-tools", "skip managed tool update")
  .option(
    "--all-registry",
    "update every installed Registry pack instead of project-selected packs",
    false,
  )
  .option("--force", "force registry/tool reinstall where supported", false)
  .option("-y, --yes", "accept non-destructive update prompts such as skill registration", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyProjectCommandPrelude)
  .action(
    async (
      opts: {
        check: boolean;
        cli: boolean;
        registry: boolean;
        tools: boolean;
        allRegistry: boolean;
        force: boolean;
        yes: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const { runUpdate } = await dynamicImportUpdate();
      process.exit(
        await runUpdate({
          check: opts.check,
          current: readVersion(),
          cli: opts.cli,
          registry: opts.registry,
          tools: opts.tools,
          allRegistry: opts.allRegistry,
          force: opts.force,
          yes: opts.yes,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

// vegastack skills install|uninstall|status
const skillsCmd = program
  .command("skills")
  .description("manage per-agent-host skill registration")
  .addHelpText(
    "after",
    `
Agent hosts (--host): ${VALID_AGENT_HOSTS}
Scopes (--scope): global (~/.claude, ~/.agents, ~/.codex), project (cwd)

Examples:
  vegastack skills install --host all
  vegastack skills install --host claude-code,codex
  vegastack skills reconcile
  vegastack skills install --host cursor --scope project
  vegastack --agent skills status --host all
  vegastack skills uninstall --host gemini --scope project
`,
  );

skillsCmd
  .command("install")
  .description(`install skill for one or more agent hosts (valid: ${VALID_AGENT_HOSTS})`)
  .option("--host <list>", "agent host(s) to install (default: all)", collect, [])
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--force", "overwrite existing files / symlinks", false)
  .option("--dry-run", "print what would be done without writing", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      opts: {
        host: string[];
        scope: "global" | "project";
        force: boolean;
        dryRun: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const { runSkills } = await dynamicImportSkills();
      process.exit(
        await runSkills("install", {
          agents: opts.host,
          scope: opts.scope,
          force: opts.force,
          dryRun: opts.dryRun,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

skillsCmd
  .command("uninstall")
  .description(`uninstall skill from one or more agent hosts (valid: ${VALID_AGENT_HOSTS})`)
  .option("--host <list>", "agent host(s) to uninstall (default: all)", collect, [])
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--dry-run", "print what would be done without writing", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      opts: {
        host: string[];
        scope: "global" | "project";
        dryRun: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const { runSkills } = await dynamicImportSkills();
      process.exit(
        await runSkills("uninstall", {
          agents: opts.host,
          scope: opts.scope,
          force: false,
          dryRun: opts.dryRun,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

skillsCmd
  .command("status")
  .description(`show skill registration status across agent hosts (valid: ${VALID_AGENT_HOSTS})`)
  .option("--host <list>", "agent host(s) to check (default: all)", collect, [])
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (opts: { host: string[]; scope: "global" | "project"; agent: boolean }, cmd: Command) => {
      const { runSkills } = await dynamicImportSkills();
      process.exit(
        await runSkills("status", {
          agents: opts.host,
          scope: opts.scope,
          force: false,
          dryRun: false,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

skillsCmd
  .command("reconcile")
  .description("install missing global skills for detected agent hosts")
  .option("-s, --scope <scope>", "global | project", parseScope, "global")
  .option("--force", "overwrite existing files / symlinks", false)
  .option("--dry-run", "print what would be done without writing", false)
  .option("--agent", "emit agent-readable structured output and avoid prompts", false)
  .hook("preAction", applyGlobalFlags)
  .action(
    async (
      opts: {
        scope: "global" | "project";
        force: boolean;
        dryRun: boolean;
        agent: boolean;
      },
      cmd: Command,
    ) => {
      const { runSkillsReconcile } = await dynamicImportSkills();
      process.exit(
        await runSkillsReconcile({
          scope: opts.scope,
          force: opts.force,
          dryRun: opts.dryRun,
          json: isAgentMode(cmd, opts),
        }),
      );
    },
  );

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--agent")) {
  const agent = process.argv[2] === "--agent";
  if (agent) setJsonMode(true);
  const { runDefaultCommand } = await dynamicImportSetup();
  process.exit(await runDefaultCommand({ json: agent }));
}

// Top-level error handler: any uncaught throw in a command becomes a VegaStackError → printError.
try {
  await program.parseAsync(process.argv);
} catch (e) {
  // Commander throws CommanderError on usage errors with its own exitCode.
  const err = e as { code?: string; exitCode?: number; message?: string };
  // Argument-validator failures (`InvalidArgumentError` thrown from custom
  // option parsers like `parsePositiveInt` or scan's `--format` validator) are
  // user-facing validation errors. Route them through the typed error map so
  // they exit 10 (the documented validation code), not commander's generic 1.
  if (typeof err.code === "string" && err.code === "commander.invalidArgument") {
    process.exit(
      printError(new VegaStackError("ValidationError", err.message ?? "invalid argument")),
    );
  }
  if (
    typeof err.exitCode === "number" &&
    typeof err.code === "string" &&
    err.code.startsWith("commander.")
  ) {
    // Commander already wrote the error message to stderr before throwing
    // (exitOverride preserves that behavior). Don't duplicate it.
    process.exit(err.exitCode);
  }
  process.exit(printError(e instanceof VegaStackError ? e : asUnknown(e)));
}

function asUnknown(e: unknown): unknown {
  return e;
}
