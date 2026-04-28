// Registry of all per-agent installers and renderers. Add new agents here.
//
// Two surfaces are exported:
//   - ALL_AGENTS    — legacy synchronous AgentInstaller registry, consumed
//                     by `vega skills install` today.
//   - ALL_RENDERERS — async AgentRenderer registry, the v0.1 abstraction
//                     used by tests and forthcoming MCP/installer flows.

import type { AgentInstaller, AgentRenderer } from "./types.js";
import { aiderRenderer } from "./aider.js";
import { claudeCode, claudeCodeRenderer } from "./claude-code.js";
import { codex, codexRenderer } from "./codex.js";
import { continueRenderer } from "./continue.js";
import { cursor, cursorRenderer } from "./cursor.js";
import { gemini, geminiRenderer } from "./gemini.js";

export const ALL_AGENTS: Readonly<Record<string, AgentInstaller>> = Object.freeze({
  "claude-code": claudeCode,
  codex,
  cursor,
  gemini,
});

export const ALL_AGENT_NAMES = Object.keys(ALL_AGENTS) as readonly string[];

export const ALL_RENDERERS: Readonly<Record<string, AgentRenderer>> = Object.freeze({
  "claude-code": claudeCodeRenderer,
  codex: codexRenderer,
  cursor: cursorRenderer,
  gemini: geminiRenderer,
  continue: continueRenderer,
  aider: aiderRenderer,
});

export const ALL_RENDERER_NAMES = Object.keys(ALL_RENDERERS) as readonly string[];

export function getAgent(name: string): AgentInstaller | undefined {
  return ALL_AGENTS[name];
}

export function getRenderer(name: string): AgentRenderer | undefined {
  return ALL_RENDERERS[name];
}

export type {
  AgentInstaller,
  AgentRenderer,
  CanonicalSkill,
  InstallContext,
  InstallResult,
  Scope,
  Action,
} from "./types.js";
