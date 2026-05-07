# Blast Radius Mapping

Two-pass: fast grep, then ts-morph AST confirmation.

## Pass 1 — Grep (wide net)

Identify the **target symbols** from the finding:
- Exported function/class/const names
- File path itself
- Public CLI command name (if applicable)
- Public env-var name (if applicable)

For each symbol, run:

```bash
rg -t ts -t js --no-heading --line-number "\b<symbol>\b" src apps tests scripts
rg -t md "\b<symbol>\b" docs README.md AGENTS.md skills
rg "\b<symbol>\b" .github
```

Collect the union as **candidate set**.

Common false positives to flag:
- Same name in unrelated module (different import).
- String literals in tests that don't import the module.
- Comments and changelog entries.

## Pass 2 — AST (precision)

Use `ts-morph` (already a transitive dev dep via tsx; install only if needed). Inline script approach:

```ts
// scripts/blast.ts (created on demand by the skill)
import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const sym = project.getSourceFileOrThrow("<target-file>")
  .getFunctionOrThrow("<target-symbol>"); // or getClass/getVariable
const refs = sym.findReferencesAsNodes();
for (const r of refs) {
  const sf = r.getSourceFile();
  console.log(`${sf.getFilePath()}:${r.getStartLineNumber()}`);
}
```

Run via `npx tsx scripts/blast.ts`. Use `findReferencesAsNodes()` per [ts-morph docs](https://ts-morph.com/navigation/finding-references).

For multiple symbols, loop. For module-level changes, run on every exported symbol of the changed file.

## Building the map

Combine grep candidates ∩ AST references → **confirmed callers**.
Grep candidates not in AST refs → **possible false positives** (record reasoning, do not include in fix scope).

```
target: src/lib/managed-tools.ts:downloadAndVerify
direct_callers:
  - src/commands/setup.ts:42 (verified by AST)
  - src/lib/managed-tool-installer.ts:118 (verified by AST)
transitive_callers:
  - src/cli.ts:91 (calls setup, AST trace depth=2)
tests_touching:
  - tests/lib/managed-tool-installer.test.ts
  - tests/commands/setup.test.ts
docs_touching:
  - README.md:88 (mentions setup flow)
  - skills/vegastack/SKILL.md:42 (mentions managed tools)
config_touching:
  - .github/workflows/managed-tools-weekly.yml
unaffected_with_reason:
  - src/lib/registry.ts: "imports types only, not the function"
  - tests/lib/registry-search.test.ts: "string match in unrelated assertion"
```

## Depth limits

- Direct callers: 1 hop (immediate references).
- Transitive callers: up to 3 hops by default. Beyond 3 → unlikely to be in the same fix scope; flag separately.
- Test references: 1 hop sufficient (tests don't transitively call each other meaningfully).

## Doc/config search rules

- Always grep `README.md`, `CHANGELOG.md`, `docs/`, `skills/`, `AGENTS.md`, `CONTRIBUTING.md`.
- Always grep `.github/workflows/` for env-var or command-name references.
- Always grep `package.json` `scripts` block for command-name references.

## Output validation

The skill must output the map in step 3 PLAN. Empty map = suspicious unless the changed code is truly internal-only (e.g. a private helper). In that case, document explicitly: "private helper, no external references".

If the AST pass adds references the grep pass missed → re-grep with broader patterns and rerun AST. The two passes must converge.

## Cross-app boundaries

`apps/mcp/` and `apps/dashboard/` have their own `tsconfig.json`. To map blast radius across the workspace, run ts-morph **per project** and union the outputs:

```ts
const projects = [
  new Project({ tsConfigFilePath: "tsconfig.json" }),
  new Project({ tsConfigFilePath: "apps/mcp/tsconfig.json" }),
  new Project({ tsConfigFilePath: "apps/dashboard/tsconfig.json" }),
];
```

Cross-package symbol references (e.g. main CLI exporting a type used by `apps/mcp/`) must be captured.

## Caching

Within a single run, cache the `ts-morph` Project instances and reuse across mutation iterations. Discard the cache when the source tree changes (after FIX commits).
