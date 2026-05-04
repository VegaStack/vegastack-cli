import type { APIRoute } from "astro";
import { getEnv, getLatestReport } from "~/lib/r2";

export const prerender = false;

/**
 * GET /api/latest.json
 *
 * Tiny status feed used by:
 *  - the README's lift badge
 *  - MCP health views for a "skill is healthy" probe
 *  - the homepage when running outside Workers (e.g. local preview)
 *
 * Returns just the headline figures — never the full prompt list.
 */
export const GET: APIRoute = async () => {
  const env = await getEnv();
  const report = await getLatestReport(env);

  if (!report) {
    return new Response(
      JSON.stringify({ error: "no_report_available" }),
      {
        status: 503,
        headers: jsonHeaders(60),
      },
    );
  }

  const body = {
    schema_version: 1,
    date: report.date,
    registry_version: report.registry_version,
    cli_version: report.cli_version,
    model: report.model,
    prompt_count: report.prompt_count,
    lift: report.lift,
    baseline_pass_rate: report.baseline_pass_rate,
    with_skill_pass_rate: report.with_skill_pass_rate,
    archetypes: report.archetypes.map((a) => ({
      archetype: a.archetype,
      lift: a.lift,
    })),
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: jsonHeaders(300),
  });
};

function jsonHeaders(maxAge: number): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
  };
}
