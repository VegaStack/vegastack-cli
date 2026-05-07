import { installCloudflared, type CloudflaredInstall } from "./cloudflared.js";
import { installGitleaks, type GitleaksInstall } from "./gitleaks.js";
import { installManagedTool, type ManagedToolInstall } from "./managed-tool-installer.js";
import { MANAGED_TOOLS_MANIFEST } from "./managed-tools-manifest.js";
import { installRipgrep, type RipgrepInstall } from "./ripgrep.js";

export type ManagedToolName = keyof typeof MANAGED_TOOLS_MANIFEST.tools;

export interface ManagedToolsUpdateResult {
  manifest_generated_at: string;
  tools: {
    cloudflared?: CloudflaredInstall | { error: string };
    gitleaks?: GitleaksInstall | { error: string };
    ripgrep?: RipgrepInstall | { error: string };
    actionlint?: ManagedToolInstall | { error: string };
    "osv-scanner"?: ManagedToolInstall | { error: string };
    trivy?: ManagedToolInstall | { error: string };
    zizmor?: ManagedToolInstall | { error: string };
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
  if (include.has("actionlint"))
    tools.actionlint = await capture(() => installManagedTool("actionlint", opts));
  if (include.has("osv-scanner"))
    tools["osv-scanner"] = await capture(() => installManagedTool("osv-scanner", opts));
  if (include.has("trivy")) tools.trivy = await capture(() => installManagedTool("trivy", opts));
  if (include.has("zizmor")) tools.zizmor = await capture(() => installManagedTool("zizmor", opts));
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
