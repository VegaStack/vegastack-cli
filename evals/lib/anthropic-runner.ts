// Drives the Anthropic SDK with the bash tool to run a single eval prompt.
//
// Two modes:
//   - baseline   : no skills mounted; the model has only its bash tool with
//                  whatever's already on the runner's PATH (no `vegastack tf`).
//   - with-skill : the harness pre-loads the SKILL.md body into the system
//                  prompt and exposes `vegastack tf "<query>"` as the prescribed
//                  tool path. We do NOT physically mount skills on the host;
//                  the difference is purely the system prompt + the runner's
//                  promise that `vegastack` is on PATH.
//
// We use the SDK's bash_20250124 tool (verified in WebSearch April 2026).
// All bash invocations are sandboxed to a per-run tmp dir.

import type Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RunMode = "baseline" | "with-skill";

export interface AnthropicRunnerOpts {
  client: Anthropic;
  model: string;
  mode: RunMode;
  skillBodyPath: string; // path to skills/vegastack/SKILL.md
  vegaBin?: string; // path to `vegastack` binary; default `vegastack` on PATH
  maxTurns?: number; // safety cap on tool-loop turns
  timeoutMs?: number; // overall per-prompt timeout
}

export interface RunResult {
  response_text: string; // concatenated assistant text blocks
  tool_calls: number;
  bash_log: string[]; // per-tool-use command + truncated output
  stop_reason: string;
}

const BASELINE_SYSTEM = [
  "You are a senior infrastructure engineer.",
  "When asked for Terraform/HCL, return runnable HCL inside ```hcl fenced blocks.",
  "Be concrete: name resources, set arguments, do not stub.",
  "Prefer current best practice (e.g. split-resource S3, cloudflare_dns_record over cloudflare_record, google_cloud_run_v2_*).",
].join(" ");

export async function runPromptOnce(prompt: string, opts: AnthropicRunnerOpts): Promise<RunResult> {
  const maxTurns = opts.maxTurns ?? 8;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const sandbox = await mkdtemp(join(tmpdir(), "vegastack-eval-"));

  const skillBody = opts.mode === "with-skill" ? await safeRead(opts.skillBodyPath) : "";
  const system = opts.mode === "with-skill"
    ? `${BASELINE_SYSTEM}\n\n=== SKILL: vegastack ===\n${skillBody}\n=== END SKILL ===`
    : BASELINE_SYSTEM;

  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: prompt },
  ];
  const bashLog: string[] = [];
  let toolCalls = 0;
  let lastStopReason = "end_turn";
  const deadline = Date.now() + timeoutMs;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (Date.now() > deadline) break;
    const resp = await opts.client.messages.create({
      model: opts.model,
      max_tokens: 4096,
      temperature: 0,
      system,
      tools: [
        {
          // bash_20250124 is the recommended bash tool version as of April 2026.
          type: "bash_20250124",
          name: "bash",
        } as unknown as Parameters<typeof opts.client.messages.create>[0]["tools"] extends infer T
          ? T extends (infer U)[]
            ? U
            : never
          : never,
      ],
      messages: messages as Parameters<typeof opts.client.messages.create>[0]["messages"],
    });
    lastStopReason = resp.stop_reason ?? "end_turn";
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") break;

    const toolUseBlocks = resp.content.filter(
      (b: { type: string }) => b.type === "tool_use"
    ) as { type: "tool_use"; id: string; name: string; input: { command?: string } }[];
    const toolResults: {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }[] = [];

    for (const tu of toolUseBlocks) {
      toolCalls += 1;
      const cmd = tu.input?.command ?? "";
      const exec = await runBash(cmd, sandbox, opts.vegaBin);
      bashLog.push(`$ ${cmd}\n${exec.stdout}\n${exec.stderr}`.slice(0, 4000));
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: (exec.stdout + (exec.stderr ? `\n[stderr]\n${exec.stderr}` : "")).slice(0, 8000),
        is_error: exec.code !== 0,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Concatenate assistant text from all turns.
  const responseText = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => (m.content as { type: string; text?: string }[]) ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");

  return {
    response_text: responseText,
    tool_calls: toolCalls,
    bash_log: bashLog,
    stop_reason: lastStopReason,
  };
}

async function safeRead(p: string): Promise<string> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}

interface ExecResult { stdout: string; stderr: string; code: number }

async function runBash(cmd: string, cwd: string, vegaBin?: string): Promise<ExecResult> {
  // If vegaBin is supplied, prepend its parent to PATH so `vegastack` is found.
  const env = { ...process.env };
  if (vegaBin) {
    const parent = vegaBin.replace(/\/[^/]+$/, "");
    env.PATH = `${parent}:${env.PATH ?? ""}`;
  }
  return await new Promise<ExecResult>((resolve) => {
    const proc = spawn("/bin/bash", ["-lc", cmd], { cwd, env, timeout: 30_000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    proc.on("error", (e) => resolve({ stdout, stderr: stderr + String(e), code: 1 }));
  });
}

// ─── Mock runner for tests + CI dry-runs ───────────────────────────────

/**
 * A deterministic mock runner used when ANTHROPIC_API_KEY is absent OR when
 * the caller passes `mockResponses`. Lets us prove the pipeline end-to-end
 * without burning tokens.
 */
export function mockRun(
  prompt: string,
  mode: RunMode,
  mockResponses: Record<string, { baseline: string; "with-skill": string }>
): RunResult {
  const fixtures = mockResponses[prompt] ?? mockResponses.__default;
  const text = fixtures ? fixtures[mode] : `[mock-${mode}] ${prompt}`;
  return { response_text: text, tool_calls: mode === "with-skill" ? 1 : 0, bash_log: [], stop_reason: "end_turn" };
}

// Persist a captured run to disk for reproducibility.
export async function persistRun(dir: string, id: string, mode: RunMode, r: RunResult): Promise<void> {
  await writeFile(join(dir, `${id}.${mode}.json`), JSON.stringify(r, null, 2), "utf8");
}
