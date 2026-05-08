// Registry of per-agent renderers. `ALL_RENDERERS` is the single source of
// truth for the supported agent host list — `vegastack skills install`,
// `--host all`, doctor checks, and reconcile flows all read it. Add new
// agents by exporting a renderer from a sibling file and registering it
// below.
//
// The per-file legacy `*Installer` classes (claudeCode, codex, cursor,
// gemini) remain for direct imports inside the agents/ module and a few
// test files; they are not re-exported as a registry.

import type { AgentRenderer } from "./types.js";
import { aiderRenderer } from "./aider.js";
import { claudeCodeRenderer } from "./claude-code.js";
import { codexRenderer } from "./codex.js";
import { continueRenderer } from "./continue.js";
import { cursorRenderer } from "./cursor.js";
import { geminiRenderer } from "./gemini.js";

export const ALL_RENDERERS: Readonly<Record<string, AgentRenderer>> = Object.freeze({
  "claude-code": claudeCodeRenderer,
  codex: codexRenderer,
  cursor: cursorRenderer,
  gemini: geminiRenderer,
  continue: continueRenderer,
  aider: aiderRenderer,
});

export const ALL_RENDERER_NAMES = Object.keys(ALL_RENDERERS) as readonly string[];

export function getRenderer(name: string): AgentRenderer | undefined {
  return ALL_RENDERERS[name];
}

export type {
  AgentRenderer,
  CanonicalSkill,
  InstallContext,
  InstallResult,
  Scope,
  Action,
} from "./types.js";
