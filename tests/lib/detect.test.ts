import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { detectProject } from "../../src/lib/detect.js";
import { withTmpDir } from "../setup.js";

describe("project stack detection", () => {
  it("detects Yarn/Next/Vercel commands without guessing pnpm", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          packageManager: "yarn@4.5.1",
          scripts: { build: "next build", test: "vitest", dev: "next dev" },
          dependencies: { next: "15.3.1" },
        }),
      );
      fs.writeFileSync(path.join(dir, "yarn.lock"), "");
      fs.writeFileSync(path.join(dir, "vercel.json"), "{}\n");

      const detection = detectProject(dir);

      expect(detection.stack.package_manager?.name).toBe("yarn");
      expect(detection.commands.install).toBe("yarn install --immutable");
      expect(detection.commands.build).toBe("yarn run build");
      expect(detection.stack.frameworks.find((f) => f.name === "nextjs")?.version).toBe("15.3.1");
      expect(detection.deploy.targets).toContain("vercel");
      expect(detection.registry.recommended_entries).toContain("vercel");
    });
  });

  it("recommends the Cloudflare Registry pack for Wrangler projects", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, "wrangler.toml"), 'name = "worker"\n');

      const detection = detectProject(dir);

      expect(detection.deploy.targets).toContain("cloudflare");
      expect(detection.registry.recommended_entries).toContain("cloudflare");
      expect(detection.registry.recommended_entries).not.toContain("cloudflare-workers");
    });
  });

  it("returns needs_input for conflicting lockfiles", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
      fs.writeFileSync(path.join(dir, "yarn.lock"), "");
      fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");

      const detection = detectProject(dir);

      expect(detection.status).toBe("needs_input");
      expect(detection.questions[0]?.id).toBe("package_manager");
    });
  });
});
