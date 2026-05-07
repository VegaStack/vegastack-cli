import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(__dirname, "..", "src", "pages", "reports", "[date].astro");

describe("/reports/[date].astro", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it("does not opt into prerender — runtime Response branches require SSR", () => {
    // With prerender=true the only emitted paths are the fixture dates from
    // getStaticPaths(); any other URL never reaches the worker, making the
    // 400/404 Response branches unreachable in production.
    expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
    expect(src).not.toMatch(/export\s+const\s+prerender\s*=\s*true/);
  });

  it("does not declare getStaticPaths (incompatible with prerender=false)", () => {
    expect(src).not.toMatch(/getStaticPaths\s*\(/);
  });
});
