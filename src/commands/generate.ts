import { detectProject } from "../lib/detect.js";
import { log, printError } from "../lib/log.js";

export interface GenerateOptions {
  dryRun: boolean;
  json: boolean;
}

interface GenerateContract {
  schema_version: 1;
  intent: string;
  status: "ready" | "needs_input";
  detected: ReturnType<typeof detectProject>;
  required_questions: { id: string; question: string; default?: string; options?: string[] }[];
  files: { path: string; operation: "create" | "modify"; kind: string; constraints: string[] }[];
  lookup_plan: { command: string }[];
  validation: string[];
  agent_instructions: string[];
}

interface GenerateQuestion {
  id: string;
  message: string;
  options?: string[];
}

export async function runGenerate(intentWords: string[], opts: GenerateOptions): Promise<number> {
  try {
    const intent = normalizeIntent(intentWords);
    const detection = detectProject(process.cwd());
    const contract = buildContract(intent, detection);
    if (opts.json || opts.dryRun) log.json(contract);
    else printContract(contract);
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function normalizeIntent(words: string[]): string {
  return words.join(" ").trim().toLowerCase().replace(/\s+/g, " ") || "ops-file";
}

function buildContract(
  intent: string,
  detection: ReturnType<typeof detectProject>,
): GenerateContract {
  const files = filesForIntent(intent);
  const required: GenerateQuestion[] = [...detection.questions];
  if (/vercel/.test(intent)) {
    required.push({
      id: "vercel_project",
      message:
        "Which Vercel project/org should this deploy to, and are VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID available as secrets?",
    });
  }
  if (/github|action/.test(intent) && !detection.repo.host) {
    required.push({
      id: "repo_host",
      message: "Should this workflow target GitHub Actions?",
      options: ["github-actions"],
    });
  }
  return {
    schema_version: 1,
    intent,
    status: required.length > 0 ? "needs_input" : "ready",
    detected: detection,
    required_questions: required.map((q) => ({
      id: q.id,
      question: q.message,
      ...(q.options ? { options: q.options } : {}),
    })),
    files,
    lookup_plan: lookupPlanForIntent(intent),
    validation: validationForIntent(intent),
    agent_instructions: [
      "Do not let VegaStack write source files for this workflow.",
      "Use detected package manager and commands exactly unless the user overrides them.",
      "Run the lookup_plan commands before writing files.",
      "After editing files, run validation commands and `vegastack scan --staged`.",
      "Report required secrets and manual authentication steps without printing secret values.",
    ],
  };
}

function filesForIntent(intent: string): GenerateContract["files"] {
  if (/github|action/.test(intent) && /vercel/.test(intent)) {
    return [
      {
        path: ".github/workflows/vercel-preview.yml",
        operation: "create",
        kind: "github-actions-workflow",
        constraints: [
          "Use detected package manager cache/install/build commands.",
          "Do not hardcode Vercel tokens.",
          "Use least permissions.",
        ],
      },
    ];
  }
  if (/gitlab/.test(intent)) {
    return [
      {
        path: ".gitlab-ci.yml",
        operation: "create",
        kind: "gitlab-ci",
        constraints: ["Use detected package manager commands."],
      },
    ];
  }
  if (/dockerfile|docker/.test(intent)) {
    return [
      {
        path: "Dockerfile",
        operation: "create",
        kind: "dockerfile",
        constraints: ["Use a production multi-stage build where applicable."],
      },
    ];
  }
  if (/compose/.test(intent)) {
    return [
      {
        path: "compose.yaml",
        operation: "create",
        kind: "docker-compose",
        constraints: ["Prefer compose.yaml as the canonical Compose file."],
      },
    ];
  }
  if (/kubernetes|k8s/.test(intent)) {
    return [
      {
        path: "k8s/deployment.yaml",
        operation: "create",
        kind: "kubernetes-manifest",
        constraints: ["Include probes, labels, and non-secret env references."],
      },
    ];
  }
  return [
    {
      path: "<agent-selected>",
      operation: "create",
      kind: "ops-file",
      constraints: ["Use VegaStack lookup results before writing."],
    },
  ];
}

function lookupPlanForIntent(intent: string): GenerateContract["lookup_plan"] {
  const out: GenerateContract["lookup_plan"] = [];
  if (/github|action/.test(intent))
    out.push({
      command:
        'vegastack ask --agent --pack github-actions "workflow syntax permissions secrets cache package manager"',
    });
  if (/gitlab/.test(intent))
    out.push({
      command: 'vegastack ask --agent --pack gitlab-ci "pipeline syntax cache artifacts secrets"',
    });
  if (/vercel/.test(intent))
    out.push({
      command:
        'vegastack ask --agent --pack vercel "cli deploy prebuilt github actions environment variables"',
    });
  if (/docker/.test(intent))
    out.push({
      command:
        'vegastack ask --agent --pack docker "Dockerfile multi stage build healthcheck best practices"',
    });
  if (/kubernetes|k8s/.test(intent))
    out.push({
      command:
        'vegastack ask --agent --pack kubernetes "Deployment Service probes resources env secrets"',
    });
  return out.length > 0 ? out : [{ command: `vegastack ask --agent "${intent}"` }];
}

function validationForIntent(intent: string): string[] {
  const out = ["vegastack scan --staged"];
  if (/github|action/.test(intent)) out.unshift("vegastack scan actions --staged");
  if (/docker/.test(intent)) out.unshift("vegastack scan containers");
  if (/kubernetes|k8s/.test(intent)) out.unshift("vegastack scan kubernetes");
  return out;
}

function printContract(contract: GenerateContract): void {
  log.info(`intent: ${contract.intent}`);
  log.info(`status: ${contract.status}`);
  log.info(`files: ${contract.files.map((f) => f.path).join(", ")}`);
  log.info(`lookup: ${contract.lookup_plan.map((p) => p.command).join(" | ")}`);
}
