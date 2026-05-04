import { installCloudflared, type CloudflaredInstall } from "./cloudflared.js";
import { installGitleaks, type GitleaksInstall } from "./gitleaks.js";
import { MANAGED_TOOLS_MANIFEST } from "./managed-tools-manifest.js";
import { installRipgrep, type RipgrepInstall } from "./ripgrep.js";

export type ManagedToolName = keyof typeof MANAGED_TOOLS_MANIFEST.tools;

export interface ManagedToolsUpdateResult {
  manifest_generated_at: string;
  tools: {
    cloudflared?: CloudflaredInstall | { error: string };
    gitleaks?: GitleaksInstall | { error: string };
    ripgrep?: RipgrepInstall | { error: string };
  };
}

export async function installManagedTools(
  opts: { force?: boolean; include?: ManagedToolName[] } = {},
): Promise<ManagedToolsUpdateResult> {
  const include = new Set<ManagedToolName>(
    opts.include ?? (Object.keys(MANAGED_TOOLS_MANIFEST.tools) as ManagedToolName[]),
  );
  const tools: ManagedToolsUpdateResult["tools"] = {};
  if (include.has("ripgrep")) tools.ripgrep = await capture(() => installRipgrep(opts));
  if (include.has("gitleaks")) tools.gitleaks = await capture(() => installGitleaks(opts));
  if (include.has("cloudflared")) tools.cloudflared = await capture(() => installCloudflared(opts));
  return {
    manifest_generated_at: MANAGED_TOOLS_MANIFEST.generated_at,
    tools,
  };
}

async function capture<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
