// @ts-check
// ESLint v9 flat config. Native TS rules via @typescript-eslint, type-checked
// for src/ and tests/, lighter rules for the npm/ shim (Node-only ESM JS).

import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Ignore generated / vendored.
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "references/terraform-providers/**",
      "npm/bundle/**",
      "*.tsbuildinfo",
      "coverage/**",
    ],
  },

  // Base JS rules.
  js.configs.recommended,

  // TypeScript files: project-aware, strict.
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "evals/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      // Pull in the recommended-type-checked profile manually (flat config exposes it under `configs`).
      ...tseslint.configs["recommended-type-checked"].rules,
      ...tseslint.configs["stylistic-type-checked"].rules,

      // Project-specific overrides:
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // We intentionally use `any` in a few narrow spots (e.g. JSON.parse boundary). Warn, don't error.
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow async functions that don't await — common in command handlers.
      "@typescript-eslint/require-await": "off",
      // Allow string template expressions on numbers (e.g. exit codes) without coercion ceremony.
      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      // Make process.exit calls explicit.
      "no-process-exit": "off",
      // Imports must use .js extension (Node ESM).
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },

  // npm/ shim: plain ESM, no TS, no project parser.
  {
    files: ["npm/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // scripts/ (build helpers, plain Node JS):
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
