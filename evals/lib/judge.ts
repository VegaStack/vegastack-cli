// LLM-as-judge for ambiguous expectations only.
// Used by the runner when a `manifest_check` doesn't have a manifest entry to
// validate against, or when an expectation needs free-text judgment.
//
// Best-practice notes (April 2026):
//   - Single yes/no question per call; temperature 0; explicit JSON output.
//   - Run 3× and take the median to suppress jitter.
//   - Hard cap concurrency to respect Anthropic rate limits.
//   - The judge prompt is locked by a snapshot test — see tests/integration/eval-runner.test.ts.

import type Anthropic from "@anthropic-ai/sdk";

export interface JudgeQuestion {
  expectation_id: string;
  question: string; // single yes/no
  hcl_snippet: string;
  full_response: string;
}

export interface JudgeAnswer {
  expectation_id: string;
  passed: boolean;
  reasoning: string;
}

export const JUDGE_SYSTEM_PROMPT = [
  "You are a strict, precise grader of Terraform/HCL output.",
  "You answer with JSON only — no prose, no markdown fences.",
  "Output shape: {\"passed\": boolean, \"reasoning\": string}",
  "Reasoning must be one short sentence.",
  "If the assistant output is missing the requested resource, argument, or pattern, answer false.",
  "Do NOT reward the assistant for citing the right idea without producing valid HCL when HCL was asked for.",
].join("\n");

export function buildJudgePrompt(q: JudgeQuestion): string {
  return [
    `Question: ${q.question}`,
    "",
    "--- assistant_response_begin ---",
    q.full_response.slice(0, 6000),
    "--- assistant_response_end ---",
    "",
    "Respond with JSON: {\"passed\": true|false, \"reasoning\": \"...\"}",
  ].join("\n");
}

export interface JudgeOpts {
  client: Anthropic;
  model: string;
  samples?: number; // default 3, median wins
}

export async function judge(q: JudgeQuestion, opts: JudgeOpts): Promise<JudgeAnswer> {
  const samples = opts.samples ?? 3;
  const results: boolean[] = [];
  let lastReason = "";
  for (let i = 0; i < samples; i++) {
    try {
      const r = await opts.client.messages.create({
        model: opts.model,
        max_tokens: 200,
        temperature: 0,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildJudgePrompt(q) }],
      });
      const text = r.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { type: string; text?: string }) => b.text ?? "")
        .join("");
      const parsed = parseJudgeJson(text);
      results.push(parsed.passed);
      lastReason = parsed.reasoning;
    } catch (e: unknown) {
      // Treat API error as a false vote — defensible default; surfaces as failure
      // so we notice rather than silently inflating the lift number.
      results.push(false);
      lastReason = `judge api error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const trues = results.filter(Boolean).length;
  return {
    expectation_id: q.expectation_id,
    passed: trues > samples / 2,
    reasoning: `${trues}/${samples} judges agreed; ${lastReason}`,
  };
}

export function parseJudgeJson(text: string): { passed: boolean; reasoning: string } {
  // Tolerant of fenced output even though we asked for raw JSON.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const o = JSON.parse(cleaned) as { passed?: unknown; reasoning?: unknown };
    return {
      passed: Boolean(o.passed),
      reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
    };
  } catch {
    // Last-resort heuristic.
    const yes = /\b(true|yes|pass(ed)?)\b/i.test(cleaned);
    return { passed: yes, reasoning: `unparseable, heuristic=${yes}` };
  }
}
